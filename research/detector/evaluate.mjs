import fs from 'node:fs';
import {detect as baseline} from './baseline-detector.mjs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const detect=process.argv[4]?(await import(pathToFileURL(path.resolve(process.argv[4])))).detect:baseline;
import {tokenize} from './features.mjs';
const rows=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(z=>JSON.parse(z));
const isFlag=r=>r.display!==null && r.display!=='0%';
const outcomes=[];
const mixed=[];
for(const x of rows.filter(r=>r.split==='test')) {
  const res=detect(x.text);
  outcomes.push({id:x.id,lang:x.lang,label:x.label,group:x.group,sha256:x.sha256,
    eligible:res.eligibleWords>0,anySignal:isFlag(res),visibleNumeric:res.status==='analyzed'&&isFlag(res),display:res.display});
}
// Controlled mixed documents combine contiguous blocks of authentic held-out text
// with actual machine text. Each underlying source may recur across mixture ratios.
for(const lang of ['ar','en']) {
  const pool=rows.filter(r=>r.split==='test'&&r.lang===lang);
  const humans=pool.filter(r=>r.label===0);
  const ai=pool.filter(r=>r.label===1);
  for(let i=0;i<Math.min(humans.length,ai.length);i++) {
    const human=humans[i], machine=ai[i];
    const h=tokenize(human.text), a=tokenize(machine.text);
    const total=Math.min(h.length,a.length,320);
    if(total<96) continue;
    for(const fraction of [.25,.5,.75]) {
      const m=Math.round(total*fraction), n=total-m;
      const humanPart=human.text.slice(h[0].start,h[n-1].end);
      const aiPart=machine.text.slice(a[0].start,a[m-1].end);
      const testText=i%2?humanPart+'. '+aiPart:aiPart+'. '+humanPart;
      const res=detect(testText);
      mixed.push({human:human.id,machine:machine.id,lang,total,aiWords:m,fraction,display:res.display});
    }
  }
}
fs.writeFileSync(process.argv[3],JSON.stringify({outcomes,mixed}));
