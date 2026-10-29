// Sandbox fallback only: Babel transforms the checked-in HTTP wrapper and
// AsyncLocalStorage creation capture. Better Auth and PostgreSQL are explicitly
// mocked boundaries. This does not verify real authentication or database access.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
const root=path.resolve(__dirname,'..');
const settings={appUrl:'http://localhost:3000',registrationEnabled:true,environment:'test',adminStepUpMinutes:30};
let mode='new',policyCount=3;
const mutations=[];
const db={pool:{},query:async(sql)=>({rowCount:policyCount,rows:sql.startsWith('SELECT DISTINCT')?Array.from({length:policyCount},(_,index)=>({id:'synthetic-policy-'+index})):[]}),transaction:async(run)=>run({query:async(sql,args)=>{
  if(sql.startsWith('SELECT u.id'))return{rows:[{id:args[0],name:'Synthetic test'}]};
  if(sql.startsWith('SELECT count(*)'))return{rows:[{count:3}]};
  mutations.push({sql,args});return{rows:[],rowCount:1};
}})};
function compile(file,mocks){
  const source=babel.transformSync(fs.readFileSync(path.join(root,file),'utf8'),{filename:file,configFile:false,babelrc:false,plugins:['@babel/plugin-transform-typescript','@babel/plugin-transform-modules-commonjs']}).code;
  const exports={};
  const context={exports,require(name){if(name in mocks)return mocks[name];const withoutExtension=name.replace(/\.ts$/,'');if(withoutExtension in mocks)return mocks[withoutExtension];return require(name);},console,Buffer,Request,Response,Headers,URL,crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(source,context,{filename:file});return exports;
}
const copy=compile('src/lib/auth-copy.ts',{}),projection=compile('src/lib/auth-response.ts',{'./auth-copy':copy});
const betterAuth=options=>({api:{getSession:async()=>null},handler:async request=>{
  const body=await request.json();
  const id=mode==='new'?'synthetic-new-id':'synthetic-duplicate-id';
  if(mode==='new')await options.databaseHooks.user.create.after({id,email:body.email,name:body.name});
  return Response.json({user:{id,email:body.email,emailVerified:false},token:null});
}});
const auth=compile('src/lib/auth.ts',{'better-auth':{betterAuth},'better-auth/plugins':{twoFactor:()=>({})},'better-auth/api':{APIError:class extends Error{}},'./config':{config:settings},'./db':db,'./auth-copy':copy});
const route=compile('src/app/api/auth/[...all]/route.ts',{'@/lib/auth':auth,'@/lib/config':{config:settings},'@/lib/db':db,'@/lib/auth-copy':copy,'@/lib/auth-response':projection});
function request(assertions){return new Request(settings.appUrl+'/api/auth/sign-up/email',{method:'POST',headers:{origin:settings.appUrl,'content-type':'application/json'},body:JSON.stringify({name:'Synthetic reader',email:'synthetic@example.invalid',password:'Synthetic-password-42!',...assertions})});}
(async()=>{
  let passed=0;
  for(const assertions of [{},{adult:false,acceptedTerms:true},{adult:true,acceptedTerms:false},{adult:'true',acceptedTerms:true}]){assert.equal((await route.POST(request(assertions))).status,400);passed++;}
  assert.equal(mutations.length,0);
  policyCount=0;assert.equal((await route.POST(request({adult:true,acceptedTerms:true}))).status,403);passed++;
  policyCount=3;
  const created=await route.POST(request({adult:true,acceptedTerms:true}));assert.equal(created.status,200);assert.equal((await created.json()).token,undefined);
  assert.equal(mutations.length,3);assert.equal(mutations[0].args[0],'synthetic-new-id');assert.deepEqual(Array.from(mutations[1].args[1]),['synthetic-policy-0','synthetic-policy-1','synthetic-policy-2']);
  assert.equal(JSON.parse(mutations[2].args[1]).adultSelfAttestation,true);passed++;
  mode='duplicate';assert.equal((await route.POST(request({adult:true,acceptedTerms:true}))).status,200);assert.equal(mutations.length,3);passed++;
  console.log(`${passed}/7 HTTP signup policy checks passed against actual source with mocked Better Auth/PostgreSQL boundaries. No real auth/database integration claimed.`);
})().catch(()=>{console.error('HTTP signup policy fallback failed.');process.exitCode=1;});
