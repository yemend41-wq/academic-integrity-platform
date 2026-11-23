import {build} from 'esbuild';
import {Miniflare,Log,LogLevel} from 'miniflare';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const directory=fileURLToPath(new URL('..',import.meta.url));
const script=(await build({stdin:{contents:`
import {inspectFile} from './index.mjs';
export default {async fetch(req){try{let r=await inspectFile(new Uint8Array(await req.arrayBuffer()),new URL(req.url).pathname.slice(1));return Response.json(r)}catch(e){return Response.json({error:e.message},{status:422})}}};`,
 resolveDir:directory},bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,write:false})).outputFiles[0].text;
const mf=new Miniflare({modules:true,script,compatibilityDate:'2025-11-01',log:new Log(LogLevel.ERROR)});
const cases=[
 ['tests/fixtures/bilingual-forensics.docx',r=>r.forensics.editingMinutes===17&&r.text.includes('العربية')],
 ['tests/fixtures/bilingual-text.pdf',r=>r.text.includes('كتابة جامعية عربية')],
 ['tests/fixtures/official-CA.jpg',r=>r.provenance.signature==='verified_with_embedded_leaf'&&r.provenance.assetBinding==='match'],
 ['tests/fixtures/geometry.png',r=>r.provenance.status==='no_embedded_manifest_found'],
 ['../similarity/training/pyarabic-published.pdf',r=>r.forensics.pageCount===6&&r.text.toLowerCase().includes('10.21105/joss.04886')]
];
const result={runtime:'local workerd / Miniflare',at:new Date().toISOString(),cases:[]};
try{
 for(const [f,check] of cases){
   const file=path.basename(f),body=await fs.readFile(path.join(directory,f)),start=performance.now();
   try{
     const res=await mf.dispatchFetch('http://worker.test/'+file,{method:'POST',body});
     const r=await res.json();const passed=res.ok&&Boolean(check(r));
     result.cases.push({file,status:res.status,passed,parseHttpMs:Math.round(performance.now()-start),error:r.error});
   }catch(e){result.cases.push({file,passed:false,error:e.message})}
 }
} finally {await mf.dispose()}
await fs.writeFile(path.join(directory,'tests/edge-media-results.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
if(result.cases.some(c=>!c.passed))process.exitCode=1;
