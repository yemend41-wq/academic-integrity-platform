import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createAuditPdf} from '../audit.mjs';

const out = process.argv[2];
if (!out) throw new Error('Supply an output directory for test artifacts');
await mkdir(out,{recursive:true});
const source = await readFile(new URL('../vendor/font-LICENSE.txt',import.meta.url));
const enRows = source.toString().split('\n').map(s=>s.trim()).filter(Boolean);
const digest = createHash('sha256').update(source).digest('hex');
const observedAt = new Date().toISOString();
const summaries = [];
for (const locale of ['en','ar']) {
  const report = {
    id:'export-qa-'+digest.slice(0,12), createdAt:observedAt, locale,
    sections:[
      {title: locale==='en'?'File inspection':'فحص المستند',
       rows:[
         {label:'SHA-256',value:digest},
         {label:locale==='en'?'Source file':'اسم الملف',value:'font-LICENSE.txt'},
         {label:locale==='en'?'Byte count':'حجم المستند',value:String(source.length)},
         {label:locale==='en'?'Languages':'اللغات',value:'اختبار تَشْكِيل وتداخل اللغات. Reference ID 2026-11-23-A يحتوي تاريخاً قابلاً للقراءة.'}
       ]},
      {title:locale==='en'?'Source lines':'أسطر المصدر',rows:enRows.map((value,i)=>({label:'L'+(i+1),value}))},
      {title:locale==='en'?'Identifier wrapping':'التفاف المعرّفات', rows:[
        {label: 'SHA-256 × 3',value:digest.repeat(3)},
        {label:'Final marker',value:'PDF_EXPORT_END'}
      ]}
    ]
  };
  const start=performance.now();
  const bytes = createAuditPdf(report);
  const ms = performance.now()-start;
  await writeFile(resolve(out,locale+'.pdf'),bytes);
  summaries.push({locale,bytes:bytes.length,ms:Math.round(ms*10)/10});
}
await writeFile(resolve(out,'runs.json'),JSON.stringify({sourceSHA256:digest,sourceBytes:source.length,observedAt,summaries},null,2));
