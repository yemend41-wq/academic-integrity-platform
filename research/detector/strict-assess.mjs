// All evaluation sources are distinct from calibration cohorts. Texts are
// removed from the holdout when seven-word overlap against a previously
// used document is at least 20 percent.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {overlapChecker} from './overlap.mjs';
const [dir,strictPath,controlPath,output]=process.argv.slice(2);
const strict=(await import(pathToFileURL(path.resolve(strictPath)))).detect;
const control=(await import(pathToFileURL(path.resolve(controlPath)))).detect;
const lines=n=>fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').map(s=>JSON.parse(s));
const load=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const holdout=lines('strict-holdout.jsonl');
const records={strict:{},control:{}};
for(const lang of ['ar','en']) {
 const docs=lines('arabic-challenger.jsonl').filter(r=>r.lang===lang);
 if(lang==='ar'){
  for(const r of lines('academic-ar.jsonl')) docs.push({text:r.original_abstract},{text:r.generated_abstract});
  for(const r of lines('ArabicCorpus.jsonl')) docs.push({text:r.document});
  for(const r of load('apt-ai.json')) docs.push({text:r.original});
  for(const r of load('apt-human-polished.json'))docs.push({text:r.original},{text:r.Polish_text});
 }else{
  for(const r of [...lines('test.jsonl'),...lines('esl.jsonl')])docs.push({text:r.text});
  for(const f of fs.readdirSync(dir).filter(n=>/^(CollegeEssay_|CS224N_|HewlettStudentEssay_|TOEFL_).+\.json$/.test(n)))for(const r of load(f))docs.push({text:r.document});
 }
 const overlap=overlapChecker(docs);
 const seen=new Set();
 for(const r of holdout.filter(r=>r.lang===lang)) {
  const h=createHash('sha256').update(r.text.trim()).digest('hex');
  const duplicate=seen.has(h)||overlap(r.text)>=.20;
  seen.add(h);
  for(const [key,measure] of [['strict',strict],['control',control]]) {
   const g=records[key][r.cohort]??={lang,label:r.label,total:0,overlap:0,abstained:0,eligible:0,any:0,visible:0,subsets:{}};
   const s=g.subsets[r.subset]??={eligible:0,any:0};
   g.total++;
   if(duplicate) {g.overlap++;continue;}
   const result=measure(r.text);
   if(result.status==='insufficient'){g.abstained++;continue;}
   g.eligible++;s.eligible++;
   if(result.display!=='0%'){g.any++;s.any++;}
   if(result.display!=='0%'&&result.status!=='suppressed')g.visible++;
  }
 }
}
fs.writeFileSync(output,JSON.stringify(records,null,2)+'\n');
for(const kind of Object.keys(records))for(const [n,r] of Object.entries(records[kind]))console.log(kind,n,r.any,r.eligible,'abstentions',r.abstained,'overlap',r.overlap);
