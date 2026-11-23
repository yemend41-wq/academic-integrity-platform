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
  const title=t("Release 4 acceptance register","سجل قبول الإصدار الرابع");
  const heading='<h1>'+title+'</h1><p>'+t("Measured results and open conditions. Test scope is stated for each item.","نتائج القياس وشروط القبول المفتوحة. يبيّن كل بند بيئة الاختبار وحدوده.")+'</p>';
  const html='<!doctype html><html lang="'+(ar?"ar":"en")+'" dir="'+(ar?"rtl":"ltr")+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/studio.css"><title>'+title+' · Mizan</title></head><body>'+
    '<header><a class="brand" href="/">Mizan · ميزان</a><a class="plain" href="/acceptance?lang='+(ar?"en":"ar")+'">'+(ar?"English":"العربية")+'</a></header>'+
    '<main class="public-register"><div class="page-head"><div class="eyebrow"><bdi>'+escape(model.version)+'</bdi></div>'+heading+
    '<a href="/#acceptance">'+t("Evaluator workspace","الدخول إلى مساحة اللجنة")+'</a> · <a href="/api/health">'+t("Live health","حالة الخدمة الآن")+'</a></div>'+
    '<section class="panel">'+rows+'</section>'+studyPanel(model.release4,t,escape)+'</main></body></html>';
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
