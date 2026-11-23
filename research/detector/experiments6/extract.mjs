import fs from 'node:fs';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {tokenize,windows,scoredWindow} from '../features.mjs';
import {models as oldModels} from '../weights.mjs';
import {encode} from './core.mjs';
const input=createInterface({input:fs.createReadStream(process.argv[2],'utf8'),crlfDelay:Infinity});
const out=fs.createWriteStream(process.argv[3]);let total=0;
for await(const line of input){
  const {text,lang,publisher,partition,label}=JSON.parse(line);
  const words=tokenize(text),cache=new Map();
  let ws=windows(words).filter(w=>w.lang===lang);
  if(partition==='train' && ws.length>3)ws=[ws[0],ws[Math.round((ws.length-1)/2)],ws.at(-1)];
  const header={lang,publisher,partition,label,count:ws.length,old:partition==='train'?[]:ws.map(w=>scoredWindow(oldModels[lang],words,w))};
  if(!out.write(JSON.stringify(header)+'\n'))await once(out,'drain');
  for(const w of ws){
    const val=encode(text,words,w,cache),b=Buffer.allocUnsafe(4+6*val.length);
    b.writeUInt32LE(val.length,0);
    for(let i=0;i<val.length;i++){b.writeUInt16LE(val[i][0],4+6*i);b.writeFloatLE(val[i][1],6+6*i);}
    if(!out.write(b))await once(out,'drain');
  }
  if(++total%2000===0)process.stderr.write(total+' docs\n');
}
out.end();await once(out,'finish');
