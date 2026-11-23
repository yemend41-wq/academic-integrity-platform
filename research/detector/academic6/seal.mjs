import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {maskPII} from '../../../src/privacy.mjs';
import {tokenize} from '../features.mjs';

const [privateDir,manifestFile]=process.argv.slice(2);
const manifest=JSON.parse(fs.readFileSync(manifestFile));
const sha=x=>createHash('sha256').update(x).digest('hex');
function read(name) {
  const bytes=fs.readFileSync(path.join(privateDir,name));
  assert.equal(sha(bytes),manifest.inputFiles[name]);
  return bytes.length ? bytes.toString().trimEnd().split('\n').map(JSON.parse) : [];
}
const answers=new Map(read('truth.jsonl').map(r=>[r.id,r]));
const primary=new Set(read('primary-input.jsonl').map(r=>r.id));
const prepared=read('all-input.jsonl');
let changed=0;
for(const row of prepared){
  const original=row.text;
  row.text=maskPII(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(original)));
  if(row.text!==original)changed++;
  const truth=answers.get(row.id);
  if(truth.cohort!=='mixed')continue;
  const words=tokenize(row.text); let generated=0;
  assert.equal(words.length,manifest.expectedWords??80);
  for(const p of truth.paragraphs){
    const inside=words.filter(w=>w.start>=p.start&&w.end<=p.end);
    assert.equal(inside.length,manifest.expectedParagraphWords??20);
    if(p.machine)generated+=inside.length;
  }
  assert.equal(100*generated/words.length,truth.truthPercentage);
}
const escapeLine=r=>JSON.stringify(r).replace(/[^\u0000-\u007F]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'))+'\n';
const outputs={};
for(const [name,records] of [['sealed-primary.jsonl',prepared.filter(r=>primary.has(r.id))],['sealed-all.jsonl',prepared]]){
  const bytes=records.map(escapeLine).join('');
  fs.writeFileSync(path.join(privateDir,name),bytes);outputs[name]=sha(bytes);
}
manifest.maskedInputs=outputs;manifest.privacyModified=changed;manifest.verifiedMixedParagraphs=4*[...answers.values()].filter(r=>r.cohort==='mixed').length;
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
