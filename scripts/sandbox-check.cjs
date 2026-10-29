// Dependency-free environment fallback. Uses Debian's installed Babel only for source
// syntax parsing and running pure tests; it is not a Next build/typecheck/DB substitute.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const parser=require('@babel/parser'),babel=require('@babel/core');
const root=path.resolve(__dirname,'..');let count=0;const problems=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.next','.git'].includes(entry.name))continue;const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(p)){try{parser.parse(fs.readFileSync(p,'utf8'),{sourceType:'module',plugins:['typescript',...(p.endsWith('.tsx')?['jsx']:[])]});count++;}catch(error){problems.push(path.relative(root,p)+': '+error.message);}}}}
walk(path.join(root,'src'));walk(path.join(root,'scripts'));walk(path.join(root,'tests'));
for(const name of ['next.config.ts','playwright.config.ts','next-env.d.ts']){const file=path.join(root,name);try{parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['typescript']});count++;}catch(error){problems.push(name+': '+error.message);}}
if(problems.length){process.stderr.write(problems.join('\n')+'\n');process.exit(1);}console.log(`Syntax parsing passed for ${count} TypeScript/TSX files. No semantic typecheck claimed.`);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'biblioteca-pure-'));fs.writeFileSync(path.join(temp,'package.json'),'{"type":"commonjs"}');
const files=['src/domain/ro.ts','src/domain/errors.ts','src/domain/normalization.ts','src/domain/lifecycle.ts','src/domain/ai-output.ts','src/domain/ad-policy.ts','src/domain/report-evidence.ts','src/domain/csp.ts','src/domain/provider-transport.ts','src/lib/legal-publication.ts','src/lib/auth-copy.ts','src/lib/auth-response.ts','src/lib/restore-archive.ts','tests/unit/normalization.test.ts','tests/unit/lifecycle.test.ts','tests/unit/ai-ads.test.ts','tests/unit/evidence.test.ts','tests/unit/csp.test.ts','tests/unit/provider-transport.test.ts','tests/unit/legal-publication.test.ts','tests/unit/auth-boundary.test.ts','tests/unit/restore-archive.test.ts'];
for(const name of files){const dest=path.join(temp,name.replace(/\.ts$/,'.cjs'));fs.mkdirSync(path.dirname(dest),{recursive:true});const result=babel.transformSync(fs.readFileSync(path.join(root,name),'utf8'),{filename:name,configFile:false,babelrc:false,plugins:['@babel/plugin-transform-typescript','@babel/plugin-transform-modules-commonjs']}).code;fs.writeFileSync(dest,result.replace(/\.ts(["'])/g,'.cjs$1'));}
for(const file of files.filter(f=>f.startsWith('tests/')))require(path.join(temp,file.replace(/\.ts$/,'.cjs')));
process.once('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));
