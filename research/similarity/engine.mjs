import { PUBLIC_SOURCES } from "./sources.mjs";
import { terms, bytes, senses, dimensions, stop } from "./model.mjs";

const weights = new Int8Array(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)).buffer);
const vocabulary = new Map(terms.map((s, i) => [s, i]));
const stopwords = new Set(stop);
const width = 5;
const compiledPublic = new Map();
const lexicalGroups = `
investigate investigate investigated investigating examine examined studying study explore explored استكشف فحص درس بحث دراسة بحثت تناولت
student students pupil pupils learner learners طالب طلاب طلبة متعلم متعلمين تلاميذ
questionnaire questionnaires survey surveys inventory استبانة استبيان استمارة
sample samples sampled عينة عينات
respondent respondents participant participants مشارك مشاركين مشاركون مستجيب مستجيبين
method methods methodology approach techniques procedures techniques منهج منهجية اسلوب اساليب طريقة طرق
improve improves improving improve improved enhance enhances enhancing تحسين يحسن تحسن تطوير تعزيز
decrease decreases reduce reduces reduction خفض تقليل تخفيض قلل
increase increases raised rise growth تزايد تزايدت زيادة ارتفاع
researcher researchers investigator investigators scientist scientists باحث باحثون باحثين علماء
finding findings result results outcome outcomes نتيجة نتائج حصيلة مخرجات
education educational instruction تدريس تعليم تعلم تعليمي تعليمية
detect detects detection identify identifies discover recognize كشف اكتشاف رصد تحديد
text texts نص نصوص
document documents papers manuscript manuscripts وثيقة وثائق مستند مستندات مخطوطة
convert converting converts conversion transform transformation تحول تحويل يحول
language languages linguistic لغوي لغوية لغة لغات
tool tools toolkit utility utilities اداة ادوات
program module modules component components وحدة وحدات مكون مكونات
normalization normalisation normalize normalise تطبيع توحيد
provide provides providing offer offers supply supplies تقدم يوفر توفير تقدم
basic fundamental essential primary elementary اساسي اساسية رئيسي اولي
quick rapid fast بسرعة سريع سريعة
purchase bought acquire buy شراء اقتناء اشتري
car automobile vehicle سيارة مركبة
remove removing removal eliminate deletion حذف ازالة
report reports reported reporting show shows reveal showed indicate indicated found اظهر اظهرت بينت توصلت اشارت
accuracy precision دقة
use uses employ employed utilized using usage استخدام استعمال استخدم
artificial اصطناعي اصطناعية
writing written written كتابة
sentence sentences جملة جمل
word words كلمة كلمات
freedom liberty حرية
right rights entitlement حق حقوق
equality equal equally مساواة متساوون متساوين
privacy confidentiality خصوصية سرية
quality جودة نوعية
time duration مدة زمن وقت
teacher teachers educator educators معلمات معلمون مدرسين معلمين
rural countryside ريف ريفية
hospital hospitals مستشفي مستشفيات
health healthcare medical صحة صحية طب طبي
water مياه ماء
energy power طاقة
measure measurement measured measurements قياس قاس قياسات
`.trim().split(/\n/);
const commonConcept = new Map();
for (const [n, group] of lexicalGroups.entries()) for (const word of group.trim().split(/\s+/)) commonConcept.set(normalize(word), n);

function normalize(s) {
  return s.normalize("NFKD").toLowerCase().replace(/\p{M}/gu,"").replaceAll("ـ","").replaceAll("ى","ي").replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
}
function lookup(term) {
  const variants = [term];
  if (/^[\u0621-\u064a]/.test(term)) {
    const bare = term.replace(/^(?:وال|بال|فال|كال|لل|ال)(?=.{3})/u,"");
    variants.push(bare, bare.replace(/^و(?=.{3})/u,""), term.replace(/^و(?=.{3})/u,""));
    if(bare.endsWith("ا") && bare.length>4) variants.push(bare.slice(0,-1));
  } else {
    if (term.endsWith("ies")) variants.push(term.slice(0,-3)+"y");
    if (term.length>4 && term.endsWith("s")) variants.push(term.slice(0,-1));
  }
  return variants;
}
// Alignment keys are used only for semantic screening. Exact offsets and exact tokens
// stay untouched. Stemming is deliberately light to avoid collapsing short Arabic roots.
const alignmentStop = new Set([...stopwords, "as", "by", "while", "there", "being",
  "some", "also", "into", "then", "وهو", "وهي", "وقد", "هناك", "يقوم", "تقوم"]);
function alignmentKey(term, variants, concept) {
  if (alignmentStop.has(term) || /^\d+$/.test(term) || term.length < 2) return null;
  if (concept !== undefined) return "concept:" + commonConcept.get(concept);
  if (/^[a-z]+$/.test(term)) {
    let stem = term;
    if (stem.length > 4 && stem.endsWith("ies")) stem = stem.slice(0, -3) + "y";
    else if (stem.length > 4 && /(?:ches|shes|xes|sses|zes)$/.test(stem)) stem = stem.slice(0, -2);
    else if (stem.length > 3 && /[^su]s$/.test(stem)) stem = stem.slice(0, -1);
    else if (stem.length > 4 && /(?:ing|ed)$/.test(stem)) {
      stem = stem.replace(/(?:ing|ed)$/, "").replace(/([^aeiou])\1$/, "$1");
    }
    if (stem.length >= 4) stem = stem.replace(/e$/, "");
    return alignmentStop.has(stem) ? null : stem;
  }
  if (!/^[\u0621-\u064a]+$/u.test(term)) return term;
  // Strip an article or attached conjunction only in forms with a substantial residue.
  let stem = term.replace(/^(?:وبال|وفال|ولل|وال|فال|بال|كال|لل|ال)(?=.{3})/u, "");
  if (stem === term) stem = stem.replace(/^و(?=.{3})/u, "");
  if (alignmentStop.has(stem)) return null;
  const stableSense = variants.find(v => senses[v]?.length === 1);
  if (stableSense) return "sense:" + senses[stableSense][0];
  stem = stem.replace(/(?:يات|يون|يين|ات|ان|ون|ين|ها|هم|هن|نا|ة)$/u,
    (ending, offset) => offset >= 3 ? "" : ending);
  return stem;
}
function alignmentScore(a, b) {
  const short = a.keys.size <= b.keys.size ? a.keys : b.keys;
  const long = short === a.keys ? b.keys : a.keys;
  if (short.size < 2) return 0;
  let hits = 0;
  for (const key of short) if (long.has(key)) hits++;
  const dice = 2 * hits / (short.size + long.size);
  const supported = short.size < 4 ? hits === short.size && dice >= 0.80
    : hits >= 3 && dice >= 0.70;
  return supported ? dice : 0;
}
function ranges(text, options) {
  const found = [];
  if(options.excludeReferences) {
    const heading = /^\s{0,4}(?:#{1,5}\s*)?(?:\d+[.)-]?\s*)?(?:references|bibliography|works\s+cited|reference\s+list|(?:قائمة\s+)?(?:المراجع|المصادر)(?:\s+و(?:المراجع|المصادر))?)\s*[:：]?\s*$/imu.exec(text);
    if(heading) found.push({start:heading.index,end:text.length,reason:"references"});
  }
  if(options.excludeQuotes) {
    for(const re of [/"[^"]+"/gu,/“[^”]+”/gu,/«[^»]+»/gu,/‘[^’]+’/gu,/(?:^|\n)\s*>[^\n]+/gu]) {
      for (const m of text.matchAll(re)) found.push({start:m.index,end:m.index+m[0].length,reason:"quote"});
    }
  }
  found.sort((a,b)=>a.start-b.start||b.end-a.end);
  const disjoint=[];
  for(const s of found) {
    const last=disjoint.at(-1);
    if(last && s.start<last.end) last.end=Math.max(last.end,s.end);
    else disjoint.push(s);
  }
  return disjoint;
}
function tokenize(text, cut) {
  const tokens = [];
  let current=0, group=0, lastEnd=0;
  for(const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}ـ]*/gu)) {
    while(current<cut.length && m.index>=cut[current].end){current++; group++;}
    if(cut[current] && m.index>=cut[current].start) continue;
    const key=normalize(m[0]);
    if(!key) continue;
    const gap=text.slice(lastEnd,m.index);
    const sentenceBreak=tokens.length>0 && (tokens.at(-1).group!==group || /[.!?؟؛;\n]/u.test(gap));
    tokens.push({key,start:m.index,end:m.index+m[0].length,group,sentenceBreak});
    lastEnd=m.index+m[0].length;
  }
  return tokens;
}
function shingle(t, i) {
  if(i+width>t.length || t[i].group!==t[i+width-1].group) return null;
  return t.slice(i,i+width).map(x=>x.key).join(" ");
}
function sentenceRanges(t) {
  const intervals=[];
  for(let a=0;a<t.length;) {
    let b=a+1;
    while(b<t.length && !t[b].sentenceBreak && t[b].group===t[a].group && b-a<48) b++;
    const besideExclusion = (a > 0 && t[a-1].group !== t[a].group) ||
      (b < t.length && t[b-1].group !== t[b].group);
    if (b - a >= (besideExclusion ? 5 : 3)) intervals.push([a,b]);
    a=b;
  }
  return intervals;
}
function add(map, k, val=1) { map.set(k,Math.max(map.get(k)||0,val)); }
function vector(t, a, b) {
  const bag = new Map(), keys = new Set(), numbers=[], v=new Float32Array(dimensions);
  let neg=false, content=0, known=0;
  for(let i=a;i<b;i++) {
    const k=t[i].key;
    if (/^(?:not|never|without|no|ليس|لا|لم|لن|دون|غير)$/.test(k)) neg=true;
    if (/^\d+$/.test(k)) numbers.push(k);
    if (stopwords.has(k)||k.length<2) continue;
    content++;
    const vv=lookup(k);
    const canonical = vv.find(w=>commonConcept.has(w));
    const alignment = alignmentKey(k, vv, canonical);
    if (alignment) keys.add(alignment);
    const lemma=vv.find(w=>senses[w]);
    const base=canonical || lemma || vv.at(-1);
    add(bag,"w:"+base,0.8);
    if(canonical!==undefined) add(bag,"c:"+commonConcept.get(canonical),1.4);
    if(lemma) for(const sense of senses[lemma]) add(bag,"s:"+sense,0.9/Math.sqrt(senses[lemma].length));
    const knownWord=vv.find(w=>vocabulary.has(w));
    if(knownWord!==undefined) {
      known++;
      const offset=vocabulary.get(knownWord)*dimensions;
      for(let k=0;k<dimensions;k++) v[k]+=weights[offset+k];
    }
  }
  let norm=0;
  for(const n of v) norm+=n*n;
  norm=Math.sqrt(norm)||1;
  for(let k=0;k<dimensions;k++) v[k]/=norm;
  return {a,b,bag,keys,v,numbers:numbers.sort().join("/"),neg,coverage:known/Math.max(1,content)};
}
function build(source, options) {
  const text=source.text, t=tokenize(text,ranges(text,options)), grams=new Map();
  for(let i=0;i<t.length-width+1;i++) {
    const k=shingle(t,i);
    if(!k) continue;
    const bucket=grams.get(k);
    if(!bucket) grams.set(k,[i]);
    else if(bucket.length<32) bucket.push(i);
  }
  return {source,t,grams,sentences:sentenceRanges(t).map(([a,b])=>vector(t,a,b))};
}
function getPublic(options) {
  const key=String(+options.excludeQuotes)+String(+options.excludeReferences);
  if(!compiledPublic.has(key)) compiledPublic.set(key,PUBLIC_SOURCES.map(s=>build(s,options)));
  return compiledPublic.get(key);
}
function metadata({id,title,url,author,kind,license,licenseUrl,lang}) {
  return {id:String(id),title:String(title||id),url:typeof url==="string" && /^https:\/\//i.test(url)?url:null,kind:kind||"cohort",author,license,licenseUrl,lang};
}
function longest(q,i,source,positions) {
  let best=0, bestAt=-1;
  for(const p of positions) {
    let n=width;
    while (i+n<q.length && p+n<source.length && q[i+n].group===q[i].group && source[p+n].group===source[p].group && q[i+n].key===source[p+n].key) n++;
    if(n>best) {best=n;bestAt=p;}
    if(i+n===q.length) break;
  }
  return [best,bestAt];
}
function semanticScore(a,b) {
  if(a.neg!==b.neg || a.numbers!==b.numbers || Math.max(a.b-a.a,b.b-b.a)>2.1*Math.min(a.b-a.a,b.b-b.a)) return 0;
  const aligned = alignmentScore(a, b);
  if (Math.min(a.b-a.a,b.b-b.a) < 5) return aligned;
  let inter=0, normA=0, normB=0, anchors=0;
  for(const [k,w] of a.bag) {
    normA+=w*w;
    if(b.bag.has(k)){ inter+=w*b.bag.get(k); if(k.startsWith("w:")||k.startsWith("c:")) anchors++; }
  }
  for(const w of b.bag.values()) normB+=w*w;
  const lexical=inter/(Math.sqrt(normA*normB)||1);
  let dense=0;for(let i=0;i<dimensions;i++)dense+=a.v[i]*b.v[i];
  if(anchors<3 && (anchors<2||dense<0.94||Math.min(a.coverage,b.coverage)<0.70)) return aligned;
  // Semantic evidence requires lexical support. A small fitted model alone is unreliable on short passages.
  const value=0.78*lexical+0.22*Math.max(0,dense);
  if((lexical>=0.72 && anchors>=4) || (value>=0.67 && lexical>=0.51 && dense>=0.78)) return Math.max(value,lexical,aligned);
  return aligned;
}

/** All indices are UTF-16 offsets into the redacted text passed by the caller. */
export function compareDocument(text, cohortSources=[], settings={}) {
  const options={excludeQuotes:settings.excludeQuotes!==false,excludeReferences:settings.excludeReferences!==false};
  const cut=ranges(text,options), q=tokenize(text,cut);
  const publicIndex=getPublic(options);
  const visible=cohortSources.filter(s=>s && typeof s.text==="string" && s.id!=null);
  const seen=new Set(publicIndex.map(s=>s.source.text));
  const corpus=[...publicIndex];
  for(const source of visible){
    if(seen.has(source.text)) continue;
    seen.add(source.text);
    corpus.push(build(source,options));
  }
  const candidates=[], exactCovered=new Uint8Array(q.length);
  function note(s,i,j,a,b,method,score) {
    const info=metadata(s.source);
    return {start:q[i].start,end:q[j-1].end,sourceId:info.id,sourceTitle:info.title,sourceUrl:info.url,kind:info.kind,method,score:Math.round(score*100)/100,sourceStart:s.t[a].start,sourceEnd:s.t[b-1].end,first:i,last:j,sourceFirst:a};
  }
  for(const s of corpus) {
    for(let i=0;i<=q.length-width;) {
      const k=shingle(q,i);
      const pos=k && s.grams.get(k);
      if(!pos){i++;continue;}
      const [len,a]=longest(q,i,s.t,pos);
      candidates.push(note(s,i,i+len,a,a+len,"verbatim",1));
      exactCovered.fill(1,i,i+len);
      i+=len;
    }
  }
  // Candidate screening by posting lists avoids scanning every sentence in every upload.
  let postings;
  function* postingKeys(sentence) {
    yield* sentence.bag.keys();
    for (const key of sentence.keys) yield "align:" + key;
  }
  for(const [a,b] of sentenceRanges(q)) {
    if(exactCovered.subarray(a,b).some(Boolean)) continue;
    if(!postings){
      postings=new Map();
      for(const source of corpus) for(const sentence of source.sentences) {
        const entry={source,sentence};
        for(const key of postingKeys(sentence)){
          const list=postings.get(key);if(list)list.push(entry);else postings.set(key,[entry]);
        }
      }
    }
    const query=vector(q,a,b), entries=new Map();
    for(const k of postingKeys(query)) {
      const list=postings.get(k);if(!list)continue;
      for(const item of list) entries.set(item,(entries.get(item)||0)+1);
    }
    let best=null, score=0;
    for(const [item,n] of entries){
      if(n<2)continue;
      const v=semanticScore(query,item.sentence);if(v>score){score=v;best=item;}
    }
    if(best) candidates.push(note(best.source,a,b,best.sentence.a,best.sentence.b,"paraphrase",score));
  }
  const occupied=new Uint8Array(q.length);
  const matches=[];
  const corpusById=new Map(corpus.map(s=>[String(s.source.id),s]));
  for(const c of candidates.sort((x,y)=>Number(y.method==="verbatim")-Number(x.method==="verbatim") || (y.last-y.first)-(x.last-x.first)||y.score-x.score || x.start-y.start)) {
    const {first,last,sourceFirst,...match}=c;
    for(let i=first;i<last;) {
      while(i<last && occupied[i]) i++;
      if(i===last) break;
      let j=i+1;while(j<last && !occupied[j]) j++;
      occupied.fill(1,i,j);
      const clipped={...match,start:q[i].start,end:q[j-1].end};
      if(match.method==="verbatim") {
        const source=corpusById.get(match.sourceId);
        clipped.sourceStart=source.t[sourceFirst+i-first].start;
        clipped.sourceEnd=source.t[sourceFirst+j-1-first].end;
      }
      matches.push(clipped);
      i=j;
    }
  }
  const matchedWords=occupied.reduce((a,b)=>a+b,0);
  const percentage=q.length? Math.round(1000*matchedWords/q.length)/10:0;
  return {percentage,eligibleWords:q.length,matchedWords,matches:matches.sort((a,b)=>a.start-b.start||b.end-a.end),sources:[...PUBLIC_SOURCES,...visible].map(metadata),exclusions:cut,limitations:{index:"published excerpts and permitted cohort uploads",paraphrase:"lexical and fitted cross-lingual features; extensive rewording may be missed",score:"share of eligible words with evidence"}};
}
export { PUBLIC_SOURCES };
