import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {aggregatePanel,sha256} from "../ui/blind-metrics.mjs";
import {database} from "../scripts/sqlite.mjs";
import {openSession} from "../src/auth.mjs";
import worker from "../dist/server/index.js";

test("blind answer key is matched by unique bytes, independent of ordering", () => {
  const scores = new Map();
  const cases = [];
  function add(origin, status, display, index) {
    const id = String(index).padStart(64, "0");
    cases.push({sha256:id,language:"ar",origin,condition:"original",generatedPercent:origin==="mixed"?50:0});
    scores.set(id,{status,display});
  }
  add("human","analyzed","0%",1);
  add("human","suppressed","*%",2);
  add("human","insufficient",null,3);
  add("mixed","analyzed","80%",4);
  add("mixed","suppressed","*%",5);
  const results=aggregatePanel({version:1,cases:cases.toReversed()},scores);
  const human=results.find(x=>x.origin==="human"), mixed=results.find(x=>x.origin==="mixed");
  assert.deepEqual([human.files,human.eligible,human.abstained,human.numericAlerts,human.allAlerts], [3,2,1,0,1]);
  assert.ok(human.allWilson95[0]>0.09 && human.allWilson95[1]<0.91);
  assert.deepEqual([mixed.numeric,mixed.suppressed,mixed.maeNumericPP,mixed.biasNumericPP], [1,1,30,30]);
  assert.deepEqual(mixed.eligibleMaeBoundsPP,[30,40]);
  assert.throws(()=>aggregatePanel({version:1,cases:[cases[1],...cases.slice(1)]},scores),/different_files/);
  assert.throws(()=>aggregatePanel({version:1,cases:[{...cases[0],generatedPercent:17},...cases.slice(1)]},scores),/bad_labels/);
});

test("private scoring uses normal extraction and inference without persisting the document",async t=>{
  const env={DB:database()};
  t.after(()=>env.DB.close());
  const origin="https://mizan.test";
  const request=(path,opts={})=>worker.fetch(new Request(origin+path,opts),env,{});
  const cookie=async role=>(await openSession(env,{id:"fixture-"+role,role,cohort:"private-panel"})).headers.get("set-cookie").split(";")[0];
  const member=await cookie("student"), reviewer=await cookie("instructor");
  for (const fmt of ["docx","pdf"]) {
    const input=await readFile("research/bench/fixtures/melville-3000."+fmt);
    const options=(session)=>({method:"POST",headers:{"x-format":fmt,"x-index":"no",...(session?{cookie:session}:{})},body:input});
    assert.equal((await request("/api/panel/score",options())).status,401);
    assert.equal((await request("/api/panel/score",options(member))).status,403);
    const before=(await env.DB.prepare("SELECT count(*) AS n FROM documents").first()).n;
    const response=await request("/api/panel/score",options(reviewer));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM documents").first()).n,before);
    assert.deepEqual(Object.keys(data).sort(),["analysisFingerprint","display","eligibleWords","model","sha256","status"]);
    assert.equal(data.sha256,await sha256(input));
    assert.equal(data.analysisFingerprint,(await (await request("/api/health")).json()).analysisFingerprint);
    const regular=await request("/api/analyze",options(reviewer));
    assert.equal(regular.status,201);
    const det=(await regular.json()).detector;
    for (const k of ["display","eligibleWords","model","status"]) assert.equal(data[k],det[k]);
  }
});

test("blue passage groups respect unflagged units, paragraphs and language boundaries",async()=>{
  const {writingPassages}=await import("../ui/writing-passages.mjs");
  const text="one. two. three. four.\n\nfive. ستة. seven";
  const terms=["one","two","three","four","five","ستة","seven"];
  const segments=terms.map((s,i)=>({start:text.indexOf(s),end:text.indexOf(s)+s.length,lang:i===5?"ar":"en",flagged:i!==2}));
  assert.deepEqual(writingPassages(text,segments).map(x=>text.slice(x.start,x.end)),["one. two","four","five","ستة","seven"]);
});
