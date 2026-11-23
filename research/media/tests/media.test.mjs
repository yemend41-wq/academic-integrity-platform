import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inspectFile} from '../index.mjs';
import {findReferences,validISBN,canonicalISBN,verifyReferences} from '../citations.mjs';
const file=name=>fs.readFile(new URL('fixtures/'+name,import.meta.url));
test('Word package reads bilingual prose, editing metadata, formatting and embedded media',async()=>{
  const r=await inspectFile(await file('bilingual-forensics.docx'),'bilingual-forensics.docx');
  assert.match(r.text,/العربية/);assert.doesNotMatch(r.text,/Paper-white|Hidden for test/);
  assert.equal(r.forensics.hiddenTextRuns,1);assert.equal(r.forensics.whiteTextRuns,1);
  assert.equal(r.forensics.zeroWidthCharacters,1);assert.equal(r.forensics.mixedLatinCyrillicWords,1);
  assert.equal(r.forensics.ukSpellingTokens,1);assert.equal(r.forensics.usSpellingTokens,1);
  assert.ok(r.forensics.rsidDiversity>=2);assert.equal(r.forensics.paraIdDiversity,2);
  assert.ok(r.forensics.pageSizes[0].widthMm>200);assert.ok(r.forensics.fonts.includes('Liberation Sans'));
  assert.ok(r.forensics.hexColors.includes('#27788A'));assert.equal(r.forensics.editingMinutes,17);
  assert.equal(r.forensics.core.revision,'4');assert.equal(r.forensics.embeddedMedia[0].format,'PNG');
  assert.doesNotMatch(JSON.stringify(r.forensics),/Example Reviewer/);
});
test('PDF parser reads both scripts from an actual paginated file',async()=>{
  const r=await inspectFile(await file('bilingual-text.pdf'),'bilingual-text.pdf');
  assert.match(r.text,/library catalog/);assert.match(r.text,/كتابة جامعية عربية/u);
  assert.equal(r.forensics.pageCount,1);assert.equal(r.forensics.pageSizes[0].widthPt,595.28);
  assert.ok(r.forensics.endOfFileMarkers>=1);assert.ok(r.forensics.fontFamilies.length>0);
});
test('Unsigned image files expose true PNG chunks and JPEG markers and dimensions',async()=>{
  const p=await inspectFile(await file('geometry.png'),'geometry.png'),j=await inspectFile(await file('geometry.jpg'),'geometry.jpg');
  assert.equal(p.forensics.width,100);assert.equal(p.forensics.chunks.tEXt,1);assert.ok(p.forensics.chunks.IDAT);
  assert.equal(j.forensics.height,75);assert.ok(j.forensics.headerSegments.APP0);
  assert.equal(p.provenance.status,'no_embedded_manifest_found');assert.equal(j.provenance.trust,'not_evaluated');
});
test('Authentic upstream C2PA JPEG passes leaf, assertion and asset checks without claiming trust',async()=>{
  const b=await file('official-CA.jpg'),r=await inspectFile(b,'signed.jpg');
  assert.equal(r.provenance.status,'manifest_read');assert.equal(r.provenance.signature,'verified_with_embedded_leaf');
  assert.equal(r.provenance.assetBinding,'match');assert.equal(r.provenance.assertionHashes,'match');assert.equal(r.provenance.trust,'not_evaluated');
  // Ordinary JFIF metadata edit: change the horizontal pixel density.
  const changed=Uint8Array.from(b);changed[15]=2;
  const edited=await inspectFile(changed,'edited.jpg');assert.equal(edited.provenance.assetBinding,'mismatch');
});
test('Extension checking and unsupported-file handling',async()=>{
  await assert.rejects(inspectFile(await file('geometry.png'),'source.pdf'),/extension/);
  await assert.rejects(inspectFile(new Uint8Array([65,66,67]),'text.txt'),/Unsupported/);
});
test('Citation extraction preserves balanced DOI brackets and normalizes Arabic ISBN punctuation',async()=>{
  const refs=findReferences('study (10.1000/AAA(test)). ردمك ٩٧٨-٠-٣٠٦-٤٠٦١٥-٧. ISBN 0-8044-2957-X.');
  assert.deepEqual(refs.map(r=>r.id),['10.1000/aaa(test)','9780306406157','080442957X']);
  assert.ok(validISBN('9780306406157'));assert.ok(validISBN('080442957X'));assert.equal(validISBN('9780306406158'),false);
  assert.equal((await verifyReferences('ISBN 9780306406158'))[0].status,'invalid_checksum');
});

test('ISBN records match only the same valid edition across 10- and 13-digit encodings',()=>{
  // Springer hardcover, paperback and eBook editions of the 1981 Clark/Cain book.
  assert.equal(canonicalISBN('0-306-40615-2'),'9780306406157');
  assert.equal(canonicalISBN('978-0-306-40615-7'),'9780306406157');
  assert.notEqual(canonicalISBN('978-1-4899-2176-5'),canonicalISBN('0-306-40615-2'));
  assert.notEqual(canonicalISBN('978-1-4899-2174-1'),canonicalISBN('0-306-40615-2'));
  assert.equal(canonicalISBN('9780306406158'),null);
  assert.equal(canonicalISBN('080442957X'),'9780804429573');
  assert.equal(canonicalISBN('9791090636071'),'9791090636071');
});
