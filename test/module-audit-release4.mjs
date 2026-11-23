// Run from the project root: node test/module-audit-release4.mjs
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {database} from '../scripts/sqlite.mjs';
import {analyze,getReport} from '../src/analysis.mjs';
import {pdfAudit} from '../src/report.mjs';
import {getDraft,saveDraft} from '../src/drafts.mjs';
import {activeInterval,timeline} from '../research/clarity/history.mjs';
import {inspectFile} from '../research/media/index.mjs';

const dir=await mkdtemp(join(tmpdir(),'mizan-real-files-'));
const env={DB:database()};
const reviewer={id:'qa-reader',cohort:'local',role:'instructor'};
const student={id:'qa-writer',cohort:'local',role:'student'};
const options={excludeQuotes:true,excludeReferences:true};
const sha=value=>createHash('sha256').update(value).digest('hex');
const evidence={started:new Date().toISOString(),environment:'Local Work Node '+process.version+'; application analysis, draft, PDF, and persistence functions, in-memory SQLite; no HTTP hosting SLA',inputs:{},checks:[],registry:[]};
const pdfProbe=`
import json,re,sys
from pypdf import PdfReader
from pymupdf import open as open_pdf
path,locale,doc_id=sys.argv[1:]
doc=PdfReader(path,strict=True)
logical=[]
root=doc.trailer['/Root']
if '/StructTreeRoot' in root:
 for part in root['/StructTreeRoot']['/K']:
  for child in part.get_object()['/K']:
   block=child.get_object()
   logical.append(str(block.get('/ActualText') or block.get('/Alt') or ''))
else:
 for p in doc.pages:
  for hexstr in re.findall(rb'/ActualText\\s*<([a-fA-F0-9]+)>',p.get_contents().get_data()):
   logical.append(bytes.fromhex(hexstr.decode()).decode('utf-16'))
text='\\n'.join(logical)
title='Academic integrity audit' if locale=='en' else 'تقرير تدقيق النزاهة الأكاديمية'
assert title in text and doc_id in text and len(doc.pages)>0
for private in ['release.fixture','@example.test','9123','4567','QA Reviewer','Example Reviewer']:
 assert private not in text
with open_pdf(path) as rendered:
 for page in rendered:
  assert len(set(page.get_pixmap().samples))>8
print(json.dumps({'pages':len(doc.pages),'logicalFields':len(logical),'renderedAllPages':True,'localeTitleFound':True,'unmaskedTestIdentifiersAbsent':True}))
`;
async function check(name,fn){
 try{const detail=await fn();evidence.checks.push({name,status:'passed',detail});}
 catch(error){evidence.checks.push({name,status:'failed',detail:String(error.message).slice(0,420)});}
}
async function input(name,file){
 const bytes=await readFile(file);evidence.inputs[name]={bytes:bytes.length,sha256:sha(bytes)};return bytes;
}
const fixture=name=>'research/media/tests/fixtures/'+name;
try{
 const docFile=join(dir,'revisions.docx');
 execFileSync('python',['research/media/tests/make-revision-fixture.py',docFile]);
 const docx=await input('revisions.docx',docFile);
 // Optional comparison with the saved release-3 Worker bundle. Both use
 // local SQLite and the identical DOCX bytes, with no remote account data.
 if(process.argv[2]){
  const baselinePath=resolve(process.argv[2]),worker=(await import(pathToFileURL(baselinePath))).default;
  const baseline={DB:database()};
  try{
   const password=crypto.randomUUID();baseline.ACCOUNT_VERIFIERS=JSON.stringify({candidate:sha(password)});
   const origin='https://mizan-regression.invalid';
   const signin=await worker.fetch(new Request(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'candidate',password})}),baseline,{});
   assert.equal(signin.status,200);const cookie=signin.headers.get('set-cookie').split(';')[0];
   const response=await worker.fetch(new Request(origin+'/api/analyze',{method:'POST',headers:{cookie,'x-format':'docx','x-index':'no'},body:docx}),baseline,{});
   assert.equal(response.status,201);
   const old=await response.json();
   evidence.baseline={workerSHA256:sha(await readFile(baselinePath)),fixtureSHA256:sha(docx),hiddenRuns:old.forensics.hiddenTextRuns,whiteRuns:old.forensics.whiteTextRuns,
    includesInactiveMovedText:old.text.includes('MOVE_OLD'),omitsVisiblePreviousFormatting:!old.text.includes('PREVIOUS_FORMAT_VISIBLE'),includesInheritedHidden:old.text.includes('INHERITED_HIDDEN'),
    containsUnmaskedFixtureTelephone:old.text.includes('9123 4567')};
  }finally{baseline.DB.close();}
 }
 await check('OOXML visible text, revisions, metadata and inherited styles',async()=>{
  const result=await inspectFile(docx,'revisions.docx'),f=result.forensics;
  const found=['PREVIOUS_FORMAT_VISIBLE','TOGGLED_VISIBLE','DIRECT_VISIBLE','PARAGRAPH_OVERRIDE_VISIBLE','NEW_INSERTION','MOVE_NEW'];
  const absent=['MOVE_OLD','OLD_DELETION','INHERITED_HIDDEN','INHERITED_WHITE','PARAGRAPH_HIDDEN'];
  for(const t of found)assert(result.text.includes(t),t);
  for(const t of absent)assert(!result.text.includes(t),t);
  assert.deepEqual([f.hiddenTextRuns,f.whiteTextRuns,f.trackedInsertions,f.trackedDeletions,f.editingMinutes,f.core.revision],[3,2,1,1,17,'4']);
  assert(f.hexColors.includes('#27788A')&&f.fonts.includes('Liberation Sans'));
  assert.equal(f.zeroWidthCharacters,1);assert.equal(f.mixedLatinCyrillicWords,1);
  return {hiddenRuns:f.hiddenTextRuns,whiteRuns:f.whiteTextRuns,trackedInsertions:f.trackedInsertions,trackedDeletions:f.trackedDeletions,editingMinutes:f.editingMinutes,coreRevision:f.core.revision,visibleMarkers:found,excludedMarkers:absent,dimensions:f.pageSizes};
 });
 await check('PDF text in two scripts and physical page size',async()=>{
  const bytes=await input('bilingual-text.pdf',fixture('bilingual-text.pdf'));
  const {text,forensics,provenance}=await inspectFile(bytes,'input.pdf');
  assert.match(text,/library catalog/);assert.match(text,/كتابة جامعية عربية/);
  assert.deepEqual(forensics.pageSizes,[{widthPt:595.28,heightPt:841.89}]);
  assert.equal(provenance.status,'no_document_level_manifest_found');
  return {pages:forensics.pageCount,pageSizes:forensics.pageSizes,fontFamilies:forensics.fontFamilies,provenance};
 });
 await check('Unsigned media dimensions and actual chunk and segment records',async()=>{
  const png=await inspectFile(await input('geometry.png',fixture('geometry.png')),'input.png');
  const jpeg=await inspectFile(await input('geometry.jpg',fixture('geometry.jpg')),'input.jpg');
  for(const r of [png,jpeg]){
   assert.deepEqual([r.forensics.width,r.forensics.height,r.provenance.status],[100,75,'no_embedded_manifest_found']);
  }
  assert(png.forensics.chunks.IDAT&&png.forensics.chunks.tEXt&&jpeg.forensics.headerSegments.APP0);
  return {png:png.forensics.chunks,jpeg:jpeg.forensics.headerSegments};
 });
 await check('C2PA signed asset and a controlled metadata-only edit',async()=>{
  const original=await input('official-CA.jpg',fixture('official-CA.jpg')),edited=Uint8Array.from(original);
  edited[15]=2;assert.notEqual(sha(original),sha(edited));
  const first=(await inspectFile(original,'original.jpg')).provenance,second=(await inspectFile(edited,'edited.jpg')).provenance;
  const select=r=>({signature:r.signature,binding:r.assetBinding,assertions:r.assertionHashes,trust:r.trust});
  const expected={signature:'verified_with_embedded_leaf',binding:'match',assertions:'match',trust:'not_evaluated'};
  assert.deepEqual(select(first),expected);assert.deepEqual(select(second),{...expected,binding:'mismatch'});
  return {original:select(first),edited:select(second),changedInputSHA256:sha(edited)};
 });
 const audit=await analyze(env,student,{bytes:docx,kind:'docx',indexed:true,options});
 const saved=await getReport(env,reviewer,audit.id);
 await check('PII removed from source, stored index, JSON and file properties',async()=>{
  assert.equal(saved.text,audit.text);
  const row=await env.DB.prepare('SELECT body,audit FROM documents WHERE id=?').bind(saved.id).first();
  const serialized=JSON.stringify([audit,saved,row]);
  for(const t of ['release.fixture','@example.test','9123','4567','QA Reviewer','Example Reviewer'])assert(!serialized.includes(t),'unexpected private marker');
  assert(saved.text.includes('█')&&saved.text.includes('PREVIOUS_FORMAT_VISIBLE'));
  return {maskedCodeUnits:saved.text.split('█').length-1,inspectionPassed:true,SQLiteReadback:true};
 });
 for(const lang of ['en','ar'])await check('PDF audit '+lang+' generated, reopened and rendered',async()=>{
  const path=join(dir,lang+'.pdf'),bytes=pdfAudit(saved,lang);
  await writeFile(path,bytes);
  return {...JSON.parse(execFileSync('python',['-c',pdfProbe,path,lang,saved.id],{encoding:'utf8'})),bytes:bytes.length,sha256:sha(bytes)};
 });
 const expected={'10.1038/nature12373':'verified','10.99999/mizan-no-record-2026':'not_found','9780306406157':'verified','9780306406158':'invalid_checksum'};
 for(const [id,intended] of Object.entries(expected)){
  const ref=saved.citations.find(r=>r.id===id),status=ref?.status||'missing';
  const result=status===intended?'passed':['registry_unavailable','lookup_budget_exceeded'].includes(status)?'unverified':'failed';
  evidence.registry.push({id,expected:intended,actual:status,result,registry:ref?.registry??null,attempts:ref?.attempts??[]});
 }
 await check('Clarity known typing, long idle period, paste and replacement',async()=>{
  const texts=['Reading', 'Reading notes.', 'Reading notes. أضفت فقرة عربية لمقارنة سجل الإدراج بزمن التوقف وطريقة تعديل المستند.', 'Reading log. أضفت فقرة عربية لمقارنة سجل الإدراج بزمن التوقف وطريقة تعديل المستند.'];
  const times=[1000,1750,24000,24800],kinds=['type','type','paste','replace'];
  const payload=texts.map((text,i)=>({type:kinds[i],text,activeMs:activeInterval(i?times[i-1]:null,times[i])}));
  const req=new Request('https://local.invalid/api/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:0,events:payload})});
  assert.equal((await saveDraft(env,student,req)).status,200);
  const stored=await getDraft(env,student),replay=timeline(stored.events);
  assert.deepEqual(stored.events.map(e=>e.activeMs),[0,750,0,800]);assert.equal(stored.activeMs,1550);
  assert.deepEqual(stored.events.map(e=>e.kind),kinds);assert.deepEqual(stored.events.map(e=>e.bulk),[false,false,true,false]);
  const frames=['',...texts];for(const [i,t] of frames.entries())assert.equal(replay(i),t);
  return {inputGestureMs:times,elapsedGapBeforePasteMs:22250,activeMs:stored.activeMs,bulkPastes:1,frameDigests:frames.map(sha)};
 });
}finally{
 env.DB.close();await rm(dir,{recursive:true,force:true});
}
evidence.finished=new Date().toISOString();
const versionedFiles=['research/media/index.mjs','research/media/xml.mjs','research/media/word-visibility.mjs','research/media/citations.mjs','research/media/c2pa.mjs','research/clarity/history.mjs','research/clarity/redaction.mjs','src/privacy.mjs','src/analysis.mjs','src/drafts.mjs','src/report.mjs','test/module-audit-release4.mjs','research/media/tests/make-revision-fixture.py'];
evidence.sourceSha256=Object.fromEntries(await Promise.all(versionedFiles.map(async f=>[f,sha(await readFile(f))])));
await writeFile(process.env.MIZAN_MODULE_EVIDENCE || 'evidence/module-audit-release4.json',JSON.stringify(evidence,null,2)+'\n');
console.log(evidence.checks.map(({name,status})=>[status,name]));console.log(evidence.registry.map(({id,result,actual})=>[id,result,actual]));
if(evidence.checks.some(r=>r.status==='failed')||evidence.registry.some(r=>r.result==='failed'))process.exitCode=1;
