import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {overlapChecker} from './overlap.mjs';
const [root,model,output]=process.argv.slice(2);
const {detect}=await import(pathToFileURL(path.resolve(model)));
const json=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const lines=file=>fs.readFileSync(path.join(root,file),'utf8').trim().split('\n').map(s=>JSON.parse(s));
const overlap=overlapChecker(lines('arabic-challenger.jsonl').filter(r=>r.lang==='ar'));
const groups={}, seen=new Set();
function examine(text,cohort,domain) {
  const count=groups[cohort]??={total:0,excluded:0,abstained:0,eligible:0,any:0,visible:0,domains:{}};
  const subgroup=count.domains[domain]??={eligible:0,any:0};
  count.total++;
  const key=cohort+'-'+createHash('sha256').update(text).digest('hex');
  if(seen.has(key)||overlap(text)>=.20) {count.excluded++;return;}
  seen.add(key);
  const result=detect(text);
  if(result.status==='insufficient') {count.abstained++;return;}
  count.eligible++;subgroup.eligible++;
  if(result.display!=='0%') {count.any++;subgroup.any++;}
  if(result.display!=='0%'&&result.status!=='suppressed') count.visible++;
}
for(const r of json('apt-ai.json')) {
  if(r['AI/Human']!=='AI') throw new Error('Unknown Ar-APT source class');
  examine(r.original,'ar_apt_machine',r.domain);
}
for(const r of json('apt-human-polished.json')) {
  examine(r.original,'ar_apt_human',r.domain);
  examine(r.Polish_text,'ar_apt_assisted',r.domain);
}
for(const r of lines('academic-ar.jsonl')) {
  examine(r.original_abstract,'academic_human','abstract');
  examine(r.generated_abstract,'academic_assisted','abstract');
}
for(const r of lines('ArabicCorpus.jsonl')) examine(r.document,'oqn_'+r.label,'unspecified');
fs.writeFileSync(output,JSON.stringify(groups,null,2)+'\n');
for(const [name,r] of Object.entries(groups)) console.log(name,r.eligible,r.any,r.visible);
