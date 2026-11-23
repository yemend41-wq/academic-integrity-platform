import test from "node:test";
import assert from "node:assert/strict";
import {analyzeWriting} from "../src/writing-analysis.mjs";
import {detect} from "../research/detector/detector.mjs";
import {writingLabel, writingExplanation, pageCoverage} from "../ui/report-interpretation.mjs";
import {readFileSync} from "node:fs";

const novel = readFileSync(new URL("../research/bench/source/melville-excerpt.txt", import.meta.url),"utf8");
test("blank scans, decoding damage, unsupported script and short content have distinct reasons", () => {
  const inputs = [["", "unavailable", "no_text_layer"],["abc���� d", "unavailable","unreliable_decoding"],
    ["هذه جملة.", "insufficient", "too_short"],["文 ".repeat(110),"insufficient","no_supported_window"]];
  for (const [input,status,reason] of inputs) {
    const d = analyzeWriting(input,"pdf",{pageCount:2,pagesWithLetters:0});
    assert.equal(d.status,status); assert.equal(d.reason,reason); assert.equal(d.display,null);
    for (const ar of [true,false]) {assert.ok(writingLabel(d,ar));assert.ok(writingExplanation(d,ar));assert.match(pageCoverage(d.review,ar),/0/);}
  }
});
test("low coverage withholds the whole-document estimate independently of signal strength", () => {
  const d = analyzeWriting(novel.split(/\s+/).slice(0,120).join(" ")+"\n\n"+"文 ".repeat(450),"txt");
  assert.equal(d.status,"uncertain");assert.equal(d.display,null);assert.ok(d.eligibleWords>0);
  assert.equal(d.review.paragraphs,undefined);assert.deepEqual(d.segments,[]);
});
test("DOCX paragraphs keep UTF-16 ranges and selected word totals, historic detector matches", () => {
  const line = novel.split(/\s+/).slice(0,150).join(" ");
  const text = "📖 "+line+"\n"+line;
  const d = analyzeWriting(text,"docx"), old=detect(text);
  assert.equal(d.status,"analyzed");assert.equal(d.display,old.display);assert.deepEqual(d.segments,old.segments);
  const {rows,total}=d.review.paragraphs;assert.equal(total,2);
  assert.ok(rows[0].end < rows[1].start);assert.ok(text.slice(rows[1].start,rows[1].end).length>250);
  assert.equal(rows.reduce((sum,row)=>sum+row.eligibleWords,0),d.eligibleWords);
  assert.equal(rows.reduce((sum,row)=>sum+row.selectedWords,0),d.flaggedWords);
  const pdf = analyzeWriting(line+"\n"+line+"\n\n"+line,"pdf",{pageCount:2,pagesWithLetters:1});
  assert.equal(pdf.review.paragraphs.total,2);assert.equal(pdf.review.paragraphs.unit,"text_block");
});
test("metrics preserve undefined precision and abstentions outside the scored denominator", async()=>{
  const {classificationMetrics,wilson} = await import("../src/detector-study.mjs");
  const m=classificationMetrics({tp:0,fp:0,tn:10,fn:5,abstained:2});
  assert.equal(m.precision,null);assert.equal(m.accuracy,2/3);assert.equal(m.fnr,1);assert.equal(m.recall,0);
  const ci=wilson(0,10);assert.ok(ci[0]<1e-14 && ci[1]>.27);assert.equal(wilson(0,0),null);
});
test("Word markup fallbacks do not duplicate the scored text and preserve the legacy intake", async()=>{
  const {wordXML}=await import("../research/media/xml.mjs");
  const {writingWordXML}=await import("../research/media/word-writing.mjs");
  const content=new TextEncoder().encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:future-format"><w:body><w:p><c:AlternateContent><c:Choice Requires="v"><w:r><w:t>Logical alternative</w:t></w:r></c:Choice><c:Fallback><w:r><w:t>Visible version</w:t></w:r></c:Fallback></c:AlternateContent></w:p></w:body></w:document>');
  const baseline=wordXML(content).text;
  assert.equal(baseline,"Logical alternativeVisible version");
  assert.equal(writingWordXML(content,null,baseline).writingText,"Visible version");
});
test("size-limited storage round-trips expanded detector evidence and legacy audit JSON",async()=>{
  const {encodeReport,decodeReport}=await import("../src/report-storage.mjs");
  const old={privacyVersion:4,text:"نصّ",id:"local"};assert.deepEqual(await decodeReport(await encodeReport(old)),old);
  const large={...old,writingText:"نصّ آخر. ".repeat(85000)};
  const storage=await encodeReport(large);assert.equal(JSON.parse(storage).encoding,"report-gzip-v1");
  assert.deepEqual(await decodeReport(storage),large);
});
