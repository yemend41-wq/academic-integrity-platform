import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {compareDocument} from "../engine.mjs";
const rel=(s)=>new URL(s,import.meta.url);
const digest=b=>createHash("sha256").update(b).digest("hex");
const locks={
 "track1.ar-ar":["a4f24daa03def87b52769b3a5ea9fe5f8b66d2f06db2a6565395cb1575443e3e","4a7ad1eb5219605ab09cd743727c4059acdf55df9ae7351b5df079cc47ae983e"],
 "track5.en-en":["8d493844c1010eb6b5d373e289b8d6ddc003e626bf8495976cc40c0a5f47414c","a767d322cc3e78ff43f3c541a4fc0b9e0e5681f27c20de7eb9095fbb9072cf04"]
};
async function load(track,type) {
 let data;
 try {data=readFileSync(rel(track+"."+type+".tmp"),"utf8");} catch(e) {
   if(e.code!=="ENOENT")throw e;
   const directory=type==="input"?"STS2017.eval.v1.1":"STS2017.gs";
   const response=await fetch("https://raw.githubusercontent.com/yaushian/mSimCSE/main/data/Sts2017/"+directory+"/STS."+type+"."+track+".txt");
   if(!response.ok)throw Error("Benchmark retrieval failed: "+response.status);
   data=await response.text();
 }
 if(digest(data)!==locks[track][type==="input"?0:1])throw Error("Benchmark hash mismatch for "+track+" "+type);
 return data;
}
const rows=[];
for(const track of ["track1.ar-ar","track5.en-en"]) {
 const [corpus,scores]=await Promise.all([load(track,"input"),load(track,"gs")]);
 const inputs=corpus.trimEnd().split(/\r?\n/), gs=scores.trimEnd().split(/\r?\n/);
 if(inputs.length!==gs.length)throw Error("pair/label mismatch");
 const stats={track,inputSha256:digest(corpus),goldSha256:digest(scores),total:inputs.length,high:{matched:0,total:0},low:{matched:0,total:0},intermediate:0,missingLabel:0};
 for(let i=0;i<inputs.length;i++){
   const [original,query]=inputs[i].split("\t"), gold=Number(gs[i]);
   if(!gs[i].trim()){stats.missingLabel++;continue;}
   if(gold>1 && gold<4){stats.intermediate++;continue;}
   const outcome=compareDocument(query,[{id:"candidate",title:"Candidate source",text:original}]);
   const z=gold>=4?stats.high:stats.low;
   z.total++;if(outcome.matches.some(m=>m.sourceId==="candidate")) z.matched++;
 }
 stats.recallHigh=stats.high.matched/stats.high.total;
 stats.lowPairFlagRate=stats.low.matched/stats.low.total;
 rows.push(stats);
}
const pdf=fileURLToPath(rel("pyarabic-published.pdf"));
const parsed=execFileSync("pdftotext",["-raw",pdf,"-"],{encoding:"utf8"});
const result=compareDocument(parsed);
const audit={fixture:{file:"pyarabic-published.pdf",sha256:digest(readFileSync(pdf)),parser:"pdftotext -raw",englishPaperMatched:result.matches.some(m=>m.sourceId==="pyarabic"),matchingIntervals:result.matches.filter(x=>x.sourceId==="pyarabic").length,eligibleWords:result.eligibleWords,coverageAllSources:result.percentage},benchmark:"SemEval 2017 Task 1, held-out Arabic (track 1) and English (track 5) sentence pairs. Positive: gold >=4/5; negative: gold <=1/5. Match is an interval attributed to the supplied partner. Includes all lengths. No thresholds fitted on these tracks.",tracks:rows};
// Historical acceptance evidence remains pinned to its tested engine.
if (process.argv[2]) writeFileSync(resolve(process.argv[2]),JSON.stringify(audit,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(audit));
