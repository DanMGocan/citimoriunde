import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

type ArtifactReport = {
  standaloneFiles:number; browserFiles:number; serverFiles:number;
  privatePaths:number; escapedLinks:number; browserCredentialFiles:number;
  serverCredentialFiles:number; missingArtifacts:number; readFailures:number; failures:number;
  skippedShortCredentialValues:number;
};
const textExtensions = new Set(['.js','.mjs','.cjs','.json','.map','.html','.rsc','.txt','.css','.meta','.body']);
const privateDirectories = new Set(['storage','backups','test-artifacts','test-results','.git']);
function inside(root:string, path:string) {
  const fromRoot=relative(root,path);
  return fromRoot===''||(!isAbsolute(fromRoot)&&fromRoot!=='..'&&!fromRoot.startsWith('..'+sep));
}

/** Read-only checks. Values and matching file contents never enter the report. */
export async function inspectBuildArtifacts(projectRoot:string, credentialValues:readonly string[], privateLocations:readonly string[]=[]):Promise<ArtifactReport> {
  const root=resolve(projectRoot), standalone=join(root,'.next/standalone');
  const report:ArtifactReport={standaloneFiles:0,browserFiles:0,serverFiles:0,privatePaths:0,escapedLinks:0,browserCredentialFiles:0,serverCredentialFiles:0,missingArtifacts:0,readFailures:0,failures:0,skippedShortCredentialValues:0};
  const privateCopies=privateLocations.map(path=>resolve(root,path)).filter(path=>inside(root,path)&&path!==root).map(path=>resolve(standalone,relative(root,path)));
  const configuredValues=[...new Set(credentialValues.filter(Boolean))];
  // Short scalars (for example the Docker build password "build") collide with
  // ordinary code. Exact-value checks cover credentials of at least 12 characters
  // and their encodings; full connection URLs remain covered even with short passwords.
  report.skippedShortCredentialValues=configuredValues.filter(value=>value.length<12).length;
  const needles=[...new Set(configuredValues.filter(value=>value.length>=12).flatMap(value=>[
    value,JSON.stringify(value).slice(1,-1),encodeURIComponent(value),Buffer.from(value).toString('base64'),Buffer.from(value).toString('base64url'),
  ]))];
  const scanned=new Set<string>();
  async function walk(directory:string, mode:'standalone'|'browser'|'server') {
    let entries;
    try {entries=await readdir(directory,{withFileTypes:true});}
    catch {report.readFailures++;return;}
    for(const entry of entries){
      const path=join(directory,entry.name);
      if(mode==='standalone'&&(/^\.env(?:\.|$)/.test(entry.name)||
        (entry.isDirectory()&&privateDirectories.has(entry.name))||
        (entry.name==='snapshots'&&relative(standalone,path).split(sep).slice(-2).join('/')==='data/snapshots')||
        privateCopies.some(location=>inside(location,path)))){
        report.privatePaths++;continue;
      }
      if(entry.isSymbolicLink()){
        // Artifacts must not depend on an outside source tree or private volume.
        try {if(!inside(standalone,await realpath(path)))report.escapedLinks++;}
        catch {report.readFailures++;}
        continue;
      }
      if(entry.isDirectory()){await walk(path,mode);continue;}
      if(!entry.isFile())continue;
      if(mode==='standalone')report.standaloneFiles++;
      if(!textExtensions.has(extname(entry.name)))continue;
      const generatedServer=mode==='server'||(mode==='standalone'&&!relative(standalone,path).split(sep).includes('node_modules'));
      if(mode!=='browser'&&!generatedServer)continue;
      if(scanned.has(path))continue;scanned.add(path);
      if(mode==='browser')report.browserFiles++;else report.serverFiles++;
      try {
        const body=await readFile(path,'utf8');
        if(needles.some(value=>body.includes(value))){if(mode==='browser')report.browserCredentialFiles++;else report.serverCredentialFiles++;}
      }catch{report.readFailures++;}
    }
  }
  for(const [directory,mode] of [[standalone,'standalone'],[join(root,'.next/static'),'browser'],[join(root,'.next/server'),'server']] as const){
    try {
      const metadata=await lstat(directory);
      if(metadata.isSymbolicLink()){report.escapedLinks++;continue;}
      if(!metadata.isDirectory()){report.missingArtifacts++;continue;}
    }
    catch {report.missingArtifacts++;continue;}
    await walk(directory,mode);
  }
  try {if(!(await stat(join(standalone,'server.js'))).isFile())report.missingArtifacts++;}
  catch {report.missingArtifacts++;}
  if(report.browserFiles===0)report.missingArtifacts++;
  if(report.serverFiles===0)report.missingArtifacts++;
  report.failures=report.privatePaths+report.escapedLinks+report.browserCredentialFiles+report.serverCredentialFiles+report.missingArtifacts+report.readFailures;
  return report;
}

export async function checkBuildArtifacts():Promise<ArtifactReport> {
  const {config}=await import('../src/lib/config');
  const credentialValues=[config.authSecret,config.databaseUrl,config.testDatabaseUrl,config.postgresPassword,
    config.googleClientId,config.googleClientSecret,config.smtpPassword,config.googleBooksApiKey,config.mistralApiKey,config.s3AccessKey,config.s3SecretKey];
  for(const databaseUrl of [config.databaseUrl,config.testDatabaseUrl]){
    try {credentialValues.push(decodeURIComponent(new URL(databaseUrl).password));}catch{/* Invalid optional URLs cannot add a secret value. */}
  }
  const report=await inspectBuildArtifacts(resolve('.'),credentialValues,[config.storagePath,config.backupPath]);
  console.log(`${report.failures===0?'PASS':'FAIL'} build artifacts: ${JSON.stringify(report)}`);
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {process.exitCode=(await checkBuildArtifacts()).failures===0?0:1;}
  catch {console.error('FAIL build artifacts: checks_failed=1');process.exitCode=1;}
}
