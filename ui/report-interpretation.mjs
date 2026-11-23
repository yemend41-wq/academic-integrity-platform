export function displayedOverlap(sim, arabic) {
  if (sim.eligibleWords === 0) return arabic ? "لا كلمات مشمولة" : "No eligible words";
  return sim.percentage + "%";
}

export function writingExplanation(detector, arabic) {
  if (detector.status === "unavailable") {
    if (detector.reason === "writing_view_limit") return arabic ? "تجاوز نص القراءة حدّ طول المستند المتاح للكاشف." : "The writing view exceeded the supported document length.";
    if (detector.reason === "no_text_layer") return arabic
      ? "تعذّر فحص الكتابة لأن الملف لم يقدّم نصًا قابلًا للاستخراج. ارفع نسخة تحتوي على نص قابل للتحديد."
      : "No readable text was extracted. Upload a file with selectable text to check the writing.";
    return arabic ? "تعذّر الاعتماد على ترميز النص المستخرج. راجع النص أو ارفع نسخة أخرى." :
      "The extracted text contains too many unreadable characters. Check the text or upload a fresh copy.";
  }
  if (detector.status === "uncertain") return arabic
    ? "شمل الفحص أقل من نصف الكلمات. امتنع الكاشف عن تقدير حصة المستند لأن التغطية محدودة."
    : "Fewer than half of the words were eligible. Coverage is too limited for a document estimate.";
  if (detector.reason === "no_supported_window") return arabic
    ? "لم يجد الكاشف مقطعًا يغلب عليه النص العربي أو الإنجليزي بما يكفي للفحص."
    : "No window contained enough text in a supported script to score.";
  if (detector.status === "insufficient") return arabic
    ? "لم يجد الكاشف نثرًا مؤهلًا يكفي لإصدار تقدير."
    : "The detector found too little eligible prose to issue an estimate.";
  if (detector.status === "suppressed") return arabic
    ? "إشارة منخفضة دون 20%. تحجب المنصة الرقم الدقيق والتظليل في هذا النطاق. يحتاج تقدير مصدر النص إلى أدلة مستقلة."
    : "Low signal below 20%. The exact percentage and highlights are withheld in this range. Assessing authorship requires independent evidence.";
  if (detector.display === "0%") return arabic
    ? "لم يحدّد الكاشف مقطعًا للمراجعة من النثر المؤهل. يبقى مصدر الكتابة بحاجة إلى دليل مستقل."
    : "The detector selected no eligible passage for review. Authorship still requires independent evidence.";
  return arabic
    ? "يعرض المؤشر حصة الكلمات المؤهلة في المقاطع المختارة للمراجعة. يقرأ المراجع البشري هذه المقاطع في سياقها."
    : "The indicator measures the share of eligible words in passages selected for review. A human reviewer reads these passages in context.";
}

export function sourceScope(sim, arabic) {
  const list = Array.isArray(sim.sources) ? sim.sources : null;
  const published = list?.filter(s => s.kind !== "cohort").length;
  const cohort = Number.isInteger(sim.cohortCompared) ? sim.cohortCompared : null;
  const counts = [];
  if (published !== undefined) counts.push(arabic ? `مصادر منشورة مفهرسة: ${published}` : `indexed publications: ${published}`);
  if (cohort !== null) counts.push(arabic ? `تسليمات من المجموعة: ${cohort}` : `cohort submissions: ${cohort}`);
  const scope = arabic ? "تقتصر المقارنة على المحتوى المفهرس المتاح للمقرر عند الفحص." : "Comparison covers the material indexed and available to this course at the time of the check.";
  const limit = sim.cohortWindowLimited ? (arabic ? " تجاوزت التسليمات الأقدم نافذة المقارنة." : " Older submissions extend beyond the comparison window.") : "";
  return scope + (counts.length ? " " + counts.join(arabic ? "، " : ", ") + "." : "") + limit;
}

export function writingLabel(d, ar) {
  if (d.display != null) return d.display;
  if (d.status === "unavailable") return ar ? "تعذّر التحليل" : "Unavailable";
  if (d.status === "uncertain") return ar ? "تغطية محدودة" : "Limited coverage";
  return ar ? "نص غير مؤهل" : "Insufficient prose";
}

export function confidenceNote(ar) {
  return ar ? "الثقة في نسبة هذا المستند غير معايرة. تعرض بطاقة النموذج أخطاء الكاشف على نصوص معلومة المصدر." :
    "Confidence for this individual estimate has not been calibrated. The model card gives measured errors on texts of known origin.";
}

export function pageCoverage(review, ar) {
  const pages = review?.extraction;
  if (!Number.isInteger(pages?.pagesWithText) || !Number.isInteger(pages.pages)) return "";
  return ar ? `صفحات تحتوي على حروف مستخرجة: ${pages.pagesWithText} من ${pages.pages}.` :
    `Pages containing extracted letters: ${pages.pagesWithText} of ${pages.pages}.`;
}
