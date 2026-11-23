import { aggregatePanel, sha256 } from "./blind-metrics.mjs";

function download(name, object) {
  const data = new Blob([JSON.stringify(object, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function mountBlindPanel(node, {t, api, esc}) {
  const labels = {
    human:t("Human", "بشري"), generated:t("Generated", "مولّد"), mixed:t("Mixed", "مختلط"),
    original:t("Original", "أصلي"), non_native:t("Non-native writer", "كاتب بلغة ثانية"),
    paraphrase:t("Paraphrased", "إعادة صياغة"), back_translation:t("Back-translated", "ترجمة عكسية"),
  };
  const problems = {
    bad_labels:t("Check the language, origin, condition and known share for every answer.", "راجع لغة كل ملف ومصدر كتابته وحالته وحصته المعلومة في مفتاح التصحيح."),
    different_files:t("The answer key must cover each selected file exactly once.", "يجب أن يشمل المفتاح كل ملف محدد مرة واحدة."),
    duplicate:t("Two files have identical bytes. Select one copy.", "تطابقت بصمة ملفّين. اختر نسخة واحدة."),
    formats:t("Choose nonempty DOCX, PDF or UTF-8 text files up to 8 MiB each.", "اختر ملفات Word أو PDF أو TXT غير فارغة، بحد أقصى ٨ ميبيبايت للملف."),
    no_key:t("Choose the panel’s completed JSON answer key before locking.", "اختر مفتاح التصحيح المكتمل بصيغة JSON قبل تثبيت العينة."),
    changed:t("The model or file changed during the run. Start a new panel.", "تغيّر النموذج أو أحد الملفات أثناء الاختبار. ابدأ جولة جديدة."),
    wrong_key:t("This key differs from the one sealed before scoring.", "تختلف بصمة المفتاح عن النسخة المثبّتة قبل التحليل."),
    bad_score:t("An unsupported detector decision was returned.", "أعاد الكاشف نتيجة يتعذّر تفسيرها."),
    parse:t("The answer key is not valid JSON.", "تعذّرت قراءة مفتاح التصحيح بصيغة JSON."),
  };
  node.innerHTML = '<details class="panel blind-panel"><summary>' +
    t("Evaluate a private blind panel","اختبار عيّنة عمياء خاصة باللجنة") + '</summary><p>' +
    t("Use files with known authorship. Only document bytes go to the writing detector. This run does not index files or save reports. The answer key stays in this browser. Keep this page open until you save the result.",
      "استخدم ملفات معلومة التأليف. يرسل هذا الاختبار محتوى الملفات إلى الكاشف دون فهرستها أو حفظ تقاريرها. يبقى مفتاح التصحيح على جهازك. أبقِ الصفحة مفتوحة حتى تحفظ النتيجة.") +
    '</p><label class="field">'+t("1. Select the test files", "١. اختر ملفات الاختبار")+
    '<input type="file" multiple accept=".txt,.docx,.pdf" data-files></label><button type="button" class="plain" data-template>'+
    t("Download a blank answer key for these files", "تنزيل مفتاح فارغ ببصمات هذه الملفات")+'</button><details><summary>'+
    t("How to fill in the key","طريقة تعبئة المفتاح")+'</summary><p>'+
    t("Use ar or en for language, human, generated or mixed for origin, and original, non_native, paraphrase or back_translation for condition. For mixtures, supply the known generated-word percentage as generatedPercent. Use anonymous authorGroup and sourceGroup codes when known. Keep the key with the evaluator until scoring ends.",
      "أدخل ar أو en في language، وhuman أو generated أو mixed في origin. اكتب حالة النص في condition باختيار original أو non_native أو paraphrase أو back_translation. أدخل في generatedPercent الحصة المعلومة للكلمات المولّدة في النص المختلط. استخدم رموزًا مجهولة للمؤلف والمصدر عند معرفتهما. يبقى المفتاح لدى المقيّم حتى انتهاء التحليل.")+
    '</p></details><label class="field">'+t("2. Select the completed answer key", "٢. اختر مفتاح التصحيح المكتمل")+
    '<input type="file" accept=".json" data-key></label><div class="actions"><button type="button" class="primary" data-run>'+
    t("Lock files and score","تثبيت الملفات وتحليلها")+'</button><button type="button" class="ghost" hidden data-reveal>'+
    t("Open key and calculate results","فتح المفتاح وحساب النتائج")+'</button></div><p role="status" aria-live="polite" data-status></p>'+
    '<div data-result></div><button type="button" class="plain" hidden data-save>'+t("Save private result (JSON)","حفظ النتيجة الخاصة بصيغة JSON")+'</button></details>';
  const get = name => node.querySelector('[data-'+name+']');
  let files, run, evidence, scores = new Map();
  const fail = error => {get("status").textContent = problems[error.message] || error.message;};
  const stamp = () => new Date().toISOString();
  const share = value => value == null ? '—' : value.toFixed(2);
  const format = file => file.name.split(".").at(-1).toLowerCase();
  async function identify() {
    const selected = Array.from(get("files").files);
    if (!selected.length || selected.some(f => !["txt","docx","pdf"].includes(format(f)) || !f.size || f.size > 8388608)) throw Error("formats");
    const ids = new Map();
    for (const file of selected) {
      const id = await sha256(await file.arrayBuffer());
      if (ids.has(id)) throw Error("duplicate");
      ids.set(id, file);
    }
    return ids;
  }
  get("template").onclick = async () => {
    try {
      const ids = await identify();
      download("mizan-answer-key.json",{version:1,cases:Array.from(ids, ([id,file])=>({
        sha256:id,localFilename:file.name,language:null,origin:null,condition:null,generatedPercent:null,authorGroup:null,sourceGroup:null}))});
    } catch(error) {fail(error);}
  };
  get("run").onclick = async () => {
    get("run").disabled = get("key").disabled = get("files").disabled = get("template").disabled = true;
    try {
      const key = get("key").files[0];
      if (!key || !key.size || key.size > 8*1024*1024) throw Error("no_key");
      const health = await api("/api/health");
      if (!run) {
        files = await identify();
        const inputDigest = await sha256(new TextEncoder().encode([...files.keys()].sort().join("\n")));
        run = {lockedAt:stamp(), keySHA256:await sha256(await key.arrayBuffer()), inputSetSHA256:inputDigest,
          origin:location.origin, model:health.model, analysisFingerprint:health.analysisFingerprint};
      }
      if (health.analysisFingerprint !== run.analysisFingerprint || health.model !== run.model) throw Error("changed");
      for (const [id, file] of files) {
        if (scores.has(id)) continue;
        get("status").textContent = t("Scoring files","تحليل الملفات") + ' · ' + scores.size + ' / ' + files.size;
        const result = await api("/api/panel/score",{method:"POST",headers:{"content-type":"application/octet-stream","x-format":format(file)},body:file});
        if (result.model !== run.model || result.analysisFingerprint !== run.analysisFingerprint || result.sha256 !== id) throw Error("changed");
        scores.set(id,{sha256:id,status:result.status,display:result.display,eligibleWords:result.eligibleWords});
      }
      run.scoredAt = stamp();
      get("run").hidden = true;
      get("reveal").hidden = false;
      get("status").textContent = t("All decisions are locked. You can now open the key.", "ثُبّتت قرارات الكاشف لجميع الملفات. يمكنك الآن فتح المفتاح.")+' ('+scores.size+')';
    } catch(error) {
      fail(error);
      get("run").disabled = false;
      if (!run) get("key").disabled = get("files").disabled = get("template").disabled = false;
    }
  };
  get("reveal").onclick = async () => {
    try {
      const bytes = await get("key").files[0].arrayBuffer();
      if (await sha256(bytes) !== run.keySHA256) throw Error("wrong_key");
      let key;
      try {key = JSON.parse(new TextDecoder().decode(bytes));} catch {throw Error("parse");}
      const groups = aggregatePanel(key,scores);
      evidence = {...run, openedAt:stamp(), files:files.size, groups, decisions:[...scores.values()]};
      const rate = (n,g,ci) => '<bdi>'+n+' / '+g.eligible+(ci ? ' ('+share(100*ci[0])+'% – '+share(100*ci[1])+'%)':'')+'</bdi>';
      const title = t("Numeric / all alerts and 95% intervals", "الإنذارات الرقمية وجميع الإشارات مع فاصل ثقة ٩٥٪");
      const rows = groups.map(g => '<tr><th scope="row">'+esc(g.language.toUpperCase()+' · '+labels[g.origin]+' · '+labels[g.condition]+(g.origin === "mixed" ? ' '+g.generatedPercent+'%' : ''))+
        '</th><td>'+g.eligible+' / '+g.files+'</td><td>'+g.abstained+'</td><td>'+rate(g.numericAlerts,g,g.numericWilson95)+'<br>'+rate(g.allAlerts,g,g.allWilson95)+'</td><td>'+
        (g.origin==="mixed"? '<bdi>'+share(g.maeNumericPP)+' / '+share(g.biasNumericPP)+'</bdi>' : '—')+'</td></tr>').join("");
      get("result").innerHTML='<div class="table-scroll" tabindex="0"><table><thead><tr>'+[
        t("Cohort","المجموعة"),t("Eligible / total","المؤهل / الكلي"),t("Abstained","امتناع"),title,
        t("Numeric MAE / bias (pp)","الخطأ المطلق / الانحياز بالنقاط المئوية للقيم الرقمية")].map(s=>'<th scope="col">'+s+'</th>').join("")+
        '</tr></thead><tbody>'+rows+'</tbody></table></div><p class="hint">'+t("For human texts, alerts are false positives. For generated texts, alerts are detections. The private export includes coverage, suppressed counts and mixture error bounds. Independent authorship and group separation depend on the evaluator’s records.",
        "على النص البشري يُحسب الإنذار خطأً، وعلى النص المولّد يُحسب اكتشافًا. يضم التصدير حالات الحجب وحدود خطأ النص المختلط. يعتمد إثبات هوية المؤلف واستقلال المجموعات على سجلات اللجنة.")+'</p>';
      get("save").hidden=false;
      get("reveal").hidden=true;
      get("status").textContent=t("Private panel complete","اكتمل اختبار العيّنة الخاصة")+' · '+scores.size;
    } catch(error) {fail(error);}
  };
  get("save").onclick = () => {if(evidence) download("mizan-blind-panel.json",evidence);};
}
