import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [out, module] = process.argv.slice(2);
if (!out) throw new Error('Usage: rtl-fixture.mjs OUTPUT [AUDIT_MODULE]');
const url = module ? pathToFileURL(resolve(module)) : new URL('../audit.mjs', import.meta.url);
const {createAuditPdf} = await import(url);
await mkdir(out, {recursive:true});
for (const locale of ['ar','en']) {
  const ar = locale === 'ar';
  const pdf = createAuditPdf({
    locale, id:'849e3a01-b619-4a34-9b86-c8e80c5509c2', createdAt:'2026-11-23T18:30:45.000Z',
    sections:[{title:ar ? 'فحص المستند' : 'Document inspection', rows:[
      {label:ar ? 'الكمية' : 'Quantity', value:'2345'},
      {label:ar ? 'اسم النموذج' : 'Model name', value:'AIP-HL-3'},
      {label:ar ? 'أصل العبارة' : 'Source passage', value:'راجع المدرِّس الملف PDF يوم 23-11-2026 ثم كتب الملاحظات.'},
      {label:ar ? 'مرجع' : 'Reference', value:'https://example.org/paper/2026-11-23?stage=2'},
    ]}],
  });
  await writeFile(resolve(out,locale+'.pdf'),pdf);
}
