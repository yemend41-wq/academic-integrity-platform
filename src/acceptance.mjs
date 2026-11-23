import { independentPanel } from "../ui/independent-study.mjs";
import { studyPanel } from "../ui/study.mjs";

const escape = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Render aggregate, packaged measurements only. Stored reports and member records
// remain accessible through the authenticated, cohort-scoped routes.
export function publicAcceptance(assessment, model, language) {
  const ar = language === "ar";
  const t = (en, arabic) => ar ? arabic : en;
  const labels = {passed:t("Passed","مجتاز"),partial:t("Partial","جزئي"),failed:t("Failed","غير مجتاز"),unverified:t("Unverified","غير متحقق")};
  const rows = assessment.checks.map(check =>
    '<article class="record"><span class="badge '+(check.status==="passed"?"":check.status==="failed"?"fail":"warn")+'">'+
    labels[check.status]+'</span> <strong>'+escape(t(check.name,check.ar))+'</strong><p>'+
    escape(t(check.detail,check.detailsAr))+'</p></article>').join("");
  const title=t(assessment.title,assessment.titleAr);
  const heading='<h1>'+title+'</h1><p>'+t("Measured results and open conditions. Test scope is stated for each item.","نتائج القياس وشروط القبول المفتوحة. يبيّن كل بند بيئة الاختبار وحدوده.")+'</p>';
  const html='<!doctype html><html lang="'+(ar?"ar":"en")+'" dir="'+(ar?"rtl":"ltr")+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/studio.css"><title>'+title+' · Mizan</title></head><body>'+
    '<header><a class="brand" href="/">Mizan · ميزان</a><a class="plain" href="/acceptance?lang='+(ar?"en":"ar")+'">'+(ar?"English":"العربية")+'</a></header>'+
    '<main class="public-register"><div class="page-head"><div class="eyebrow"><bdi>'+escape(model.version)+'</bdi></div>'+heading+
    '<a href="/detector-study?lang='+(ar?'ar':'en')+'">'+t('Detector evaluation','تقييم الكاشف')+'</a> · <a href="/#acceptance">'+t("Evaluator workspace","الدخول إلى مساحة اللجنة")+'</a> · <a href="/model-card?lang='+(ar?"ar":"en")+'">'+t("Model card","بطاقة النموذج")+'</a> · <a href="/health?lang='+(ar?"ar":"en")+'">'+t("Live health","حالة الخدمة الآن")+'</a> · <a href="/acceptance.json" download>'+t("Download acceptance record","تنزيل سجل القبول")+'</a></div>'+
    '<section class="panel">'+rows+'</section>'+independentPanel(model.release5,t,escape)+studyPanel(model.release4,t,escape)+'</main></body></html>';
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}

export function publicRegister(assessment, model) {
  return {
    id:assessment.id, title:assessment.title, titleAr:assessment.titleAr, testedAt:assessment.testedAt,
    model:model.version, independentStudies:model.release5, checks:assessment.checks.map(c=>({
      name:c.name, ar:c.ar, status:c.status, detail:c.detail, detailsAr:c.detailsAr,
      implementation:c.evidence?.implementation, test:c.evidence?.test, record:c.evidence?.record,
      verifiedAt:c.verifiedAt || null,
    })),
  };
}

export function publicReviewPage(kind, model, language, health) {
  const ar = language !== "en";
  const t = (en, arabic) => ar ? arabic : en;
  const locale = ar ? "ar" : "en";
  const title = kind === "health" ? t("System health", "صحة النظام") : t("Writing detector model card", "بطاقة نموذج كشف الكتابة");
  const link = (path, label) => '<a href="' + path + '?lang=' + locale + '">' + label + '</a>';
  const header = '<header><a class="brand" href="/">Mizan · ميزان</a><a href="/'+kind+'?lang='+(ar?'en':'ar')+'">'+(ar?'English':'العربية')+'</a></header>';
  const nav = '<p>' + link('/detector-study',t('Technical evaluation','التقرير التقني للكاشف')) + ' · ' + link('/acceptance',t('Acceptance register','سجل القبول')) + ' · ' + (kind==='health'?link('/model-card',t('Model card','بطاقة النموذج')):link('/health',t('System health','صحة النظام'))) + '</p>';
  let body;
  if (kind === "health") {
    const rows = [
      [t("Database read", "الاتصال بقاعدة البيانات"), health.ok ? t("Succeeded","ناجح") : t("Unavailable","متعذّر")],
      [t("Database check time", "زمن فحص قاعدة البيانات"),health.ms+' ms'],
      [t("Checked at (UTC)", "وقت الفحص بالتوقيت العالمي"),health.at],
      [t("Active model", "النموذج الفعّال"),model.version],
    ];
    body='<dl>'+rows.map(([a,b])=>'<dt>'+a+'</dt><dd><bdi>'+escape(b)+'</bdi></dd>').join('')+'</dl>' +
      '<p>'+t("This reading measures the current database check. Document analysis timings are measured separately in the acceptance register.","تعرض الصفحة زمن الاتصال الحالي بقاعدة البيانات. يعرض سجل القبول زمن رفع المستندات واكتمال تقاريرها.")+'</p>';
  } else {
    body='<p>'+t("Active experimental detector","الكاشف التجريبي الفعّال")+' · <bdi>'+escape(model.version)+'</bdi></p><p>'+
      t("The published detector exceeded the 1% false-alert target on human Arabic texts. The tables report eligible files, detected cases, abstentions and measured mixture errors.",
      "تجاوز الكاشف المنشور حدّ 1% للإنذارات الخاطئة على النصوص العربية البشرية. تبيّن الجداول عدد الملفات المؤهلة، والتنبيهات، وحالات الامتناع، وخطأ تقدير نسب النصوص المختلطة.")+'</p>'+
      independentPanel(model.release5,t,escape)+studyPanel(model.release4,t,escape);
  }
  return new Response('<!doctype html><html lang="'+locale+'" dir="'+(ar?'rtl':'ltr')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    escape(title)+' · Mizan</title><link rel="stylesheet" href="/studio.css"><body>'+header+'<main class="public-register"><h1>'+title+'</h1>'+nav+body+'</main></body></html>',
    {status:kind==='health'&&!health.ok?503:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
