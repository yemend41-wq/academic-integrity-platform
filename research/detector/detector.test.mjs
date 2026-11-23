import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {detect} from './detector.mjs';
import {tokenize,units,windows} from './features.mjs';
const audit=JSON.parse(fs.readFileSync(new URL('./heldout-audit.json',import.meta.url),'utf8'));

test('an insufficient text yields neither a human label nor a zero percent score',()=>{
  assert.deepEqual(detect('هذا نص قصير لا يحتمل التحليل.').display,null);
  assert.equal(detect('123456 !!').status,'insufficient');
  assert.equal(detect('').flaggedWords,null);
});
test('offsets remain JS string offsets around punctuation, accents and non-BMP characters',()=>{
  const text='📚 مسألةٌ قصيرة. A second sentence about reading. سطر إضافي.';
  const words=tokenize(text);
  assert.equal(text.slice(words[0].start,words[0].end),'مسألةٌ');
  assert.equal(units(text,words).length,3);
});
test('long inputs use overlapping windows tracking the entire text',()=>{
  const words=tokenize(('one two three four five six seven eight nine ten. ').repeat(30));
  const w=windows(words);
  assert.equal(w[0].from,0); assert.equal(w.at(-1).to,300);
  for(let i=1;i<w.length;i++) assert(w[i].from<w[i-1].to);
});
test('each eligible word is tallied at most once and display respects policy',()=>{
  const source=('The community library maintained a reading room for the whole town. ').repeat(200);
  const out=detect(source);
  assert.equal(out.eligibleWords,tokenize(source).length);
  if(out.status==='suppressed') {
    assert.equal(out.flaggedWords,null);assert.deepEqual(out.segments,[]);assert.equal(out.display,'*%');
  } else {
    assert(out.flaggedWords>=0 && out.flaggedWords<=out.eligibleWords);
    assert(out.flaggedWords===0||out.flaggedWords*5>=out.eligibleWords);
    assert(out.segments.every((s,i)=>s.start<s.end&&(i===0||out.segments[i-1].end<=s.start)));
  }
});
test('frozen mixed and unmixed audits include real suppression cases',()=>{
  assert(audit.outcomes.some(r=>r.display==='*%'));
  assert(audit.mixed.some(r=>r.display==='*%'));
});

test('assessment model and release label match the checked-in research card',()=>{
  const card=JSON.parse(fs.readFileSync(new URL('./card.json',import.meta.url),'utf8'));
  assert.equal(detect('قصير').model,'AIP-HL-3');
  assert.equal(card.version,detect('short').model);
  assert.equal(card.production_release,false);
  assert.equal(card.acceptance.false_positive_rate_below_one_percent,'failed');
});
