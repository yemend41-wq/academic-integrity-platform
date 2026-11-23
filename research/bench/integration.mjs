// Integration tests against the built Worker, actual Request/Response objects and real in-memory SQLite.
// Run from project root: node research/bench/integration.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import worker from '../../dist/server/index.js';
import { database } from '../../scripts/sqlite.mjs';
import { PUBLIC_SOURCES } from '../similarity/sources.mjs';

const base=new URL('./',import.meta.url);
const read=(name)=>readFile(new URL(name,base));
const digest=b=>createHash('sha256').update(b).digest('hex');
const secret=()=>randomBytes(24).toString('hex');
const passwords=Object.fromEntries(['evaluator','registrar','candidate','qa-affiliate'].map(u=>[u,secret()]));
const env={DB:database(),ACCOUNT_VERIFIERS:JSON.stringify(Object.fromEntries(Object.entries(passwords).map(([u,p])=>[u,digest(p)]))),MAINTENANCE_KEY:secret()};
const checks=[],raw=[];
const started=new Date().toISOString();
const origin='https://evaluation.invalid';
const sessions=new Map();
const reports=new Map();
const fixtures={
  docx:await read('fixtures/melville-3000.docx'),pdf:await read('fixtures/melville-3000.pdf'),
  arabic:await read('fixtures/arabic-format-signals.docx'),png:await read('../media/tests/fixtures/geometry.png'),
  jpeg:await read('../media/tests/fixtures/geometry.jpg'),credential:await read('../media/tests/fixtures/official-CA.jpg')
};
const reference=(await read('source/melville-excerpt.txt')).toString().trim().split(/\s+/u);
const manifest=JSON.parse(await read('fixtures/manifest.json'));
let current;
async function check(name,work){
  current=name;
  const t=performance.now();
  try{
    const detail=await work();
    checks.push({name,status:'passed',detail,ms:+(performance.now()-t).toFixed(3)});
  }catch(error){
    checks.push({name,status:'failed',detail:String(error.message).slice(0,700),ms:+(performance.now()-t).toFixed(3)});
  }
}
async function request(path,{user='',method='GET',data,bytes,headers={},sensitive=false}={}){
  const h=new Headers(headers);
  if(user && sessions.has(user))h.set('cookie',sessions.get(user));
  if(method!=='GET')h.set('origin',origin);
  if(data!==undefined)h.set('content-type','application/json');
  const req=new Request(origin+path,{method,headers:h,body:data!==undefined?JSON.stringify(data):bytes});
  const t=performance.now();
  const response=await worker.fetch(req,env,{});
  const payload=new Uint8Array(await response.arrayBuffer());
  const type=response.headers.get('content-type')||'';
  const obj=type.includes('json')?JSON.parse(new TextDecoder().decode(payload)):null;
  const ms=+(performance.now()-t).toFixed(3);
  const record={check:current,method,path:path.replace(/[0-9a-f-]{36}/g,'{report_id}'),status:response.status,bytes:payload.byteLength,ms};
  if(!sensitive)record.bodySha256=digest(payload);
  if(obj?.error)record.error=obj.error;
  raw.push(record);
  return {status:response.status,h:response.headers,obj,payload,ms};
}
async function upload(user,format,body,indexed=false){
  const r=await request('/api/analyze',{method:'POST',user,bytes:body,
    headers:{'content-type':'application/octet-stream','x-format':format,'x-index':indexed?'yes':'no'}});
  assert.equal(r.status,201,'upload status '+r.status+' '+(r.obj?.error||''));
  return r;
}
async function login(user,password= passwords[user]){
  const r=await request('/api/login',{method:'POST',data:{username:user,password},sensitive:true});
  assert.equal(r.status,200);
  const c=r.h.get('set-cookie');
  assert.match(c,/HttpOnly/);assert.match(c,/Secure/);assert.match(c,/SameSite=Lax/);
  sessions.set(user,c.split(';')[0]);
  return r.obj;
}
const txt=s=>new TextEncoder().encode(s);
const sourceLine='Seedlings in the west courtyard opened their first leaves at dawn after a night of steady rain.';
const paper=PUBLIC_SOURCES.find(x=>x.kind==='paper');
const quote=paper.text.split('\n').find(s=>s.trim().split(/\s+/).length>=14 && !s.includes('https'));
await check('Health, distinct roles and protected routes',async()=>{
  assert.equal((await request('/api/health')).obj.database,'reachable');
  assert.equal((await request('/api/reports')).status,401);
  const roles=[];
  for(const [account,role] of Object.entries({evaluator:'instructor',registrar:'admin',candidate:'student','qa-affiliate':'student'})){
    const u=await login(account);
    assert.equal(u.role,role);assert.equal((await request('/api/me',{user:account})).obj.role,role);
    roles.push(role);
  }
  assert.equal((await request('/api/login',{method:'POST',data:{username:'candidate',password:secret()},sensitive:true})).status,401);
  return {roles,unauthenticated:401,badCredentials:401,secureHttpOnlyCookies:true};
});
await check('Public bilingual assessment, no private report access', async () => {
  for (const [lang, title] of [['ar','سجل قبول ميزان'],['en','Mizan acceptance register']]) {
    const response = await worker.fetch(new Request(origin + '/acceptance?lang=' + lang),env,{});
    assert.equal(response.status,200);
    const page = await response.text();
    assert.ok(page.includes(title) && page.includes('AIP-HL-3'));
    assert.ok(page.includes('/detector-study?lang=') && page.includes('ArguGPT') && !page.includes('sourceSha256'));
    assert.equal(response.headers.get('content-type'),'text/html; charset=utf-8');
  }
  assert.equal((await request('/api/health/details')).status,401);
  return {publicLocales:['ar','en'],privateDetailsHttp:401};
});
for(const fmt of ['docx','pdf','png','jpeg']){
  await check('Upload and persisted readback: '+fmt,async()=>{
    const bytes=fixtures[fmt];
    const a=await upload('candidate',fmt,bytes);const doc=a.obj;
    assert.equal(doc.format,fmt);assert.ok(doc.detector&&doc.similarity);
    assert.equal(doc.indexed,false);
    const stored=await request('/api/reports/'+doc.id,{user:'candidate'});
    assert.deepEqual(stored.obj,doc);
    if(fmt==='docx'||fmt==='pdf'){
      assert.equal(doc.words,3000);assert.deepEqual(doc.text.trim().split(/\s+/u),reference);
    }else{assert(doc.forensics.width>0&&doc.forensics.height>0);assert.equal(doc.words,0);}
    reports.set(fmt,doc);
    return {format:fmt,inputSha256:digest(bytes),words:doc.words,reportId:doc.id,uploadMs:a.ms,persistedEqual:true};
  });
}
await check('Media provenance: embedded C2PA',async()=>{
  const data=(await upload('candidate','jpeg',fixtures.credential)).obj;
  assert(!['no_embedded_manifest_found','unsupported','unreadable_media'].includes(data.provenance.status));
  assert(/c2pa|manifest|credent/i.test(JSON.stringify(data.provenance)));
  return {inputSha256:digest(fixtures.credential),status:data.provenance.status,trust:data.provenance.trust,reportId:data.id};
});
await check('Arabic DOCX forensics and privacy',async()=>{
  const r=(await upload('candidate','docx',fixtures.arabic)).obj;
  assert.match(r.text,/جمع الفريق/);assert.equal(r.forensics.hiddenTextRuns,1);assert.equal(r.forensics.whiteTextRuns,1);
  assert.equal(r.forensics.zeroWidthCharacters,1);assert.equal(r.forensics.paraIdDiversity,7);
  assert.doesNotMatch(JSON.stringify(r),/pen@example\.invalid|AA123456/);
  const row=await env.DB.prepare('SELECT body,audit FROM documents WHERE id=?').bind(r.id).first();
  assert.doesNotMatch(JSON.stringify(row),/pen@example\.invalid|AA123456/);
  reports.set('arabic',r);
  return {inputSha256:digest(fixtures.arabic),words:r.words,hidden:1,white:1,zeroWidth:1,uniqueParagraphIds:7,maskedInDatabase:true};
});
await check('JSON audit and bilingual downloadable PDF exports',async()=>{
  const r=reports.get('arabic');
  const j=await request('/api/reports/'+r.id+'/json',{user:'evaluator'});
  assert.deepEqual(j.obj,r);assert.match(j.h.get('content-disposition'),/attachment/);
  const results=[];
  for(const lang of ['en','ar']){
    const a=await request('/api/reports/'+r.id+'/pdf?lang='+lang,{user:'evaluator'});
    assert.equal(a.status,200);assert.match(a.h.get('content-type'),/^application\/pdf/);assert.match(a.h.get('content-disposition'),/attachment/);
    const parse=spawnSync('python',['-c',`import io,sys,json
from pypdf import PdfReader
r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));t=" ".join(p.extract_text() for p in r.pages)
print(json.dumps({"pages":len(r.pages),"text":t}))`],{input:a.payload});
    assert.equal(parse.status,0,parse.stderr.toString().slice(-200));
    const parsed=JSON.parse(parse.stdout);
    assert(parsed.pages>=1);assert(parsed.text.includes(r.id));assert.doesNotMatch(parsed.text,/pen@example\.invalid|AA123456/);
    if(lang==='en')assert.match(parsed.text,/Similarity/);
    if(lang==='ar')assert.match(parsed.text,/\p{Script=Arabic}/u);
    results.push({language:lang,bytes:a.payload.byteLength,pages:parsed.pages,sha256:digest(a.payload),reportIdFound:true});
  }
  return {jsonExact:true,pdf:results};
});
await check('TXT indexing and duplicate in same cohort',async()=>{
  const r=(await upload('candidate','txt',txt(sourceLine),true)).obj;
  const copy=(await upload('evaluator','txt',txt(sourceLine))).obj;
  assert.equal(copy.similarity.percentage,100);assert(copy.similarity.matches.some(m=>m.sourceId===r.id&&m.method==='verbatim'));
  reports.set('teacher',copy);reports.set('indexed',r);
  return {first:r.id,second:copy.id,coverage:copy.similarity.percentage,method:'verbatim'};
});
await check('Published paper and quote exclusion switch',async()=>{
  const plain=(await upload('evaluator','txt',txt(quote))).obj;
  assert(plain.similarity.matches.some(m=>m.sourceId===paper.id&&m.sourceUrl===paper.url));
  const quoted=(await upload('evaluator','txt',txt('“'+quote+'”'))).obj;
  assert.equal(quoted.similarity.matchedWords,0);
  const included=await request('/api/reports/'+quoted.id+'/similarity?quotes=include',{user:'evaluator'});
  assert.equal(included.status,200);assert.equal(included.obj.percentage,100);
  return {publicPaper:paper.url,excludedWords:quoted.similarity.eligibleWords,includedCoverage:included.obj.percentage};
});
await check('Student, instructor and cross-course isolation',async()=>{
  const r=reports.get('indexed'),peer=reports.get('teacher');
  assert.equal((await request('/api/reports/'+r.id,{user:'evaluator'})).status,200);
  assert.equal((await request('/api/reports/'+peer.id,{user:'candidate'})).status,404);
  assert.equal((await request('/api/reports/'+r.id,{user:'qa-affiliate'})).status,404);
  assert.equal((await request('/api/reports',{user:'qa-affiliate'})).obj.reports.length,0);
  const other=(await upload('qa-affiliate','txt',txt(sourceLine))).obj;
  assert.equal(other.similarity.cohortCompared,0);assert(!other.similarity.sources.some(s=>s.id===r.id));
  assert.equal((await request('/api/reports/'+other.id,{user:'registrar'})).status,404);
  return {instructorOwnCourse:200,studentPeer:404,studentOtherCourse:404,adminOtherCourse:404,indexSegregated:true};
});
await check('Membership administration and evidence permissions',async()=>{
  const data={username:'local-student',role:'student'};
  for(const user of ['candidate','evaluator']){
    assert.equal((await request('/api/members',{method:'POST',data,user})).status,403);
    assert.equal((await request('/api/evidence',{method:'POST',data:{id:'local',checks:[]},user})).status,403);
  }
  const created=await request('/api/members',{method:'POST',data,user:'registrar',sensitive:true});assert.equal(created.status,201);
  assert.equal((await login(data.username,created.obj.password)).role,'student');
  assert.equal((await request('/api/members',{method:'POST',data,user:'registrar'})).status,409);
  return {studentAndInstructorCreateDenied:403,adminCreated:201,duplicate:409};
});
await check('Clarity edits, active time, bulk paste, replay and submission',async()=>{
  const user='candidate',draft='/api/draft';
  const before=(await request(draft,{user})).obj;assert.equal(before.revision,0);
  const event1={type:'type',text:'Notes',activeMs:1200};
  const event2={type:'paste',text:'Notes. '+sourceLine,activeMs:6800};
  const result=await request(draft,{method:'POST',user,data:{revision:0,events:[event1,event2]}});
  assert.equal(result.status,200);assert.equal(result.obj.activeMs,8000);
  const old=await request(draft,{method:'POST',user,data:{revision:0,events:[event1]}});assert.equal(old.status,409);
  const saved=(await request(draft,{user})).obj;
  let reconstructed='';
  const replay=saved.events.map(e=>{
    reconstructed=reconstructed.slice(0,e.start)+e.insert+reconstructed.slice(e.start+e.remove);return reconstructed;
  });
  assert.deepEqual(replay,[event1.text,event2.text]);assert.equal(saved.events[1].bulk,true);
  const report=await request(draft+'/submit',{method:'POST',user,data:{revision:1,index:false}});
  assert.equal(report.status,201);assert.equal(report.obj.text,event2.text);
  assert.deepEqual(report.obj.telemetry,{activeMs:8000,edits:2,bulkPastes:1});
  reports.set('draft',report.obj);
  return {revision:1,activeMs:8000,replayedSnapshots:2,bulkPastes:1,staleSave:409,reportId:report.obj.id};
});
await check('Invalid document and missing session',async()=>{
  const r=await request('/api/analyze',{method:'POST',bytes:fixtures.docx,user:'candidate',headers:{'x-format':'pdf'}});
  assert.equal(r.status,422);
  const no=await request('/api/analyze',{method:'POST',bytes:fixtures.docx,headers:{'x-format':'docx'}});
  assert.equal(no.status,401);
  const empty=await request('/api/analyze',{method:'POST',bytes:new Uint8Array(),user:'candidate',headers:{'x-format':'txt'}});
  assert.equal(empty.status,422);
  return {formatMismatch:r.status,anonymous:no.status,empty:empty.status};
});
await check('Built Worker local 50-upload and report-readback batch',async()=>{
  const t=performance.now();
  const docs=await Promise.all(Array.from({length:50},async(_,i)=>{
    const fmt=i%2?'docx':'pdf';
    const r=await upload('evaluator',fmt,fixtures[fmt]);
    assert.equal(r.obj.words,3000);
    assert.deepEqual(r.obj.text.trim().split(/\s+/u),reference);
    const restored=(await request('/api/reports/'+r.obj.id,{user:'evaluator'})).obj;
    assert.deepEqual(restored,r.obj);
    return {id:r.obj.id,ms:r.ms};
  }));
  assert.equal(new Set(docs.map(x=>x.id)).size,50);
  const times=docs.map(x=>x.ms).sort((a,b)=>a-b);
  return {requested:50,uniquePersisted:50,files:{docx:25,pdf:25},accounts:1,localSingleProcess:true,
    wallMs:+(performance.now()-t).toFixed(2),p50Ms:times[24],p95Ms:times[47],maxMs:times[49],under15s:times.filter(t=>t<15000).length};
});
await check('Expired test rows and scheduled handler',async()=>{
  const r=reports.get('draft');
  const before=await env.DB.prepare('SELECT COUNT(*) AS n FROM documents').first();
  // Move two real test rows past expiry without altering the host clock or waiting seven days.
  await env.DB.prepare('UPDATE documents SET expires=0 WHERE id=?').bind(r.id).run();
  await env.DB.prepare('UPDATE drafts SET expires=0 WHERE owner=?').bind('candidate').run();
  assert.equal((await request('/api/reports/'+r.id,{user:'evaluator'})).status,404);
  assert.equal((await request('/api/draft',{user:'candidate'})).obj.revision,0);
  const tasks=[];await worker.scheduled({scheduledTime:Date.now()},env,{waitUntil:p=>tasks.push(p)});
  await Promise.all(tasks);assert(tasks.length>0);
  const after=await env.DB.prepare('SELECT COUNT(*) AS n FROM documents').first();
  assert.equal(after.n,before.n-1);
  assert.equal(await env.DB.prepare('SELECT owner FROM drafts WHERE owner=?').bind('candidate').first(),null);
  return {expiredRead:404,removedDocuments:before.n-after.n,removedDrafts:1,handler:'manually invoked bundled scheduled hook; production schedule not exercised'};
});
await check('Logout invalidates saved session',async()=>{
  assert.equal((await request('/api/logout',{user:'candidate',method:'POST'})).status,200);
  assert.equal((await request('/api/me',{user:'candidate'})).status,401);
  return {afterLogout:401};
});
env.DB.close();
const result={scope:'Local built ESM Worker, Node Fetch API, real SQLite adapter. One process, no external HTTP or hosted D1. Timings are not public SLAs.',runtime:process.version,started,finished:new Date().toISOString(),builtBundleSha256:digest(await read('../../dist/server/index.js')),fixtures:manifest.files.map(({file,sha256})=>({file,sha256})),checks,raw};
await writeFile(process.env.MIZAN_INTEGRATION_EVIDENCE || new URL('integration-results.json',base),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(checks,null,2));
if(checks.some(r=>r.status!=='passed'))process.exitCode=1;
