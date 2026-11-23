const originLabels = {
  human: ["Human writing", "كتابة بشرية"], machine: ["Generated text", "نص مولّد"],
  assisted: ["Assisted editing", "تحرير بمساعدة نموذج"], machine_rewritten: ["Rewritten generated text", "نص مولّد معاد الصياغة"],
  mixed: ["Mixed writing", "كتابة مختلطة"], translated: ["Translated text", "نص مترجم"]
};
export function studyPanel(study, t, esc) {
  if (!study?.cohorts?.length) return "";
  const pct = value => value == null ? "—" : (100 * value).toFixed(2) + "%";
  const interval = value => Array.isArray(value) ? '<bdi>' + pct(value[0]) + ' – ' + pct(value[1]) + '</bdi>' : "—";
  const observations = study.cohorts.map(row => {
    const rate = (count, value, ci) => '<bdi>' + count + ' / ' + row.eligible + ' · ' + pct(value) + '</bdi><br><small>' + interval(ci) + '</small>';
    return '<tr><th scope="row"><bdi>' + esc(row.label) + '</bdi><br><small>' +
      t(...(originLabels[row.origin] || [row.origin, row.origin])) + '</small></th><td>' + row.eligible + ' / ' + row.total +
      '</td><td>' + row.abstained + ' / ' + row.excluded + '</td><td>' + rate(row.numeric, row.numeric_rate, row.numeric_ci95) +
      '</td><td>' + rate(row.any, row.any_rate, row.any_ci95) + '</td></tr>';
  }).join("");
  const head = labels => '<tr>' + labels.map(label => '<th scope="col">' + label + '</th>').join('') + '</tr>';
  const table = (labels, body) => '<div class="table-scroll" tabindex="0"><table><thead>' + head(labels) + '</thead><tbody>' + body + '</tbody></table></div>';
  const mixed = study.mixed.map(row => '<tr><th scope="row">' +
    (row.lang === "ar" ? t("Arabic","العربية") : t("English","الإنجليزية")) + '</th><td>' + row.expected_percent +
    '%</td><td>' + row.documents + '</td><td>' + row.numeric + ' / ' + row.suppressed + ' / ' + row.abstained +
    '</td><td>' + (row.mae_pp ?? '—') + '</td></tr>').join("");
  return '<section class="panel study-panel"><h2>' + t('Detector measurements','قياسات الكاشف') + '</h2><p>' +
    t('For human writing, flagged documents count as false alarms. For generated text, they count as detections. Brackets show 95% Wilson confidence intervals within each cohort.',
      'يُعد الإنذار على النص البشري إنذارًا خاطئًا، وعلى النص المولّد حالة اكتشاف. يرد فاصل ثقة ويلسون عند 95% أسفل كل نسبة لكل عينة على حدة.') +
    '</p><details><summary>' + t('Cohorts, coverage and false alerts','العينات والتغطية والإنذارات') + '</summary>' +
    table([t('Source and type','المصدر والنوع'),t('Eligible / total','المؤهل / الكلي'),t('Abstained / excluded','امتناع / استبعاد'),t('Numeric alerts','إنذارات رقمية'),t('All alerts incl. *%','جميع الإنذارات بما فيها ‎*%')],observations) +
    '</details><details><summary>' + t('Mixed-text estimation error','خطأ تقدير حصة الكتابة المولّدة في النص المختلط') + '</summary>' +
    table([t('Language','اللغة'),t('Known share','الحصة المعروفة'),t('Documents','المستندات'),t('Numeric / suppressed / abstained','رقمي / محجوب / امتناع'),t('Mean absolute error (pp), numeric only','متوسط الخطأ المطلق بالنقاط المئوية للقيم الرقمية')],mixed) +
    '</details></section>';
}
