// Optional static fallback using system Babel. It checks source references only;
// it cannot establish TypeScript/library compatibility or database correctness.
const fs=require('node:fs'),path=require('node:path'),parser=require('@babel/parser'),traverse=require('@babel/traverse').default;
const root=path.resolve(__dirname,'..'),problems=[],files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(ts|tsx)$/.test(file))files.push(file);}}
walk(path.join(root,'src'));walk(path.join(root,'tests'));walk(path.join(root,'scripts'));
const dictionaries={roDomain:'src/domain/ro.ts',uiText:'src/components/ui-copy.ts'};let references=0,imports=0;
for(const [name,file] of Object.entries(dictionaries)){
 const source=fs.readFileSync(path.join(root,file),'utf8');const keys=new Set();
 traverse(parser.parse(source,{sourceType:'module',plugins:['typescript']}),{ObjectProperty(p){if(p.node.key.type==='Identifier')keys.add(p.node.key.name);else if(p.node.key.type==='StringLiteral')keys.add(p.node.key.value);}});
 dictionaries[name]=keys;
}
for(const file of files){const ast=parser.parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['typescript',...(file.endsWith('tsx')?['jsx']:[])]});
 traverse(ast,{MemberExpression(p){const n=p.node;if(n.object.type!=='Identifier'||!dictionaries[n.object.name]||n.computed||n.property.type!=='Identifier')return;references++;if(!dictionaries[n.object.name].has(n.property.name))problems.push(`${path.relative(root,file)}: unknown copy ${n.object.name}.${n.property.name}`);},ImportDeclaration(p){const name=p.node.source.value;if(!name.startsWith('.')&&!name.startsWith('@/'))return;imports++;const target=name.startsWith('@/')?path.join(root,'src',name.slice(2)):path.resolve(path.dirname(file),name);if(![target,target+'.ts',target+'.tsx',target+'.js',path.join(target,'index.ts')].some(f=>fs.existsSync(f)))problems.push(`${path.relative(root,file)}: missing local import ${name}`);}});
}
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log(JSON.stringify({sourceFiles:files.length,copyReferences:references,localImports:imports,missing:0,scope:'Static source contracts only; no semantic/runtime validation.'}));
