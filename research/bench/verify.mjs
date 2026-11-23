// Exercise the real deployment parser on the binaries in the benchmark record.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectFile } from '../media/index.mjs';
import { maskPII } from '../../src/privacy.mjs';

const base=new URL('./', import.meta.url);
const read=(name,enc)=>readFile(new URL(name,base),enc);
const {files}=JSON.parse(await read('fixtures/manifest.json','utf8'));
const reference=(await read('source/melville-excerpt.txt','utf8')).trim().split(/\s+/u);
const observations=[];
for(const item of files){
  const bytes=await read('fixtures/'+item.file);
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest,item.sha256);
  const t=performance.now();
  const analysis=await inspectFile(new Uint8Array(bytes),item.file);
  const ms=+(performance.now()-t).toFixed(3);
  assert.equal(analysis.format.toLowerCase(),item.format);
  let checks;
  if(item.words){
    const words=analysis.text.trim().split(/\s+/u);
    assert.equal(words.length,item.words);
    assert.deepEqual(words,reference);
    checks={extractedWords:words.length,exactTokenRoundTrip:true};
  }else{
    const f=analysis.forensics;
    assert.equal(f.zeroWidthCharacters,1);
    assert.equal(f.hiddenTextRuns,1);
    assert.equal(f.whiteTextRuns,1);
    assert.equal(f.paraIdDiversity,7);
    assert.equal(f.usSpellingTokens,2);
    assert.equal(f.ukSpellingTokens,2);
    assert.match(analysis.text,/جمع الفريق ثلاث عينات/u);
    const masked=maskPII(analysis.text);
    assert.doesNotMatch(masked,/pen@example\.invalid|AA123456/);
    assert.equal(masked.length,analysis.text.length);
    checks={zeroWidth:f.zeroWidthCharacters,hiddenRuns:f.hiddenTextRuns,whiteRuns:f.whiteTextRuns,paragraphIds:f.paraIdDiversity,
      usExamples:f.usSpellingTokens,ukExamples:f.ukSpellingTokens,syntheticEmailAndStudentIdMasked:true};
  }
  observations.push({file:item.file,sha256:digest,bytes:bytes.length,parserWallMs:ms,checks});
}
console.log(JSON.stringify({scope:'Local Node, deployed source parser and redactor; no network or end-to-end SLA conclusion',
  at:new Date().toISOString(),runtime:process.version,observations},null,2));
