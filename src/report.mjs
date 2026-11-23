import { createAuditPdf } from "../research/export/audit.mjs";
import {writingPassages} from "../ui/writing-passages.mjs";
import { fileTerm } from "../research/media/labels.mjs";
import { displayedOverlap, sourceScope, writingExplanation, writingLabel, confidenceNote, pageCoverage } from "../ui/report-interpretation.mjs";

function flatten(value, ar, key = "", rows = []) {
  if (value == null) return rows;
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, ar, key ? key + " " + (i + 1) : String(i + 1), rows));
  } else if (typeof value === "object") {
    for (const [name, entry] of Object.entries(value)) {
      const term = fileTerm(name, ar);
      flatten(entry, ar, key ? key + " / " + term : term, rows);
    }
  } else {
    const shown = typeof value === "boolean" ? (ar ? (value ? "نعم" : "لا") : (value ? "Yes" : "No")) : fileTerm(String(value), ar);
    rows.push({label: key, value: shown});
  }
  return rows;
}

export function pdfAudit(r, locale) {
  const ar = locale === "ar";
  const l = (en, arabic) => ar ? arabic : en;
  const sections = [];
  function add(title, obj) { sections.push({title, rows:flatten(obj, ar)}); }
  const s = r.similarity;
  add(l("Document", "المستند"), {
    [l("Review ID", "معرّف المراجعة")]: r.id,
    [l("Format", "الصيغة")]: r.format,
    [l("Extracted words", "الكلمات المستخرجة")]: r.words,
    [l("Elapsed (ms)", "مدة التحليل بالمللي ثانية")]: r.elapsedMs,
  });
  add(l("Similarity", "التشابه مع المصادر"), {
    [l("Coverage", "نسبة التشابه")]: displayedOverlap(s, ar),
    [l("Eligible words", "الكلمات المشمولة")]: s.eligibleWords,
    [l("Matched words", "الكلمات المطابقة")]: s.matchedWords,
    [l("Calculation", "طريقة الحساب")]: l("Count each covered word once and divide by eligible words after exclusions. A zero indicates that no eligible word matched in this index.",
      "تُحسب كل كلمة مطابقة مرة واحدة، ثم يُقسم العدد على الكلمات المشمولة بعد الاستبعاد. تعني النتيجة الصفرية أن الفهرس المقارَن لم يكشف تطابقًا."),
    [l("Compared material", "نطاق المقارنة")]: sourceScope(s, ar),
    [l("Exclude quotes", "استبعاد الاقتباسات")]: r.options?.excludeQuotes,
    [l("Exclude references", "استبعاد المراجع")]: r.options?.excludeReferences,
  });
  add(l("AI writing signals", "مؤشرات الكتابة المولّدة"), {
    [l("Model", "النموذج")]: r.detector.model,
    [l("Display", "المؤشر")]: writingLabel(r.detector, ar),
    [l("Eligible words", "الكلمات المؤهلة للكاشف")]: r.detector.eligibleWords,
    [l("How to read this signal", "تفسير المؤشر")]: writingExplanation(r.detector, ar),
    [l("Individual confidence", "الثقة الفردية")]: confidenceNote(ar),
    [l("Text layer", "طبقة النص")]: pageCoverage(r.detector.review, ar) || undefined,
    [l("Review", "المراجعة الأكاديمية")]: l("An instructor reads the evidence before making an academic decision.", "يقرأ المدرّس الأدلة في سياقها قبل اتخاذ أي قرار أكاديمي."),
  });
  const blocks = r.detector.review?.paragraphs;
  if (blocks) {
    add(l("Writing evidence by block", "أدلة الكتابة حسب المقطع"), {
      [l("Total blocks", "عدد المقاطع")]:blocks.total,
      [l("Blocks in this table", "المقاطع المعروضة")]:blocks.rows.length,
      ...Object.fromEntries(blocks.rows.map(row=>[l("Block ", "المقطع ")+row.number,
        l("Selected / eligible words", "الكلمات المختارة من المؤهلة")+"  "+row.selectedWords+" / "+row.eligibleWords]))
    });
  }
  if (r.detector.status === "analyzed" && r.detector.segments?.some(segment => segment.flagged)) {
    const writingText = r.writingText ?? r.text;
    const spans = writingPassages(writingText,r.detector.segments);
    const rows = [{label:l("Selected passages","مجموع المقاطع المختارة"),value:String(spans.length)},
      {label:l("Excerpts included","المقتطفات المعروضة"),value:String(Math.min(spans.length,12))}];
    for (const [index,span] of spans.slice(0,12).entries()) {
      const excerpt = writingText.slice(span.start,Math.min(span.end,span.start+300));
      rows.push({label:l("Passage ","المقطع ")+(index+1)+" · "+span.start+"–"+span.end,
        value:excerpt+(span.end-span.start>300?"…":"")});
    }
    sections.push({title:l("Selected writing passages","مقاطع الكتابة المختارة"),rows});
  }
  const matches = s.matches || [];
  add(l("Source matches", "المصادر المطابقة"), matches.length ? matches.map(m => ({
    [l("Source", "المصدر")]: m.sourceTitle || m.sourceId,
    [l("Method", "طريقة المطابقة")]: m.method === "verbatim" ? l("Verbatim", "تطابق حرفي") : l("Paraphrase", "إعادة صياغة"),
    [l("Submission passage", "المقطع في المستند")]: r.text.slice(m.start, m.end),
    [l("Submission character range", "موضع المقطع في المستند")]: m.start + "–" + m.end,
    [l("Source passage", "المقطع في المصدر")]: m.sourceExcerpt,
    [l("Source character range", "موضع المقطع في المصدر")]: Number.isInteger(m.sourceStart) && Number.isInteger(m.sourceEnd) ? m.sourceStart + "–" + m.sourceEnd : undefined,
    [l("Published URL", "رابط المصدر المنشور")]: m.sourceUrl,
  })) : {[l("Result", "النتيجة")]:l("No matching passage in the material compared.", "لم يظهر مقطع مطابق في المصادر المشمولة بالفحص.")});
  add(l("File forensics", "خصائص الملف"), r.forensics);
  add(l("Content credentials", "اعتماد المحتوى"), r.provenance);
  add(l("References", "المراجع"), r.citations);
  if (r.telemetry) add(l("Writing history", "سجل الكتابة"), r.telemetry);
  return createAuditPdf({id:r.id, createdAt:new Date(r.created * 1000).toISOString(), locale, sections});
}
