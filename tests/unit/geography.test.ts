import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import manifest from '../../data/cities.manifest.json';
import countries from '../../data/eu-countries.json';
import {EU_COUNTRY_CODES,isEuCountry,validateCities,type CityManifest} from '../../src/domain/geography.ts';

test('EU eligibility includes all 27 members and excludes non-member European countries',()=>{
  assert.equal(EU_COUNTRY_CODES.length,27);
  assert.equal(new Set(EU_COUNTRY_CODES).size,27);
  assert.deepEqual([...Object.values(countries.m49_to_iso)].sort(),[...EU_COUNTRY_CODES].sort());
  for(const code of ['RO','DE','FR','CY','HR'])assert.equal(isEuCountry(code),true);
  for(const code of ['GB','TR','RU','UA','RS','NO','CH','US','ro',''])assert.equal(isEuCountry(code),false);
});

test('the sourced manifest retains the EU selection and adds the three Romanian cities',()=>{
  const cities=validateCities(manifest as CityManifest);
  assert.equal(cities.length,35);
  assert.ok(cities.every(city=>isEuCountry(city.country_code)));
  for(const [id,name,alias] of [
    ['un-wup2025-city:948','Cluj-Napoca','Cluj'],
    ['un-wup2025-city:2553','Iași','Iasi'],
    ['un-wup2025-city:262','Timișoara','Timisoara'],
  ]){
    const city=cities.find(candidate=>candidate.source_id===id);
    assert.equal(city?.display_name,name);
    assert.ok(city?.aliases.includes(alias));
    assert.equal(city?.country_code,'RO');
  }
});

test('seed validation rejects non-EU injection, missing cities and inconsistent source metadata',()=>{
  const valid=manifest as CityManifest;
  const changed=(patch:Partial<CityManifest>)=>({...structuredClone(valid),...patch});
  assert.throws(()=>validateCities(changed({geography_scope:'Europe'})));
  const nonEu=structuredClone(valid);nonEu.cities[0].country_code='GB';
  assert.throws(()=>validateCities(nonEu),/European Union/);
  assert.throws(()=>validateCities(changed({cities:valid.cities.slice(0,-1)})));
  const duplicate=structuredClone(valid);duplicate.cities[1].source_id=duplicate.cities[0].source_id;
  assert.throws(()=>validateCities(duplicate),/identifier/);
  const inconsistent=structuredClone(valid);inconsistent.cities[0].retrieval_date='2025-01-01';
  assert.throws(()=>validateCities(inconsistent),/provenance/);
});

test('the upgrade constraint uses the same EU allowlist as the domain and extractor',async()=>{
  const sql=await readFile(new URL('../../migrations/009_eu_city_scope.sql',import.meta.url),'utf8');
  const match=sql.match(/CHECK \(NOT active OR country_code::text=ANY\(ARRAY\[([^\]]+)\]::text\[\]\)\)/);
  assert.ok(match);
  const codes=[...match[1].matchAll(/'([A-Z]{2})'/g)].map(entry=>entry[1]);
  assert.deepEqual(codes,[...EU_COUNTRY_CODES]);
});
