import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {assertIsolatedDatabase,fixtureMember,fixtureLibrary,closeTestPool} from './helpers.ts';
import {query,pool} from '../../src/lib/db.ts';
import {libraries,requestLibrary,decideLibrary} from '../../src/domain/libraries.ts';
import {isEuCountry} from '../../src/domain/geography.ts';
import {databaseLaunchChecks,launchReadiness} from '../../src/domain/readiness.ts';
import {seed} from '../../scripts/seed.ts';

assertIsolatedDatabase();
after(closeTestPool);
const rejectsCode=(promise:Promise<unknown>,code:string)=>assert.rejects(promise,(error:any)=>error?.code===code);
const explanation='Synthetic geography request for the isolated integration database.';

test('migrated library choices include the three requested cities and only EU countries',async()=>{
  const result=await libraries();
  assert.ok(result.libraries.every(city=>isEuCountry(city.country_code)));
  for(const source of ['un-wup2025-city:948','un-wup2025-city:2553','un-wup2025-city:262']){
    const city=await query('SELECT id,country_code,active,population,population_year FROM libraries WHERE source_id=$1',[source]);
    assert.equal(city.rowCount,1);
    assert.equal(city.rows[0].country_code,'RO');assert.equal(city.rows[0].active,true);
    assert.equal(city.rows[0].population_year,2025);assert.ok(Number(city.rows[0].population)>0);
    assert.ok(result.libraries.some(listed=>listed.id===city.rows[0].id));
  }
});

test('non-EU requests and stale approvals are rejected while their history can be reviewed',async()=>{
  const member=await fixtureMember(),admin=await fixtureMember({role:'ADMIN'}),euLibrary=await fixtureLibrary();
  for(const countryCode of ['GB','TR','RU','UA','RS','US','NO','CH']){
    await rejectsCode(requestLibrary(member,{countryCode,locality:'Synthetic '+randomUUID(),explanation}),'EU_COUNTRY_REQUIRED');
  }
  await rejectsCode(requestLibrary(member,{countryCode:'RO',locality:'Cluj',explanation}),'LIBRARY_EXISTS');
  const stale=(await query("INSERT INTO library_requests(requester_id,country_code,locality,locality_key,explanation) VALUES($1,'GB',$2,$2,$3) RETURNING id",[member.id,'synthetic '+randomUUID(),explanation])).rows[0].id;
  await rejectsCode(decideLibrary(admin,{id:stale},'APPROVED'),'EU_COUNTRY_REQUIRED');
  await rejectsCode(decideLibrary(admin,{id:stale,libraryId:euLibrary},'LINKED'),'EU_COUNTRY_REQUIRED');
  await decideLibrary(admin,{id:stale,reason:'Localitatea nu se află în Uniunea Europeană.'},'REJECTED');
  assert.equal((await query('SELECT state FROM library_requests WHERE id=$1',[stale])).rows[0].state,'REJECTED');
});

test('library linking requires an active EU destination',async()=>{
  const member=await fixtureMember(),admin=await fixtureMember({role:'ADMIN'}),inactive=await fixtureLibrary(),active=await fixtureLibrary();
  await query('UPDATE libraries SET active=false WHERE id=$1',[inactive]);
  const archived=(await query("INSERT INTO libraries(name,display_name,country_code,active) VALUES($1,$1,'GB',false) RETURNING id",['Synthetic archive '+randomUUID()])).rows[0].id;
  const request=await requestLibrary(member,{countryCode:'ro',locality:'Synthetic '+randomUUID(),explanation});
  await rejectsCode(decideLibrary(admin,{id:request.id,libraryId:inactive},'LINKED'),'INVALID_LIBRARY');
  await rejectsCode(decideLibrary(admin,{id:request.id,libraryId:archived},'LINKED'),'INVALID_LIBRARY');
  assert.equal((await decideLibrary(admin,{id:request.id,libraryId:active},'LINKED')).libraryId,active);
  await assert.rejects(query('UPDATE libraries SET active=true WHERE id=$1',[archived]),(error:any)=>error?.code==='23514');
  await assert.rejects(query("UPDATE libraries SET country_code='GB' WHERE id=$1",[active]),(error:any)=>error?.code==='23514');
  assert.ok(!(await libraries()).libraries.some(city=>city.id===archived));
});

test('launch readiness requires the 35 active EU cities from the manifest rather than unrelated sources',async()=>{
  await seed();
  assert.equal((await databaseLaunchChecks()).sourcedLibraries,35);
  assert.ok(!(await launchReadiness()).blockers.some(blocker=>blocker.startsWith('Lista inițială')));
  const cluj=(await query("SELECT id,active,rank,country_code FROM libraries WHERE source_id='un-wup2025-city:948'")).rows[0];
  const unrelated=await fixtureLibrary(),archived=await fixtureLibrary();
  try{
    await query('UPDATE libraries SET active=false WHERE id=$1',[cluj.id]);
    await query("UPDATE libraries SET source_id='un-wup2025-city:999998',rank=36 WHERE id=$1",[unrelated]);
    await query("UPDATE libraries SET source_id='un-wup2025-city:999999',rank=37,country_code='GB',active=false WHERE id=$1",[archived]);
    assert.equal((await databaseLaunchChecks()).sourcedLibraries,34);
    const readiness=await launchReadiness();
    assert.ok(readiness.blockers.some(blocker=>blocker.includes('35 de orașe din Uniunea Europeană')));
  }finally{
    await query('UPDATE libraries SET source_id=NULL,rank=NULL WHERE id=ANY($1::uuid[])',[[unrelated,archived]]);
    await query('UPDATE libraries SET active=$2 WHERE id=$1',[cluj.id,cluj.active]);
  }
  assert.equal((await databaseLaunchChecks()).sourcedLibraries,35);
});

test('the EU migration preserves historical references, reuses Cluj aliases and is safe to rerun',async()=>{
  const member=await fixtureMember(),historical=await fixtureLibrary();
  const cluj=(await query("SELECT id FROM libraries WHERE source_id='un-wup2025-city:948'")).rows[0].id;
  const romanianIds=(await query("SELECT id FROM libraries WHERE source_id=ANY($1::text[])",[['un-wup2025-city:948','un-wup2025-city:2553','un-wup2025-city:262']])).rows.map(city=>city.id);
  const originalCluj=(await query('SELECT * FROM libraries WHERE id=$1',[cluj])).rows[0];
  const migration=await readFile(new URL('../../migrations/009_eu_city_scope.sql',import.meta.url),'utf8');
  const body=migration.replace(/^\s*BEGIN;\s*/i,'').replace(/\s*COMMIT;\s*$/i,'');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('ALTER TABLE libraries DROP CONSTRAINT libraries_active_eu_country');
    await client.query("UPDATE libraries SET country_code='GB' WHERE id=$1",[historical]);
    await client.query('UPDATE members SET home_library_id=$2 WHERE id=$1',[member.id,historical]);
    await client.query("UPDATE libraries SET source_id=NULL,name='Cluj',display_name='Cluj',aliases='{}',population=NULL WHERE id=$1",[cluj]);
    await client.query(body);
    const archived=(await client.query('SELECT id,active,rank FROM libraries WHERE id=$1',[historical])).rows[0];
    assert.equal(archived.id,historical);assert.equal(archived.active,false);assert.equal(archived.rank,null);
    assert.equal((await client.query('SELECT home_library_id FROM members WHERE id=$1',[member.id])).rows[0].home_library_id,historical);
    assert.equal((await client.query("SELECT id FROM libraries WHERE source_id='un-wup2025-city:948'")).rows[0].id,cluj);
    const first=(await client.query('SELECT * FROM libraries WHERE id=ANY($1::uuid[]) ORDER BY id',[[historical,...romanianIds]])).rows;
    // ON COMMIT DROP normally removes this helper between migration executions.
    // Drop it inside the test transaction so both executions can be rolled back.
    await client.query('DROP TABLE eu_initial_ranks');
    await client.query(body);
    const second=(await client.query('SELECT * FROM libraries WHERE id=ANY($1::uuid[]) ORDER BY id',[[historical,...romanianIds]])).rows;
    assert.deepEqual(second,first);
    assert.equal((await client.query('SELECT count(*)::int n FROM libraries WHERE source_id=$1',[originalCluj.source_id])).rows[0].n,1);
  }finally{
    await client.query('ROLLBACK');client.release();
  }
});
