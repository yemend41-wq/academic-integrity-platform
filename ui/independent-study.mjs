export function independentPanel(study,t,esc) {
  if (!study?.models?.length && !study?.humanGroups?.length) return "";
  const number = x => Number.isFinite(x) ? x.toFixed(2) : "—";
  const pctCI = ci => Array.isArray(ci) ? ' ('+number(100*ci[0])+'% – '+number(100*ci[1])+'%)' : '';
  const band = xs => Array.isArray(xs) ? number(xs[0])+' – '+number(xs[1]) : "—";
  const table = (cols,rows) => '<div class="table-scroll" tabindex="0"><table><thead><tr>'+
    cols.map(c=>'<th scope="col">'+esc(c)+'</th>').join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
  const cell = v => '<td><bdi>'+esc(v)+'</bdi></td>';
  const th = v => '<th scope="row"><bdi>'+esc(v)+'</bdi></th>';
  const terms = {ar:t("Arabic","عربي"),en:t("English","إنجليزي"),human:t("Human","بشري"),machine:t("Generated","مولّد"),original:t("Original","أصلي"),
    qwen:"Qwen",gemma:"Gemma",roundtrip:t("After back-translation","بعد الترجمة العكسية"),"roundtrip-source":t("Before back-translation","قبل الترجمة العكسية")};
  const scores = rows => table([t("Language / cohort","اللغة / العينة"),t("Eligible / total","المؤهل / الكلي"),t("Abstained","امتناع"),
    t("Numeric alerts / eligible (95% CI)","إنذارات رقمية / المؤهل (ثقة ٩٥٪)"),t("All alerts / eligible (95% CI)","جميع الإشارات / المؤهل (ثقة ٩٥٪)")],
    rows.map(r=>'<tr>'+th((terms[r.language]||r.language)+' · '+(terms[r.kind]||r.kind))+cell(r.eligible+' / '+r.total)+cell(r.abstained)+
      cell(r.numeric+' / '+r.eligible+pctCI(r.numericCI))+cell(r.any+' / '+r.eligible+pctCI(r.anyCI))+'</tr>').join(""));
  return '<section class="panel study-panel"><h2>'+t("Independent evaluation","الاختبارات المستقلة")+'</h2><p>'+
    t("The live model is identified above. Each research candidate was locked before its independent scores were calculated. Error and bias are in percentage points. Restricted scores remain hidden for individual reports.",
      "تظهر هوية النموذج المستخدم أعلى السجل. ثُبّتت النماذج البحثية قبل قياسها على العينات المستقلة. يرد الخطأ والانحياز بالنقاط المئوية، وتظل النسب المحجوبة مخفية في التقارير الفردية.")+'</p>'+
    (study.models||[]).map(m=>'<details><summary><bdi>'+esc(m.id)+'</bdi> · '+(m.deployed?t("Deployed model","النموذج المستخدم"):t("Research candidate","مرشّح بحثي"))+'</summary>'+
      (m.pure?.length?scores(m.pure):'')+
      (m.mixtures?.length?'<h3>'+t("Known mixtures","النسب المختلطة المعلومة")+'</h3>'+table([t("Language","اللغة"),t("Known share","الحصة المعلومة"),t("Eligible / total","المؤهل / الكلي"),
        t("Suppressed / abstained","محجوب / امتناع"),t("MAE (95% CI), pp","الخطأ المطلق وفاصل الثقة"),t("Mean bias, pp","متوسط الانحياز"),
        t("Display-based MAE bounds, pp","حدود الخطأ من القيم الظاهرة")],
        m.mixtures.map(r=>'<tr>'+th(terms[r.language]||r.language)+cell(r.target+'%')+cell(r.eligible+' / '+r.total)+cell(r.suppressed+' / '+r.abstained)+
          cell(number(r.rawMAE)+' ('+band(r.rawMAECI)+')')+cell(number(r.rawBias))+cell(band(r.displayMAEBounds))+'</tr>').join("")):'')+
      (m.transformations?.length?'<h3>'+t("Rewriting and translation","إعادة الصياغة والترجمة")+'</h3>'+scores(m.transformations):'')+
      '</details>').join("")+
    (study.confirmation?.models||[]).map(m=>'<details><summary>'+t('Independent confirmation','اختبار تأكيدي مستقل')+
      ' · <bdi>'+esc(m.id)+'</bdi></summary>'+scores(m.groups.map(g=>({...g,kind:g.dataset+' / '+g.source+' / '+g.generator})))+'</details>').join('')+
    (study.humanGroups?.length?'<details><summary>'+t("Human writing with attributed authors","كتابات بشرية معروفة المؤلف")+'</summary>'+
      table([t("Model / cohort","النموذج / العينة"),t("Authors","المؤلفون"),t("Eligible / total","المؤهل / الكلي"),t("Abstained","امتناع"),t("Numeric alerts (95% CI)","إنذارات رقمية (ثقة ٩٥٪)"),t("All alerts (95% CI)","جميع الإشارات (ثقة ٩٥٪)")],
        study.humanGroups.map(r=>'<tr>'+th(r.model+' · '+r.label)+cell(r.authors??"—")+cell(r.eligible+' / '+r.total)+cell(r.abstained)+cell(r.numeric+pctCI(r.numericCI))+cell(r.any+pctCI(r.anyCI))+'</tr>').join(""))+'</details>':'')+'</section>';
}
