// All offsets refer to UTF-16 code units, as used by JavaScript String.slice.
export const DIMS = 8192;
export const MIN_WORDS = 48;
const WINDOW = 96;
const STEP = 32;
const isArabic = /\p{Script=Arabic}/u;
const isLatin = /\p{Script=Latin}/u;
const letterWord = /\p{L}[\p{L}\p{M}]*(?:['’][\p{L}\p{M}]+)*/gu;

function canonical(word) {
  return word.toLowerCase().normalize('NFKD').replace(/\p{M}|ـ/gu,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي');
}

export function tokenize(text) {
  const words=[];
  for (const match of text.matchAll(letterWord)) {
    const term=canonical(match[0]);
    if (!term) continue;
    words.push({term, start:match.index, end:match.index+match[0].length,
      lang:isArabic.test(term)?'ar':isLatin.test(term)?'en':'other'});
  }
  return words;
}

function hash(term) {
  let result=2166136261;
  for (let i=0; i<term.length; i++) result=Math.imul(result^term.charCodeAt(i),16777619);
  return (result>>>0)%DIMS;
}

export function vector(words, from, to) {
  const counts=new Map();
  function add(term) {
    const id=hash(term);
    counts.set(id,(counts.get(id)||0)+1);
  }
  for (let i=from; i<to; i++) {
    const word=words[i].term;
    add('w:'+word);
    if(i>from) add('b:'+words[i-1].term+' '+word);
    if(word.length>=4) {
      add('p:'+word.slice(0,2)); add('s:'+word.slice(-2)); add('s:'+word.slice(-3));
    }
  }
  let norm=0;
  for(const [id,count] of counts) {
    const weight=1+Math.log(count);
    counts.set(id,weight); norm+=weight*weight;
  }
  const divisor=Math.sqrt(norm)||1;
  return Array.from(counts,([id,count])=>[id,count/divisor]);
}

export function windows(words) {
  if(words.length<MIN_WORDS) return [];
  const starts=[0], last=Math.max(0,words.length-WINDOW);
  for(let from=STEP;from<last;from+=STEP) starts.push(from);
  if(last>0) starts.push(last);
  return starts.map(from=>{
    const to=Math.min(from+WINDOW,words.length);
    let ar=0,en=0;
    for(let i=from;i<to;i++) {
      if(words[i].lang==='ar') ar++;
      if(words[i].lang==='en') en++;
    }
    const lang=ar/(to-from)>=0.70?'ar':en/(to-from)>=0.70?'en':null;
    return {from,to,lang};
  });
}

// Identify sentence boundaries inside a document without assigning every
// constituent token a separate independent statistical observation.
export function units(text,words) {
  const result=[];
  let from=0;
  for(let i=0;i<words.length;i++) {
    const gap=text.slice(words[i].end,words[i+1]?.start??text.length);
    if(i===words.length-1 || /[.!?؟\n]/u.test(gap) || i-from+1>=64) {
      result.push({from,to:i+1,start:words[from].start,end:words[i].end});
      from=i+1;
    }
  }
  return result;
}

export function scoredWindow(model, words, window) {
  let raw=model.bias;
  for (const [id,value] of vector(words,window.from,window.to)) raw+=model.weights[id]*value;
  return raw;
}
