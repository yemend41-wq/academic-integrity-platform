export function displayedOverlap(sim, arabic) {
  if (sim.eligibleWords === 0) return arabic ? "لا كلمات مشمولة" : "No eligible words";
  return sim.percentage + "%";
}

export function writingExplanation(detector, arabic) {
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
