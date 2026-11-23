import { createAuditPdf } from "../research/export/audit.mjs";
function flatten(value, key = "", rows = []) {
  if (value == null) return rows;
  if (Array.isArray(value))
    value.forEach((v, i) => flatten(v, key + " " + (i + 1), rows));
  else if (typeof value === "object")
    Object.entries(value).forEach(([k, v]) =>
      flatten(v, key ? key + " / " + k : k, rows),
    );
  else rows.push({ label: key, value: String(value) });
  return rows;
}
export function pdfAudit(r, locale) {
  const ar = locale === "ar",
    l = (a, b) => (ar ? b : a),
    sections = [];
  function add(title, obj) {
    sections.push({ title, rows: flatten(obj) });
  }
  add(l("Document", "المستند"), {
    ID: r.id,
    [l("Format", "الصيغة")]: r.format,
    [l("Words", "الكلمات")]: r.words,
    [l("Elapsed (ms)", "مدة التحليل (مللي ثانية)")]: r.elapsedMs,
  });
  add(l("Similarity", "التشابه"), {
    [l("Coverage", "النسبة")]: r.similarity.percentage + "%",
    [l("Eligible words", "الكلمات المشمولة")]: r.similarity.eligibleWords,
    [l("Matched words", "الكلمات المطابقة")]: r.similarity.matchedWords,
    [l("Exclude quotes", "استبعاد الاقتباسات")]: r.options?.excludeQuotes,
    [l("Exclude references", "استبعاد المراجع")]: r.options?.excludeReferences,
  });
  add(
    l("Source matches", "المصادر المطابقة"),
    (r.similarity.matches || []).map((m) => ({
      source: m.sourceTitle || m.sourceId,
      method: m.method,
      [l("Submission passage", "المقطع في المستند")]: r.text.slice(m.start, m.end),
      [l("Source passage", "المقطع في المصدر")]: m.sourceExcerpt,
      [l("Source character range", "موضع المقطع في المصدر")]: [m.sourceStart, m.sourceEnd],
      [l("Published URL", "رابط المصدر المنشور")]: m.sourceUrl,
    })),
  );
  add(l("AI writing signals", "مؤشرات الكتابة المولّدة"), {
    model: r.detector.model,
    [l("Display", "المؤشر")]:
      r.detector.display ?? l("Insufficient text", "نص غير كافٍ"),
    [l("Review", "المراجعة")]: l(
      "An instructor must read evidence in context.",
      "يقرأ المدرّس الأدلة في سياقها قبل اتخاذ أي قرار.",
    ),
  });
  add(l("File forensics", "خصائص الملف"), r.forensics);
  add(l("Content credentials", "اعتماد المحتوى"), r.provenance);
  add(l("References", "المراجع"), r.citations);
  if (r.telemetry) add(l("Writing history", "سجل الكتابة"), r.telemetry);
  return createAuditPdf({
    id: r.id,
    createdAt: new Date(r.created * 1000).toISOString(),
    locale,
    sections,
  });
}
