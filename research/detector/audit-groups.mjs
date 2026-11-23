import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {overlapChecker} from './overlap.mjs';
const [dir,mode,modelPath,output]=process.argv.slice(2);
const {detect}=await import(pathToFileURL(path.resolve(modelPath)));
const load=file=>fs.readFileSync(path.join(dir,file),'utf8').trim().split('\n').map(l=>JSON.parse(l));
const file=mode==='baseline-ar'?'corpus.jsonl':'challenger.jsonl';
const overlap=overlapChecker(load(file));
const seen=new Set();
const groups={};
let records;
if(mode==='baseline-ar'){
  records=load('ArabicCorpus.jsonl').map(r=>({text:r.document,source:'arabic_public_collection',label:r.label==='ai'?1:0}));
} else {
  records=load('test.jsonl').concat(load('esl.jsonl'));
}
for(const r of records) {
  const key=r.source+'__'+r.label;
  const m=groups[key]??={total:0,overlap:0,insufficient:0,eligible:0,any:0,visible:0};
  m.total++;
  const digest=createHash('sha256').update(r.text).digest('hex');
  if(seen.has(digest)||overlap(r.text)>=.20){m.overlap++;continue;}
  seen.add(digest);
  const d=detect(r.text);
  if(d.status==='insufficient') {m.insufficient++;continue;}
  m.eligible++;
  if(d.display!=='0%') m.any++;
  if(d.display!=='0%'&&d.status!=='suppressed') m.visible++;
}
fs.writeFileSync(output,JSON.stringify(groups,null,2)+'\n');
console.log(groups);
