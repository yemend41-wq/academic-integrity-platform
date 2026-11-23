import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {detect as baseline} from './baseline-detector.mjs';
import {pathToFileURL} from 'node:url';
const detect=process.argv[4]?(await import(pathToFileURL(path.resolve(process.argv[4])))).detect:baseline;
import {overlapChecker} from './overlap.mjs';
const dir=process.argv[2];
const records=fs.readFileSync(path.join(dir,process.argv[4]?'arabic-challenger.jsonl':'corpus.jsonl'),'utf8').trim().split('\n').map(r=>JSON.parse(r));
const overlap=overlapChecker(records);
const cohorts=[
  ['TOEFL_real_91','human','Non-native English TOEFL'],
  ['HewlettStudentEssay_real_88','human','US eighth grade essays'],
  ['CollegeEssay_real_70','human','US college application essays'],
  ['CS224N_real_145','human','course abstracts'],
  ['CollegeEssay_gpt3_31','machine','Generated college essays'],
  ['CollegeEssay_gpt3PromptEng_31','machine_rewritten','Rewritten generated college essays'],
  ['CS224N_gpt3_145','machine','Generated abstracts'],
  ['CS224N_gpt3PromptEng_145','machine_rewritten','Rewritten generated abstracts'],
  ['HewlettStudentEssay_GPTsimplify_88','mixed','Simplified human essays'],
  ['TOEFL_gpt4polished_91','mixed','Polished human essays'],
];
const cohortResults={}, rows=[];
for(const [id,origin,description] of cohorts) {
  const input=fs.readFileSync(path.join(dir,id+'.json'));
  const samples=JSON.parse(input),seen=new Set();
  let duplicate=0, abstained=0, any=0, numeric=0;
  for(const [i,{document}] of samples.entries()) {
    const fingerprint=createHash('sha256').update(document).digest('hex');
    if(seen.has(fingerprint)||overlap(document)>=.20) { duplicate++; continue; }
    seen.add(fingerprint);
    const result=detect(document);
    if(result.status==='insufficient') abstained++;
    else if(result.display!=='0%') {
      any++;
      if(result.status!=='suppressed') numeric++;
    }
    rows.push({cohort:id,index:i,sha256:fingerprint,display:result.display});
  }
  cohortResults[id]={origin,description,source_sha256:createHash('sha256').update(input).digest('hex'),
    total:samples.length,excluded_as_duplicates_or_overlap:duplicate,abstained,eligible:samples.length-duplicate-abstained,
    flagged_including_suppressed:any,flagged_at_least_20_percent:numeric};
}
fs.writeFileSync(process.argv[3],JSON.stringify(cohortResults,null,2)+'\n');
fs.writeFileSync(path.join(dir,'external-row-results.json'),JSON.stringify(rows));
