import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareDocument as current } from "../engine.mjs";

const [dataDirectory, baselinePath]=process.argv.slice(2);
if (!dataDirectory || !baselinePath) throw Error("Pass the directory of SHA-locked corpora and the release-3 engine.mjs");
const here = path => new URL(path, import.meta.url);
const sha = s => createHash("sha256").update(s).digest("hex");
const protocol=JSON.parse(readFileSync(here("protocol-rewrites-release4.json")));
const locks=JSON.parse(readFileSync(here("../../detector/sources.json")));
assert.equal(sha(readFileSync(here("../engine.mjs"))),protocol.candidateSha256);
assert.equal(sha(readFileSync(baselinePath)),"42cc2388f4f5eac190e5acee372477ab156101a9164fc0da0394accd4daf9a4d");
const {compareDocument:prior}=await import(pathToFileURL(resolve(baselinePath)));
function get(file) {
  const bytes=readFileSync(resolve(dataDirectory,file));
  assert.equal(sha(bytes),locks[file].sha256);
  return file.endsWith(".jsonl") ? bytes.toString().trimEnd().split("\n").map(JSON.parse):JSON.parse(bytes);
}
const norm=s=>String(s).trim().replace(/\s+/g," ");
const take=s=>s.split(/\s+/).slice(0,300).join(" ");
function promptPairs(originals,rewrites){
  const humans=get(originals);
  return get(rewrites).map(row=>{
    const p=norm(row.prompt);
    const matched=humans.filter(s=>p.includes(norm(s.document)));
    if (matched.length!==1) return ["",""];
    return [matched[0].document,row.document];
  });
}
const corpora=[
  ["Arabic academic abstracts","ar",["academic-ar.jsonl"],get("academic-ar.jsonl").map(r=>[r.original_abstract,r.generated_abstract])],
  ["Arabic press","ar",["apt-human-polished.json"],get("apt-human-polished.json").map(r=>[r.original,r.Polish_text])],
  ["English TOEFL essays","en",["TOEFL_real_91.json","TOEFL_gpt4polished_91.json"],promptPairs("TOEFL_real_91.json","TOEFL_gpt4polished_91.json")],
  ["English Hewlett essays","en",["HewlettStudentEssay_real_88.json","HewlettStudentEssay_GPTsimplify_88.json"],promptPairs("HewlettStudentEssay_real_88.json","HewlettStudentEssay_GPTsimplify_88.json")]
];
const stats=[];
const words=s=>[...s.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}ـ]*/gu)].length;
for(const [name,language,files,pairs] of corpora){
  const unique=new Map();
  for(const [original,rewrite] of pairs){
    if(typeof original!=="string"||typeof rewrite!=="string")continue;
    const src=norm(original),q=norm(rewrite);
    if(!src||!q||src===q||unique.has(src))continue;
    unique.set(src,{id:sha(src),source:take(src),query:take(q)});
  }
  const sorted=[...unique.values()].sort((a,b)=>a.id<b.id?-1:1);
  const cases=sorted.slice(0,64);
  const stat={name,language,files:files.map(file=>({file,sha256:locks[file].sha256})),availableRows:pairs.length,eligiblePairs:sorted.length,evaluated:cases.length,evaluationIdsSha256:sha(cases.map(x=>x.id).join("\n"))};
  for(const [ver,fn] of [["release3",prior],["release4",current]]){
    let top1=0,anyCorrect=0,eligibleWords=0,attributedWords=0;
    for(const [i,item] of cases.entries()){
      const chosen=new Set([i]);
      for(let j=1;chosen.size<Math.min(8,sorted.length)&&j<=sorted.length;j++)chosen.add((i+j)%sorted.length);
      const candidates=[...chosen].map(idx=>({id:sorted[idx].id,text:sorted[idx].source,order:sha(item.id+":"+sorted[idx].id)})).sort((a,b)=>a.order<b.order?-1:1);
      const r=fn(item.query,candidates);
      const scores=new Map();
      eligibleWords+=r.eligibleWords;
      for(const m of r.matches){
        const n=words(item.query.slice(m.start,m.end));
        const score=scores.get(m.sourceId)||[0,0];score[0]+=n;score[1]+=n*m.score;scores.set(m.sourceId,score);
      }
      if(scores.has(item.id)){anyCorrect++;attributedWords+=scores.get(item.id)[0];}
      const ranked=[...scores.entries()].sort((a,b)=>b[1][0]-a[1][0]||b[1][1]-a[1][1]);
      const tied=ranked.length>1 && ranked[0][1].every((v,k)=>v===ranked[1][1][k]);
      if(!tied && ranked[0]?.[0]===item.id)top1++;
    }
    stat[ver]={top1,anyCorrect,eligibleWords,attributedWords,attributedFraction:attributedWords/eligibleWords};
  }
  stats.push(stat);
}
const output={measuredUtc:new Date().toISOString(),engineSha256:protocol.candidateSha256,protocolSha256:sha(readFileSync(here("protocol-rewrites-release4.json"))),groups:stats,limits:"Only documented rewrite pairs are scored. Top-one retrieval of a known source differs from a plagiarism or authorship judgment. Positive pairs cannot estimate false positives. Coverage uses visible intervals from the first 300 whitespace-delimited words; span-level paraphrase truth was not provided."};
writeFileSync(here("release4-rewrites.json"),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify(stats.map(g=>[g.name,g.evaluated,g.release3.top1,g.release4.top1])));
