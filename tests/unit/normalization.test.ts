import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,authorKey,isbnCanonical,candidateConfidence,editionFingerprint,safeHref} from '../../src/domain/normalization.ts';

test('Romanian comma/cedilla accents, case and punctuation preserve one search key',()=>{
  assert.equal(normalize('Știință, Ţară — ştiinţă'),normalize('stiinta tara stiinta'));
  assert.equal(normalize('  La  RĂSCRUCE de VÂNTURI! '),'la rascruce de vanturi');
});
test('all four required Wuthering Heights variants find the same credible work',()=>{
  const work={id:'synthetic-work',title:'La răscruce de vânturi',authors:['Emily Brontë']};
  for(const query of ['La rascruce de vanturi','La Rascruce de Vanturi','La rascruce de vanturi Emily Bronte','La răscruce de vânturi — Emily Brontë'])assert.ok(candidateConfidence(query,work)>=.92,query);
});
test('author evidence distinguishes same-title different-author candidates',()=>{
  const query='La răscruce de vânturi Emily Bronte';
  assert.equal(candidateConfidence(query,{id:'emily',title:'La răscruce de vânturi',authors:['Emily Brontë']}),1);
  assert.ok(candidateConfidence(query,{id:'other',title:'La răscruce de vânturi',authors:['Alt autor']})<.9);
  assert.equal(authorKey(['Brontë, Emily']),authorKey(['Emily Bronte']));
});
test('valid ISBN-10 and ISBN-13 map to one edition identifier',()=>{
  assert.equal(isbnCanonical('0-306-40615-2'),'9780306406157');
  assert.equal(isbnCanonical('978 0 306 40615 7'),'9780306406157');
});
test('invalid checksums, wrong prefixes and non-ISBN EANs are rejected',()=>{
  for(const value of ['9780306406158','0000000000000','4006381333931','ISBN-not-a-number'])assert.throws(()=>isbnCanonical(value));
  assert.equal(isbnCanonical(''),null);
});
test('different volumes, translation metadata and abridgement remain distinct',()=>{
  const base={language:'ro',publisher:'Editură de test',year:2020,translator:'Traducător de test'};
  assert.notEqual(editionFingerprint({...base,volume:'1'}),editionFingerprint({...base,volume:'2'}));
  assert.notEqual(editionFingerprint({...base,abridged:true}),editionFingerprint({...base,abridged:false}));
  assert.notEqual(editionFingerprint(base),editionFingerprint({...base,translator:'Alt traducător'}));
});
test('unspecified editions still preserve known volume and language distinctions',()=>{
  const base={language:'ro',unspecified:true};
  assert.notEqual(editionFingerprint({...base,volume:'1'}),editionFingerprint({...base,volume:'2'}));
  assert.notEqual(editionFingerprint(base),editionFingerprint({...base,language:'ro-bilingual'}));
  assert.notEqual(editionFingerprint(base),editionFingerprint({...base,abridged:false}));
});
test('edition fingerprint canonicalises equivalent ISBN representations',()=>{
  assert.equal(editionFingerprint({language:'ro',isbn:'0306406152'}),editionFingerprint({language:'ro',isbn:'9780306406157'}));
});
test('safe links reject executable/data protocols and relative user input',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,test','/private','//example.org'])assert.equal(safeHref(value),null);
  assert.equal(safeHref('https://example.org/books'),'https://example.org/books');
});
