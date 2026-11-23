const escapeHtml = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

export function classificationMetrics(row) {
  const {tp,fn,fp,tn} = row;
  const ratio = (a,b) => b ? a / b : null;
  return {precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),f1:ratio(2*tp,2*tp+fp+fn),
    accuracy:ratio(tp+tn,tp+tn+fp+fn),fpr:ratio(fp,fp+tn),fnr:ratio(fn,tp+fn)};
}
export function wilson(success, n) {
  if (!n) return null;
  const p=success/n,z=1.95996398454,z2=z*z,d=1+z2/n;
  const center=(p+z2/(2*n))/d, half=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
  return [Math.max(0,center-half),Math.min(1,center+half)];
}
export function technicalPage(study,language) {
  const ar = language !== "en", locale=ar?"ar":"en";
  const t = (en,arabic) => ar ? arabic : en;
  const pct = x => x == null ? "—" : (x*100).toFixed(1)+"%";
  const bilingual = value => escapeHtml(value[locale]);
  const table = (headers,rows) => '<div class="study-scroll" tabindex="0"><table><thead><tr>'+
    headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(row=>'<tr>'+row.map(v=>'<td><bdi>'+escapeHtml(v)+'</bdi></td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  const head=t("Detector evaluation","تقييم كاشف الكتابة");
  const content=study.studies.map(part=>{
    const rows=part.rows.map(row=>{
      const m=classificationMetrics(row), ci=wilson(row.fp,row.fp+row.tn);
      return [row.model,row.lang.toUpperCase(),row.endpoint==="all"?t("Any signal","كل إشارة"):row.endpoint==="numeric"?t("Numeric","رقمي"):t("Binary","ثنائي"),
        row.tp,row.fp,row.tn,row.fn,row.abstained,...Object.values(m).map(pct),ci?.map(pct).join("–")??"—"];
    });
    return '<section class="panel"><h2>'+bilingual(part.title)+'</h2><p>'+bilingual(part.description)+'</p>'+
      table([t("Model","النموذج"),t("Language","اللغة"),t("Decision","القرار"),"TP","FP","TN","FN",t("Abstained","امتناع"),
        "Precision","Recall","F1","Accuracy","FPR","FNR",t("95% CI · FPR","فاصل 95% للإنذارات الخاطئة")],rows)+'</section>';
  }).join('');
  const list = arr => arr.map(n=>'<p>'+bilingual(n)+'</p>').join('');
  const mixtures = (study.mixtures || []).length ? '<section class="panel"><h2>'+t("Controlled mixtures","نصوص مختلطة معلومة التركيب")+'</h2><p>'+t("Archived M4 paired controls. Errors are in percentage points. Negative bias means underestimation. Each level reuses source pairs.","مجموعة M4 السابقة. تقاس الأخطاء بالنقاط المئوية، ويعني الانحياز السالب أن التقدير أقل من الحصة الفعلية. تعيد المستويات استخدام أزواج المصادر نفسها.")+'</p>'+table([t("Model","النموذج"),t("Language","اللغة"),t("Known share","الحصة الفعلية"),t("Cases","الملفات"),t("Abstained","امتناع"),"MAE (pp)",t("Bias (pp)","الانحياز (نقطة)")],study.mixtures.map(x=>[x.model,x.lang.toUpperCase(),x.truth+"%",x.files,x.abstained,x.maePP,x.biasPP]))+'</section>' : '';
  const independentMix=table([t("Model","النموذج"),t("Language","اللغة"),t("True share","الحصة الفعلية"),t("Files","الملفات"),t("Abstained","امتناع"),"MAE (pp)","IoU","F1"],
    (study.independentMixtures||[]).filter(x=>x.level!=="all").map(x=>[x.model,x.lang.toUpperCase(),x.level+"%",x.n,x.abstained,x.maePP??"—",pct(x.iou),pct(x.f1)]));
  const findings='<section class="panel"><h2>'+t("Decision and evidence","قرار اعتماد النموذج وأدلته")+'</h2>'+list(study.decisionNotes||[])+'</section>';
  return new Response('<!doctype html><html lang="'+locale+'" dir="'+(ar?"rtl":"ltr")+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/studio.css"><title>'+head+' · Mizan</title></head><body><header><a class="brand" href="/">Mizan · ميزان</a><a href="?lang='+(ar?"en":"ar")+'">'+(ar?"English":"العربية")+'</a></header><main class="public-register"><h1>'+head+'</h1><p><bdi>'+escapeHtml(study.release)+'</bdi> · '+escapeHtml(study.date)+'</p><p><a href="/model-card?lang='+locale+'">'+t("Model card","بطاقة النموذج")+'</a> · <a href="/acceptance?lang='+locale+'">'+t("Acceptance register","سجل القبول")+'</a> · <a href="/detector-study.json">'+t("Download measurements","تنزيل القياسات")+'</a></p><section class="panel"><h2>'+t("What the indicator measures","ماذا يقيس المؤشر؟")+'</h2>'+list(study.audit)+'</section>'+findings+content+'<section class="panel"><h2>'+t("Fresh mixtures and visible highlights","النصوص المختلطة الجديدة ومواضع التظليل")+'</h2>'+independentMix+'</section>'+mixtures+'<section class="panel"><h2>'+t("Interpretation and limits","تفسير القياسات وحدودها")+'</h2>'+list(study.notes)+'</section></main></body></html>',
    {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
