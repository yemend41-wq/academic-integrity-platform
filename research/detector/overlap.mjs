import {tokenize} from './features.mjs';
export function overlapChecker(records){
const inverted=new Map();
function fingerprints(text) {
  const words=tokenize(text).map(w=>w.term);
  const singles=new Set();
  for(let i=0;i+7<=words.length;i++) singles.add(words.slice(i,i+7).join(' '));
  return singles;
}
for(const doc of records) {
  for(const term of fingerprints(doc.text)) {
    if(!inverted.has(term)) inverted.set(term,[]);
    inverted.get(term).push(doc.id);
  }
}
return function overlap(text) {
  const terms=fingerprints(text),counts=new Map();
  for(const phrase of terms) {
    for(const id of inverted.get(phrase)??[]) counts.set(id,(counts.get(id)||0)+1);
  }
  return Math.max(0,...counts.values())/Math.max(1,terms.size);
}
}
