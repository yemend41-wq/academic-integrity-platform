import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {tokenize} from '../../detector/features.mjs';
import {inspectFile} from '../index.mjs';
import {wordXML} from '../xml.mjs';
import {writingWordXML} from '../word-writing.mjs';

const dir = new URL('./fixtures/writing-intake/', import.meta.url);
const truth = JSON.parse(await readFile(new URL('truth.json',dir)));
const release5 = JSON.parse(await readFile(new URL('release5-hashes.json',dir)));
const sha = input => createHash('sha256').update(input).digest('hex');
const reading = result => result.writingText ?? result.text;
const noMarks = s => s.replace(/\p{M}/gu, '');
const terms = s => tokenize(s).map(w => w.term);
const trimLines = s => s.split('\n').map(l => l.trim()).join('\n');

const results = new Map();
async function intake(name) {
  if (!results.has(name)) {
    const file=await readFile(new URL(name,dir));
    assert.equal(sha(file),release5[name].file);
    const result=await inspectFile(file,name);
    assert.equal(sha(result.text),release5[name].legacyText,`${name} similarity input changed`);
    results.set(name,result);
  }
  return results.get(name);
}

for (const name of ['bilingual','breaks','alternate','textbox']) {
  test(`Word preserves native visible paragraphs and legacy similarity input: ${name}`,async()=>{
    const result=await intake(name+'.docx');
    assert.equal(trimLines(reading(result)),truth[name].join('\n'));
    if (name==='bilingual'||name==='breaks') assert.equal(reading(result),result.text);
  });
}

test('Compatibility choices resolve namespace aliases, unknown capabilities and inherited visibility',()=>{
  const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const mc='http://schemas.openxmlformats.org/markup-compatibility/2006';
  const known='http://schemas.microsoft.com/office/word/2010/wordml';
  const r=s=>`<w:r><w:t>${s}</w:t></w:r>`;
  const xml=s=>new TextEncoder().encode(`<w:document xmlns:w="${w}" xmlns:mc="${mc}" xmlns:alias="${known}" xmlns:unknown="urn:new-feature"><w:body><w:p>${s}</w:p></w:body></w:document>`);
  const cases=[
    ['<mc:AlternateContent><mc:Choice Requires="unknown">'+r('wrong')+'</mc:Choice><mc:Choice Requires="alias">'+r('right')+'</mc:Choice><mc:Fallback>'+r('wrong')+'</mc:Fallback></mc:AlternateContent>','right'],
    ['<mc:AlternateContent><mc:Choice Requires="alias unknown">'+r('wrong')+'</mc:Choice><mc:Fallback>'+r('fallback')+'</mc:Fallback></mc:AlternateContent>','fallback'],
    ['<mc:AlternateContent><mc:Choice Requires="unknown">'+r('wrong')+'</mc:Choice></mc:AlternateContent>'+r('tail'),'tail'],
    ['<mc:AlternateContent><mc:Choice Requires="alias"><w:r><w:rPr><w:vanish/></w:rPr><w:t>hidden</w:t><w:txbxContent><w:p>'+r('nested hidden')+'</w:p></w:txbxContent></w:r>'+r('visible')+'</mc:Choice></mc:AlternateContent>','visible'],
    ['<mc:AlternateContent><mc:Fallback><w:del>'+r('deleted')+'</w:del><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>white</w:t></w:r>'+r('shown')+'</mc:Fallback></mc:AlternateContent>','shown']
  ];
  for (const [input,expected] of cases) {
    const data=xml(input),legacy=wordXML(data).text;
    assert.equal(writingWordXML(data,null,legacy).writingText??legacy,expected);
  }
});

test('Native Arabic PDF preserves glyphs, logical paragraphs, numbers and real token offsets',async()=>{
  const result=await intake('bilingual.pdf'),text=reading(result),actual=text.split(/\n\s*\n/gu);
  assert.equal(actual.length,truth.bilingual.length);
  assert.deepEqual(actual.map(noMarks),truth.bilingual.map(noMarks));
  assert.deepEqual(terms(text),terms(truth.bilingual.join('\n')));
  assert.equal(actual.filter((s,i)=>s===truth.bilingual[i]).length,3);
  assert.equal([...(truth.bilingual.join('\n')).matchAll(/\p{M}/gu)].length-[...text.matchAll(/\p{M}/gu)].length,9);
  for (const value of ['AIP-203','23-11-2026','3.75','٤٢','لأن','لاحظت']) assert.ok(text.includes(value));
  for (const token of tokenize(text)) assert.deepEqual(terms(text.slice(token.start,token.end)),[token.term]);
});

test('Different unpainted PDF alternate descriptions do not change the detector view',async()=>{
  assert.equal(reading(await intake('bilingual-alt-label.pdf')),reading(await intake('bilingual.pdf')));
});

test('A true raster page contributes zero detector text, also inside a hybrid PDF',async()=>{
  assert.equal(reading(await intake('scan.pdf')).trim(),'');
  assert.equal(reading(await intake('hybrid.pdf')).trimEnd(),reading(await intake('bilingual.pdf')));
});
