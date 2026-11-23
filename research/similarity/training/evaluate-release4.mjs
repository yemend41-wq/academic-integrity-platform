import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compareDocument as candidate } from "../engine.mjs";

const here = p => new URL(p, import.meta.url);
const sha = data => createHash("sha256").update(data).digest("hex");
const cached = process.argv[2], baselinePath = process.argv[3];
if (!cached || !baselinePath) throw Error("Usage: node evaluate-release4.mjs <four SHA-locked STS files directory> <release-3 engine.mjs path>");
const oldHash = "42cc2388f4f5eac190e5acee372477ab156101a9164fc0da0394accd4daf9a4d";
assert.equal(sha(readFileSync(baselinePath)), oldHash);
const { compareDocument: incumbent } = await import(pathToFileURL(resolve(baselinePath)));
const versions = { release3: incumbent, release4: candidate };
const old = JSON.parse(readFileSync(here("external-evaluation.json")));
const controls = {
  en: ["Quartz telemetry at the lighthouse entered buffer nine.", "A seismograph beside the lantern logged an isolated tremor."],
  ar: ["قيد مرصد الزلازل هزة عابرة بجوار المنارة.", "سجلت عوامة الميناء درجة ملوحة السطح."],
};
const tokens = /[\p{L}\p{N}][\p{L}\p{N}\p{M}ـ]*/gu;
function bounds(text, offset) {
  const words = [...text.matchAll(tokens)];
  return [offset + words[0].index, offset + words.at(-1).index + words.at(-1)[0].length];
}
function overlap(a,b) {
  const intersect = Math.max(0, Math.min(a[1],b[1])-Math.max(a[0],b[0]));
  return intersect / (a[1]-a[0]+b[1]-b[0]-intersect || 1);
}
function targetScore(matches, query, target) {
  // Missing targets contribute zero to the macro rather than disappearing from the mean.
  let best = { target: 0, source: 0 };
  for (const m of matches) {
    const targetIoU = overlap(query,[m.start,m.end]);
    const sourceIoU = overlap(target,[m.sourceStart,m.sourceEnd]);
    if (targetIoU*sourceIoU > best.target*best.source) best = {target:targetIoU,source:sourceIoU};
  }
  return best;
}
function rank(matches, query, text) {
  const scores = new Map();
  for (const m of matches) {
    const chars = Math.min(m.end,query[1])-Math.max(m.start,query[0]);
    if (chars <= 0) continue;
    const words = [...text.slice(Math.max(m.start,query[0]),Math.min(m.end,query[1])).matchAll(tokens)].length;
    const s = scores.get(m.sourceId) || [0,0];
    s[0] += words; s[1] += words*m.score; scores.set(m.sourceId,s);
  }
  const ranked = [...scores.entries()].sort((a,b)=>b[1][0]-a[1][0]||b[1][1]-a[1][1]);
  if (ranked.length > 1 && ranked[0][1].every((v,i)=>v===ranked[1][1][i])) return null;
  return ranked[0]?.[0];
}
function evaluateTrack(fn, rows, lang) {
  const [prefix, suffix] = controls[lang];
  let highPairs=0, positiveRetrieved=0, lowPairs=0, unrelatedFlagged=0, top1=0, qi=0, si=0;
  for (let i=0;i<rows.length;i++) {
    const {source,query,gold} = rows[i];
    if (!Number.isFinite(gold) || gold>1 && gold<4) continue;
    const correct = String(i);
    const paired = fn(query,[{id:correct,text:source}]).matches.some(m=>m.sourceId===correct);
    if (gold<=1) { lowPairs++; unrelatedFlagged+=Number(paired);continue; }
    highPairs++;positiveRetrieved+=Number(paired);
    // Place the correct item at varying positions. Distinct texts only, no labels used for distractors.
    const distractors = new Map([[source,i]]);
    for (let j=1;distractors.size<16 && j<rows.length;j++) {
      const idx = (i+j*43)%rows.length;
      if (!distractors.has(rows[idx].source)) distractors.set(rows[idx].source,idx);
    }
    const pool = [...distractors].sort((a,b)=>a[1]-b[1]).map(([txt,k])=>({
      id:String(k), text:prefix+"\n"+txt+"\n"+suffix
    }));
    // Different surrounding text prevents the controls from counting as a retrieved source.
    const fullQuery = suffix+"\n"+query;
    const qBounds = bounds(query,suffix.length+1), sBounds = bounds(source,prefix.length+1);
    const matches = fn(fullQuery,pool).matches;
    top1 += Number(rank(matches,qBounds,fullQuery)===correct);
    const pair = targetScore(matches.filter(m=>m.sourceId===correct),qBounds,sBounds);
    qi+=pair.target;si+=pair.source;
  }
  return {highPairs,positiveRetrieved,lowPairs,unrelatedFlagged,top1,meanTargetSentenceIoU:qi/highPairs,meanSourceSentenceIoU:si/highPairs};
}
const tracks=[];
for (const locked of old.tracks) {
  const track=locked.track, lang=track.includes(".ar-")?"ar":"en";
  const read=k=>readFileSync(resolve(cached,track+"."+k+".tmp"),"utf8");
  const raw=read("input"),gold=read("gs");
  assert.equal(sha(raw),locked.inputSha256);assert.equal(sha(gold),locked.goldSha256);
  const scores=gold.trimEnd().split(/\r?\n/);
  const rows=raw.trimEnd().split(/\r?\n/).map((line,i)=>{
    const [source,query]=line.split("\t");return {source,query,gold:scores[i].trim()?Number(scores[i]):NaN};
  });
  assert.equal(rows.length,scores.length);
  const result={track, language:lang, rows:rows.length,inputSha256:sha(raw),goldSha256:sha(gold)};
  for (const [v,fn] of Object.entries(versions)) result[v]=evaluateTrack(fn,rows,lang);
  assert.equal(result.release3.positiveRetrieved,locked.high.matched);
  assert.equal(result.release3.unrelatedFlagged,locked.low.matched);
  tracks.push(result);
}
const pud=readFileSync(here("parallel.jsonl"),"utf8");
const held=pud.trimEnd().split("\n").map(JSON.parse).filter(([id])=>parseInt(sha(id.slice(0,-3)).slice(0,8),16)%5===0);
const copy={};
for(const [ver,fn] of Object.entries(versions)){
  copy[ver]={};
  for(const [lang,col] of [["en",1],["ar",2]]){
    const [head,tail]=controls[lang];
    let eligible=0, correctSource=0, bothBoundariesExact=0;
    for(const row of held){
      const s=row[col]; if([...s.matchAll(tokens)].length<5)continue;
      eligible++;
      const q=tail+"\n"+s, source=head+"\n"+s;
      const target=bounds(s,tail.length+1), origin=bounds(s,head.length+1);
      const hits=fn(q,[{id:row[0],text:source}]).matches.filter(m=>m.sourceId===row[0] && m.method==="verbatim");
      const result=targetScore(hits,target,origin);
      correctSource+=Number(result.target>0 && result.source>0);
      bothBoundariesExact+=Number(result.target===1 && result.source===1);
    }
    copy[ver][lang]={eligible,correctSource,bothBoundariesExact};
  }
}
const pdf=fileURLToPath(here("pyarabic-published.pdf")), parsed=execFileSync("pdftotext",["-raw",pdf,"-"],{encoding:"utf8"});
const publishedPDF={sha256:sha(readFileSync(pdf)),sourceId:"pyarabic"};
for(const [k,fn] of Object.entries(versions)){
  const report=fn(parsed);
  publishedPDF[k]={retrieved:report.matches.some(m=>m.sourceId==="pyarabic"),eligibleWords:report.eligibleWords,matchedWords:report.matchedWords,coverage:report.percentage};
}
const gate=tracks.every(t=>{const a=t.release3,b=t.release4;return (t.language==="ar"?b.positiveRetrieved>a.positiveRetrieved:b.positiveRetrieved>=a.positiveRetrieved)&&b.unrelatedFlagged<=a.unrelatedFlagged+1&&b.meanTargetSentenceIoU>=a.meanTargetSentenceIoU&&b.meanSourceSentenceIoU>=a.meanSourceSentenceIoU&&b.top1>=a.top1;});
const audit={
  measuredUtc:new Date().toISOString(),engineSha256:sha(readFileSync(here("../engine.mjs"))),baselineSha256:oldHash,
  protocolSha256:sha(readFileSync(here("protocol-release4.json"))),
  publishedPDF,sourceAwareRetrieval:tracks,controlledVerbatim:{data:"Universal Dependencies, PUD, document-disjoint from multilingual embedding fit, compared to the known source. Exact five-token minimum.",sha256:sha(pud),results:copy},
  spanMetric:"Mean intersection over union of UTF-16 positions in aligned target/source sentences, computed on all high pairs. A miss counts as zero. Whole-sentence STS alignments indicate semantic similarity; precise plagiarism spans are not annotated in this benchmark.",
  rankingMetric:"Unique first source by covered query word count, then word-weighted match score. Each query is compared to all five built-in documents plus its partner and up to 15 deterministic same-language distractor sources.",
  acceptanceGate:gate, scope:"Same frozen SemEval files as release 3; previous aggregate scores were known. New source-ranking and span evaluation protocol. No unseen committee test or internet-wide retrieval claim."
};
writeFileSync(here("release4-evaluation.json"),JSON.stringify(audit,null,2)+"\n");
console.log(JSON.stringify(audit));
