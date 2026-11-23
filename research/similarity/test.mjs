import assert from "node:assert/strict";
import test from "node:test";
import { compareDocument as run, PUBLIC_SOURCES } from "./engine.mjs";

const paper=PUBLIC_SOURCES.find(x=>x.id==="pyarabic");
const extract=paper.text.split("\n").find(x=>x.startsWith("PyArabic is a collection"));
const arabic=PUBLIC_SOURCES.find(x=>x.lang==="ar" && x.kind==="paper");
const source=(id,text)=>({id,title:"Cohort paper "+id,kind:"cohort",text});
test("published English paper, exact offsets and DOI",()=>{
  const text="A short introductory comment.\n"+extract;
  const found=run(text).matches.find(x=>x.sourceId===paper.id);
  assert.equal(found.method,"verbatim");
  assert.equal(text.slice(found.start,found.end),paper.text.slice(found.sourceStart,found.sourceEnd));
  assert.equal(found.sourceUrl,"https://doi.org/10.21105/joss.04886");
});
test("Arabic paper with vowel marks removed and Arabic-Indic numerals",()=>{
  const text=arabic.text.normalize("NFD").replace(/\p{M}/gu,"").replace("435","٤٣٥");
  assert.equal(run(text).matches[0].sourceId,arabic.id);
  assert.equal(run(text).percentage,100);
});
test("quote and bibliography exclusions with exact denominator",()=>{
  for(const [title,quote] of [["References",'"'],["المراجع","«"]]){
    const text='word one two three.\n'+quote+extract+(quote==="«"?"»":quote)+"\n"+title+"\n"+arabic.text;
    const r=run(text);assert.equal(r.percentage,0);assert.equal(r.eligibleWords,4);
    assert.deepEqual(r.exclusions.map(x=>x.reason),["quote","references"]);
    assert.ok(run(text,[],{excludeQuotes:false,excludeReferences:false}).percentage>85);
  }
});
test("exclusion gaps cannot create a false five-gram",()=>{
  const text='A river "quoted inserted sentence" flows through valleys';
  assert.equal(run(text,[source("gap","A river flows through valleys")]).percentage,0);
});
test("Arabic and English low-overlap paraphrase candidates",()=>{
  const pairs=[
    ["The researchers used a questionnaire to measure student learning outcomes in rural schools.","The investigators employed a survey to measure learner education outcomes at rural schools."],
    ["قاس الباحثون نتائج التعلم لدى طلاب المدارس الريفية باستخدام استبانة قصيرة.","قاس الباحثون حصيلة التعليم عند طلبة المدارس الريفية باستعمال استبيان قصير."],
  ];
  for(const [a,b] of pairs) {
    const r=run(b,[source("local",a)]);
    assert.equal(r.matches[0].method,"paraphrase");assert.equal(r.matches[0].sourceId,"local");
  }
});
test("unrelated passages and changed numerical claims",()=>{
  const a=source("unrelated","The researchers surveyed 50 students about the quality of rural medical education.");
  assert.equal(run("The cafe purchased three sacks of espresso beans in the afternoon.",[a]).percentage,0);
  const matches=run("The investigators questioned 30 learners regarding rural medical teaching quality.",[a]).matches;
  assert.ok(!matches.some(x=>x.method==="paraphrase"));
});
test("cohort matching depends on supplied scope and report contains no private source text",()=>{
 const d=source("private","Unusual cobalt instruments track nocturnal fog inside mountain observatories.");
 assert.equal(run(d.text).percentage,0);const r=run(d.text,[d]);assert.equal(r.percentage,100);
 assert.equal(r.sources.find(x=>x.id===d.id).text,undefined);
});
test("coverage uses the union and displayed highlights do not overlap",()=>{
 const cases=[source("A","one two three four five six seven eight nine"),source("B","four five six seven eight nine ten eleven twelve")];
 const r=run("one two three four five six seven eight nine ten eleven twelve",cases);
 assert.equal(r.percentage,100);assert.equal(r.matchedWords,12);assert.equal(r.matches.length,2);
 for(let i=1;i<r.matches.length;i++) assert.ok(r.matches[i-1].end<=r.matches[i].start);
});
test("empty and completely excluded submissions",()=>{
 for(const x of ["","!!!","«"+extract+"»","Bibliography\n"+extract]){
   const r=run(x);assert.equal(r.eligibleWords,0);assert.equal(r.matches.length,0);
 }
});

test("short inflected sentences link to the corresponding source paragraph in both languages",()=>{
  const examples = [
    ["Sensors recorded vibrations.", "Sensors recording vibrations."],
    ["تراقب المجسات درجات الحرارة.", "تراقب مجسات درجات الحرارة."],
  ];
  for (const [original, rewrite] of examples) {
    const reference = "⚙\n" + original + "\nUnrelated lunar observations.";
    const query = "📝\n" + rewrite;
    const matches = run(query,[source("bounded",reference)]).matches;
    const hit = matches.find(m=>m.sourceId==="bounded");
    assert.equal(hit.method,"paraphrase");
    assert.equal(query.slice(hit.start,hit.end),rewrite.slice(0,-1));
    assert.equal(reference.slice(hit.sourceStart,hit.sourceEnd),original.slice(0,-1));
  }
});
test("semantic alignment keeps numerical and negation guards, including Persian numerals",()=>{
  const original = source("counts","تراقب المجسات ۱۲ هزة.");
  const matches = s => run(s,[original]).matches.filter(m=>m.sourceId==="counts");
  assert.ok(matches("تراقب مجسات ١٢ هزة.").length>0);
  assert.equal(matches("تراقب مجسات ١٥ هزة.").length,0);
  assert.equal(matches("لا تراقب مجسات ١٢ هزة.").length,0);
});
test("short sentences require at least two separate informative alignment keys",()=>{
  const r=run("The student is there.",[source("common","There was a student.")]);
  assert.equal(r.matches.filter(m=>m.sourceId==="common").length,0);
});
