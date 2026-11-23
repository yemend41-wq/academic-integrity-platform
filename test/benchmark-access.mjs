import assert from "node:assert/strict";
import {randomBytes,createHash} from "node:crypto";
import {test} from "node:test";
import {database} from "../scripts/sqlite.mjs";
import worker from "../dist/server/index.js";

test("expiring provisioner creates only fifty numbered students in its isolated class", async()=>{
  const run="861927eea765", password=randomBytes(24).toString("hex"), digest=s=>createHash("sha256").update(s).digest("hex");
  const until=Math.floor(Date.now()/1000)+600;
  const env={DB:database(),BENCHMARK_ACCESS:JSON.stringify({run,until,verifier:digest(password)}), REVIEW_PANEL_VERIFIER:digest(password+"panel")};
  async function request(path,body,cookie) {
    const headers={}; if(cookie) headers.cookie=cookie;
    if(body) headers["content-type"]="application/json";
    return worker.fetch(new Request("https://bench.invalid"+path,{headers,method:body?"POST":"GET",body:body?JSON.stringify(body):undefined}),env,{});
  }
  const cookie=r=>r.headers.get("set-cookie").split(";")[0];
  const sign=(username,password)=>request("/api/login",{username,password});
  const first=await sign("benchmark-provisioner",password);assert.equal(first.status,200);
  const auth=cookie(first), p=await first.json();assert.equal(p.role,"test-provisioner");
  const add=(username,role,testRun)=>request("/api/members",{username,role,testRun},auth);
  for (const args of [["load-"+run+"-50","student",run],["load-"+run+"-1","instructor",run],["load-"+run+"-1","student","8a2345678bcd"],["ordinary-name","student",undefined]])
    assert.equal((await add(...args)).status,403);
  assert.equal((await request("/api/evidence",{id:"x",checks:[]},auth)).status,403);
  const name="load-"+run+"-0";
  const member=await add(name,"student",run);assert.equal(member.status,201);
  const learnerPassword=(await member.json()).password;const login=await sign(name,learnerPassword);
  assert.equal(login.status,200);const session=cookie(login);
  const learner=await login.json();assert.equal(learner.validUntil,until);assert.equal(learner.cohort,"bench-"+run);
  const panel=await sign("review-panel",password+"panel");assert.equal(panel.status,200);assert.equal((await panel.json()).cohort,"committee-review");
  delete env.BENCHMARK_ACCESS;
  assert.equal((await request("/api/me",null,auth)).status,401);assert.equal((await request("/api/me",null,session)).status,401);
  assert.equal((await sign(name,learnerPassword)).status,401);
  assert.equal((await sign("benchmark-provisioner",password)).status,401);
});
