import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {config} from '../src/lib/config';
import {auth} from '../src/lib/auth';
import {query,pool} from '../src/lib/db';
import {seed} from './seed';
import {assertIsolatedDatabase,fixtureLibrary} from '../tests/integration/helpers';
assertIsolatedDatabase();
const fixturePath=resolve(config.storagePath,'../browser-fixtures.json');
try{
 await seed(true);const libraryId=await fixtureLibrary();
 const credentials:Record<string,string>={TEST_LIBRARY_ID:libraryId};
 for(const [kind,role,name] of [['MEMBER','MEMBER','Cititor de test'],['ADMIN','ADMIN','Administrator de test']] as const){
  const email=kind.toLowerCase()+'@browser.test',password=randomBytes(24).toString('base64url')+'aA7!';
  const result=await auth.api.signUpEmail({body:{name,email,password}});
  const userId=result.user.id;
  // Explicit fixtures only in the disposable *_test database. Production has no
  // fixture endpoint, password or automatic email-based elevation.
  await query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[userId]);
  await query('INSERT INTO members(id,display_name,handle,role,adult,home_library_id) VALUES($1,$2,$3,$4,true,$5)',[userId,name,'browser_'+kind.toLowerCase(),role,libraryId]);
  credentials[`TEST_${kind}_EMAIL`]=email;credentials[`TEST_${kind}_PASSWORD`]=password;
 }
 const photograph=resolve(config.storagePath,'../phone-photo.png');
 await sharp({create:{width:900,height:1200,channels:3,background:{r:229,g:212,b:175}}}).png().toFile(photograph);
 credentials.TEST_UPLOAD_PHOTO=photograph;
 await writeFile(fixturePath,JSON.stringify(credentials),{mode:0o600,flag:'wx'});
 console.log('Isolated browser fixtures created; no passwords or production data printed.');
}catch{console.error('Browser fixture setup failed; no test success recorded. Details redacted.');process.exitCode=1;}
finally{await pool.end();}
