import test from "node:test";
import assert from "node:assert/strict";
import { initialPolicySlugs,parseReviewedPolicy } from "../../src/lib/legal-publication.ts";
test("initial publication requires all eight canonical documents and keeps Romanian reviewed text",()=>{
  assert.equal(new Set(initialPolicySlugs).size,8);
  const content="# Termeni revizuiți\n\n"+"Text sintetic revizuit de operator pentru testare, fără aprobare juridică reală. ".repeat(3);
  const result=parseReviewedPolicy("termeni",content);assert.equal(result.title,"Termeni revizuiți");assert.match(result.body,/fără aprobare juridică/);
});
test("draft markers, unresolved operator fields and unknown document identifiers fail closed",()=>{
  const body="Explicație sintetică pentru un document de test. ".repeat(5);
  for(const content of [`# Termeni\n\nPROIECT — necesită revizuire.\n${body}`,`# Termeni\n\n${body}\n[OPERATOR_NAME]`,`# Termeni\n\n${body}\n{{operator}}`]) assert.throws(()=>parseReviewedPolicy("termeni",content));
  assert.throws(()=>parseReviewedPolicy("unapproved-policy",`# Document\n\n${body}`));assert.throws(()=>parseReviewedPolicy("termeni","# Termeni\n\nScurt."));
});
test("malformed and oversized policy files cannot become published text",()=>{
  assert.throws(()=>parseReviewedPolicy("termeni","Termeni\n\n"+"Text de test. ".repeat(30)));
  assert.throws(()=>parseReviewedPolicy("termeni","# Termeni\n\n"+"x".repeat(70000)));
  assert.throws(()=>parseReviewedPolicy("termeni","# Termeni\n\n"+"Text\0de test. ".repeat(30)));
});
