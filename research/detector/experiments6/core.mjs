import {tokenize,units,windows,scoredWindow} from '../features.mjs';
import {models as previousModels} from '../weights.mjs';

export const dimension=16384;
const initial=2166136261;
const extend=(h,c)=>Math.imul(h^c,16777619)>>>0;
function slot(s) {
  let h=initial;
  for(let i=0;i<s.length;i++) h=extend(h,s.charCodeAt(i));
  return h&(dimension-1);
}
function wordCodes(term){
  const marks='^'+term+'$';
  const codes=[];
  for(let i=0;i<marks.length-1;i++){
    let h=initial;
    for(let k=i;k<Math.min(i+5,marks.length);k++){
      h=extend(h,marks.charCodeAt(k));
      if(k>i)codes.push(h&(dimension-1));
    }
  }
  return codes;
}
const styleWord=t=>t.length<=3?t:t.slice(0,1)+'#'+t.slice(-1);
const letters=/[.!?؟\n]/u;
const bands=[0,.015,.035,.08,.15,.30,.50,.75,1,Infinity];
const band=x=>bands.findIndex(y=>x<=y);
export function encode(text,words,w,cache){
  const counts=new Map(),seen=new Set();
  const add=(j,v=1)=>counts.set(j,(counts.get(j)||0)+v);
  let prior='',paragraph=0,breaks=0;
  const lengths=[];
  const gapCounts=new Map();
  for(let i=w.from;i<w.to;i++){
    const word=words[i],t=word.term;
    let codes=cache.get(t);
    if(!codes){codes=wordCodes(t);cache.set(t,codes);}
    for(const j of codes) add(j);
    const shape=styleWord(t);add(slot('L'+Math.min(t.length,18)),2);
    if (prior) add(slot('T'+prior+'/'+shape));
    seen.add(t);
    const gap=text.slice(word.end,i+1<w.to?words[i+1].start:word.end);
    for(const ch of gap){
      if (!',،;؛:«»"”“‘’-()/’.?!؟\n'.includes(ch))continue;
      gapCounts.set(ch,(gapCounts.get(ch)||0)+1);
    }
    paragraph++;
    if(letters.test(gap)){lengths.push(paragraph);paragraph=0;breaks++;prior='';}
    else prior=shape;
  }
  if(paragraph)lengths.push(paragraph);
  const n=w.to-w.from;
  add(slot('D'+band(seen.size/n)),4);
  add(slot('Z'+band(breaks/n)),4);
  for(const span of lengths)add(slot('S'+Math.min(18,Math.floor(span/4))),3);
  for(const mark of ',،;؛:«»"”“‘’-()/’.?!؟\n')add(slot('P'+mark+band((gapCounts.get(mark)||0)/n)),3);
  let scale=0;
  for(const [j,c] of counts){const val=1+Math.log(c);counts.set(j,val);scale+=val*val;}
  scale=Math.sqrt(scale)||1;
  return Array.from(counts,([j,v])=>[j,v/scale]);
}
export function stack(rawNew,rawOld,entry){
  const centered=(rawNew-entry.newMedian)/entry.newIqr;
  return [centered,.5*centered+.5*((rawOld-entry.oldMedian)/entry.oldIqr)];
}
export function quantile(xs,q){
  const sorted=[...xs].sort((a,b)=>a-b);return sorted[Math.ceil(q*(xs.length-1))];
}
function pack(result){return {...result,segments:result.status==='suppressed'?[]:result.segments};}
function unpack(bytes,n,scale){
  const buf=Uint8Array.from(atob(bytes),x=>x.charCodeAt(0));
  if(buf.length!==2*n)throw new Error('Coefficient size mismatch');
  const view=new DataView(buf.buffer);return Float64Array.from({length:n},(_,i)=>scale*view.getInt16(2*i,true));
}
export function createPair(model){
  const levels={};
  for(const l of ['ar','en']){
    const e=model.languages[l];levels[l]={...e,weights:unpack(e.coefficients,dimension,e.scale)};
  }
  // Each call exposes both independent results without making per-request changes to weights.
  return function scoreBoth(text){
    const words=tokenize(text),cache=new Map();
    const list=windows(words).map(w=>{
      if(!w.lang)return {...w,scores:[null,null]};
      const e=levels[w.lang];let margin=e.bias;
      for(const [j,v] of encode(text,words,w,cache))margin+=v*e.weights[j];
      return {...w,scores:stack(margin,scoredWindow(previousModels[w.lang],words,w),e)};
    });
    const docGates={};
    for(const l of ['ar','en']){
      const rows=list.filter(w=>w.lang===l);
      docGates[l]=[0,1].map(i=>{
        const xs=rows.map(w=>w.scores[i]);
        return xs.length>0 && .5*quantile(xs,.5)+.5*quantile(xs,.9)>levels[l].thresholds[i].document;
      });
    }
    let cursor=0,eligibleWords=0;const flagged=[0,0],spans=[[],[]];
    const center=o=>(o.from+o.to)/2;
    for(const s of units(text,words)){
      while(cursor+1<list.length && Math.abs(center(list[cursor+1])-center(s))<Math.abs(center(list[cursor])-center(s))) cursor++;
      const w=list[cursor];if(!w?.lang)continue;
      const n=s.to-s.from;eligibleWords+=n;
      for(const i of [0,1]){
        const yes=docGates[w.lang][i] && w.scores[i]>levels[w.lang].thresholds[i].local;
        if(yes)flagged[i]+=n;
        spans[i].push({start:s.start,end:s.end,lang:w.lang,flagged:yes});
      }
    }
    return model.versions.map((version,i)=>{
      if(!eligibleWords)return {model:version,status:'insufficient',eligibleWords:0,flaggedWords:null,display:null,segments:[]};
      const hidden=flagged[i]>0 && 5*flagged[i]<eligibleWords;
      return pack({model:version,eligibleWords,flaggedWords:hidden?null:flagged[i],status:hidden?'suppressed':'analyzed',
        display:hidden?'*%':(flagged[i]?Math.max(1,Math.round(100*flagged[i]/eligibleWords)):0)+'%',segments:spans[i]});
    });
  };
}
