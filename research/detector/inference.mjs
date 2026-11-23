import {tokenize,windows,units,scoredWindow} from './features.mjs';


export function createDetector(models,version) {
 return function detect(text) {
  const words=tokenize(text);
  const scores=windows(words).map(w=>({...w,score:w.lang?scoredWindow(models[w.lang],words,w):null}));
  let cursor=0, eligibleWords=0, flaggedWords=0;
  const segments=[];
  function center(window) { return (window.from+window.to)/2; }
  for(const unit of units(text,words)) {
    const midpoint=(unit.from+unit.to)/2;
    while(cursor+1<scores.length && Math.abs(center(scores[cursor+1])-midpoint)<Math.abs(center(scores[cursor])-midpoint)) cursor++;
    const window=scores[cursor];
    if(!window?.lang) continue;
    const count=unit.to-unit.from;
    eligibleWords+=count;
    const flagged=window.score>models[window.lang].threshold;
    if(flagged) flaggedWords+=count;
    segments.push({start:unit.start,end:unit.end,flagged,lang:window.lang});
  }
  if(!eligibleWords) return {status:'insufficient',display:null,segments:[],eligibleWords:0,flaggedWords:null,model:version};
  const pct=flaggedWords?Math.max(1,Math.round(100*flaggedWords/eligibleWords)):0;
  const suppressed=flaggedWords>0 && flaggedWords*5<eligibleWords;
  return {status:suppressed?'suppressed':'analyzed',display:suppressed?'*%':pct+'%',
    segments:suppressed?[]:segments,eligibleWords,flaggedWords:suppressed?null:flaggedWords,model:version};
};
}
