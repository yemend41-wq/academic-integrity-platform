import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectFile} from '../index.mjs';
import {verifyReferences,findReferences} from '../citations.mjs';
const base=fileURLToPath(new URL('.',import.meta.url));
const files=['fixtures/bilingual-forensics.docx','fixtures/bilingual-text.pdf','fixtures/official-CA.jpg',
  'fixtures/geometry.png','fixtures/geometry.jpg','../../similarity/training/pyarabic-published.pdf'];
const observations=[];
for(const file of files){
  const buffer=await fs.readFile(path.join(base,file));
  const start=performance.now();const r=await inspectFile(buffer,path.basename(file));
  observations.push({file:path.basename(file),sha256:createHash('sha256').update(buffer).digest('hex'),bytes:buffer.length,
    format:r.format,parseMs:Math.round((performance.now()-start)*10)/10,
    chars:r.text.length,pages:r.forensics.pageCount||null,ids:findReferences(r.text).map(x=>x.id),provenance:r.provenance});
}
const refs=await verifyReferences('10.21105/joss.04886; 10.99999/mizan-no-record-2026; ISBN 9780306406157, ISBN 9780306406158');
const log={observedAt:new Date().toISOString(),runtime:process.version,environment:'Work Node process; restricted outbound network',observations,refs,
  notes:['Parser timings exclude authentication, indexing and HTTP transport.','The external registry status recorded here is the runtime outcome.','C2PA trust list and certificate revocation are not evaluated.']};
await fs.writeFile(path.join(base,'media-evidence.json'),JSON.stringify(log,null,2)+'\n');
