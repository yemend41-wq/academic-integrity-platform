import assert from 'node:assert/strict';
import test from 'node:test';
import {displayedOverlap,sourceScope,writingExplanation} from '../ui/report-interpretation.mjs';

test('shows a missing denominator independently of zero matching eligible words in either language',()=>{
  for(const arabic of [true,false]) {
    assert.equal(displayedOverlap({eligibleWords:2594,percentage:0},arabic),'0%');
    assert.notEqual(displayedOverlap({eligibleWords:0,percentage:0},arabic),'0%');
    assert.equal(displayedOverlap({eligibleWords:984,percentage:99.5},arabic),'99.5%');
  }
});
test('distinguishes masked, zero and abstained writing results without disclosing selected words',()=>{
  for(const arabic of [true,false]){
    const states=[{status:'suppressed',display:'*%'},{status:'analyzed',display:'0%'},{status:'insufficient',display:null}];
    const notes=states.map(s=>writingExplanation(s,arabic));assert.equal(new Set(notes).size,3);
    assert.match(notes[0],/20%/);assert.doesNotMatch(notes[1],/20%/);
  }
});
test('states the known number of publications and cohort uploads and preserves unknown scope in a legacy report',()=>{
  const list={sources:[{kind:'paper'},{kind:'publication'},{kind:'cohort'}],cohortCompared:1,cohortWindowLimited:true};
  assert.match(sourceScope(list,false),/publications: 2, cohort submissions: 1/);
  assert.match(sourceScope(list,true),/الأقدم/);
  assert.doesNotMatch(sourceScope({},false),/publications: 0/);
});
