// Reproduce word-coverage arithmetic with public sources. This script has no dependency on phone files.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {compareDocument,PUBLIC_SOURCES} from "../../engine.mjs";

const output=process.argv[2];
if(!output)throw Error("Usage: node phone-regression.mjs new-evidence.json");
const here=s=>new URL(s,import.meta.url);
const hash=s=>createHash("sha256").update(s).digest("hex");
const token=/[\p{L}\p{N}][\p{L}\p{N}\p{M}ـ]*/gu;
const terms=s=>[...s.matchAll(token)];
const input=readFileSync(here("../parallel.jsonl"));
const held=input.toString().trimEnd().split("\n").map(JSON.parse).filter(([id])=>
  parseInt(hash(id.slice(0,-3)).slice(0,8),16)%5===0);
const pdfHash=hash(readFileSync(here("../pyarabic-published.pdf")));
const evidence={startedUTC:new Date().toISOString(),engineSHA256:hash(readFileSync(here("../../engine.mjs"))),
  pudSHA256:hash(input),publishedPdfSHA256:pdfHash,
  source:"Public paper registry and Universal Dependencies PUD document groups outside bilingual fit",
  scope:"Direct production comparison module, public inputs only. No network, private phone text or authorship labels in these checks.",checks:[]};
const unmatched={en:"Zircon thermocouples triangulate pterosaur roosts",ar:"مجسات البازلت تستطلع أعشاش التيروصورات"};
function orderedSubstrings(query,matches,sources) {
  let previous=0;
  for(const m of matches) {
    assert.ok(m.start>=previous && m.end>m.start);
    previous=m.end;
    assert.equal(m.method,"verbatim");
    const source=sources.find(x=>x.id===m.sourceId);
    assert.ok(source && m.sourceStart>=0 && m.sourceEnd<=source.text.length);
    assert.equal(query.slice(m.start,m.end),source.text.slice(m.sourceStart,m.sourceEnd));
  }
}
// Recount the union of individual word positions from exported target intervals.
function inspect(language,label,query,sources,options,expected) {
  const result=compareDocument(query,sources,options);
  const all=[...PUBLIC_SOURCES,...sources];
  orderedSubstrings(query,result.matches,all);
  const words=terms(query);
  const eligible=words.filter(w=>!result.exclusions.some(s=>w.index>=s.start&&w.index<s.end));
  const intervals=result.matches.map(m=>[m.start,m.end]);
  const distinct=eligible.filter(w=>intervals.some(([a,b])=>w.index>=a&&w.index+w[0].length<=b)).length;
  assert.equal(eligible.length,expected.eligible);
  assert.equal(result.eligibleWords,eligible.length);
  assert.equal(result.matchedWords,distinct);
  assert.equal(result.matchedWords,expected.matched);
  assert.equal(result.percentage,Math.round(1000*expected.matched/(expected.eligible||1))/10);
  evidence.checks.push({language,label,querySHA256:hash(query),upperBoundWordCount:words.length,
    eligibleWords:eligible.length,distinctMatchedWords:distinct,percentage:result.percentage,
    excludedQuotations:!!options.excludeQuotes,excludedReferences:!!options.excludeReferences,
    verifiedPassages:intervals.length,presentedSourceCount:new Set(result.matches.map(m=>m.sourceId)).size,
    sourceTypeCounts:Object.fromEntries(["paper","cohort"].map(k=>[k,result.matches.filter(m=>m.kind===k).length]))});
  return result;
}
for(const [language,column] of [["ar",2],["en",1]]) {
  const options={excludeQuotes:true,excludeReferences:true};
  const paper=PUBLIC_SOURCES.find(s=>s.kind==="paper"&&s.lang===language);
  const line=paper.text.split("\n").find(s=>terms(s).length>=12);
  const pieces=terms(line).slice(0,12), known=line.slice(pieces[0].index,pieces.at(-1).index+pieces.at(-1)[0].length);
  const citation=inspect(language,"Published paper passage",known,[],options,{matched:12,eligible:12});
  assert.equal(citation.matches[0].sourceId,paper.id);
  assert.equal(citation.matches[0].sourceUrl,paper.url);

  // Keep actual source words in order, normalizing only the interword punctuation/spacing.
  const sentence=held.map(row=>terms(row[column])).find(t=>t.length>=24);
  const tokens=sentence.slice(0,20).map(w=>w[0]);
  const body=tokens.join(" "), clip=tokens.slice(0,14).join(" ");
  const clean=unmatched[language];
  const excludedCount=terms(clean).length;
  const a={id:"A",text:tokens.slice(0,13).join(" ")};
  const b={id:"B",text:tokens.slice(7,20).join(" ")};
  const duplicate={id:"A-copy",text:a.text};
  const newSubmission=clean+".\n"+body;
  const overlap=inspect(language,"Two overlapping cohort sources and a duplicate body",newSubmission,[a,b,duplicate],options,
      {matched:20,eligible:20+excludedCount});
  assert.equal(new Set(overlap.matches.map(m=>m.sourceId)).size,2);
  const dedup=inspect(language,"Identical duplicate bodies",a.text,[a,duplicate],options,{matched:13,eligible:13});
  assert.equal(dedup.matches.length,1);
  const foreign=inspect(language,"New unrelated eligible text",clean,[a,b],options,{matched:0,eligible:excludedCount});
  assert.equal(foreign.matches.length,0);
  const repeated=inspect(language,"Same passage occurs twice in different query positions",a.text+"\n"+a.text,
    [a,duplicate],options,{matched:26,eligible:26});
  assert.equal(repeated.matches.length,2);
  const quote="«"+clip+"»",heading=language==="ar"?"المراجع":"References";
  const mixed=[clip,quote,clean,heading,clip].join("\n");
  for(const excludeQuotes of [true,false])for(const excludeReferences of [true,false]){
    const hits=14*(1+Number(!excludeQuotes)+Number(!excludeReferences));
    inspect(language,"Quoted and bibliography copies",mixed,[{id:"original",text:clip}],
      {excludeQuotes,excludeReferences},{matched:hits,eligible:hits+excludedCount+Number(!excludeReferences)});
  }
}
evidence.status="passed";
evidence.completedUTC=new Date().toISOString();
writeFileSync(output,JSON.stringify(evidence,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({status:evidence.status,checks:evidence.checks.length}));
