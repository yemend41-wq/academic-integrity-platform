import fs from 'node:fs';
import {detect as baseline} from './baseline-detector.mjs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const detect=process.argv[4]?(await import(pathToFileURL(path.resolve(process.argv[4])))).detect:baseline;
const files=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(x=>JSON.parse(x));
const seen=new Set(); let docs=0,eligible=0,positive=0,numeric=0;
for(const f of files) {
  const merged=[];
  for(let i=0; i<f.labels.length;i++) {
    const label=f.labels[i];
    if(label.type!=='backtranslation') continue;
    const previous=merged.at(-1);
    if(previous && previous.last===i-1 && previous.source===label.src) {
      previous.text+=' '+f.sentences[i];previous.last=i;
    } else merged.push({text:f.sentences[i],source:label.src,last:i});
  }
  if(merged.length) docs++;
  for(const {text} of merged) {
    if(seen.has(text)) continue;
    seen.add(text);
    const r=detect(text);
    if(r.status==='insufficient') continue;
    eligible++;
    if(r.display!=='0%') positive++;
    if(r.display!=='0%' && r.status!=='suppressed') numeric++;
  }
}
const result={source_artifact_documents:files.length,documents_containing_back_translation:docs,distinct_roundtrip_spans:seen.size,
 eligible_spans:eligible,insufficient:seen.size-eligible,any_signal:positive,numeric_signal:numeric,
 scope:'Published OPUS English–German–English round trips of human-source Wikipedia passages. Descriptive model response only. Machine translation of human prose has no binary machine-authorship ground truth.'};
fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
console.log(result);
