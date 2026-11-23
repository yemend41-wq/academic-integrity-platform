import { displayedOverlap, sourceScope, writingExplanation } from "./report-interpretation.mjs";
import { writingPassages } from "./writing-passages.mjs";
import { mountBlindPanel } from "./blind-panel.mjs";
import { independentPanel } from "./independent-study.mjs";
import { studyPanel } from "./study.mjs";
import { fileTerm } from "../research/media/labels.mjs";
import { mountClarity } from "../research/clarity/editor.mjs";
const $ = (s) => document.querySelector(s),
  frame = $("#frame"),
  lang = $("#lang"),
  logout = $("#logout");
let ar = localStorage.getItem("mizan-language") === "ar",
  principal = null,
  page = "desk",
  report = null,
  clean = null,
  navToken = 0,
  timer = 0;
const t = (en, arb) => (ar ? arb : en);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (n) =>
  new Intl.DateTimeFormat(ar ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(n * 1000);
const btn = (q, fn) => {
  const el = $(q);
  if (el) el.onclick = fn;
};
function notify(message) {
  $("#notice").textContent = message;
  clearTimeout(timer);
  timer = setTimeout(() => ($("#notice").textContent = ""), 6500);
}
const errors = {
  invalid_login: [
    "Check your username and password.",
    "تحقق من اسم المستخدم وكلمة المرور.",
  ],
  unsupported_document: [
    "This file could not be read. Check the format and encryption.",
    "تعذّرت قراءة الملف. تحقق من صيغته ومن الحماية بكلمة مرور.",
  ],
  format_mismatch: [
    "The file content differs from its extension.",
    "محتوى الملف لا يطابق امتداده.",
  ],
  size_limit: [
    "Choose a file smaller than 8 MiB.",
    "اختر ملفًا أصغر من ٨ ميبيبايت.",
  ],
  text_limit: [
    "This text exceeds the 100,000-character limit.",
    "يتجاوز هذا النص الحد البالغ ١٠٠ ألف حرف.",
  ],
  empty_text: ["No text is available to analyze.", "لا يوجد نص متاح للتحليل."],
  draft_conflict: [
    "A newer revision is available.",
    "توجد مراجعة أحدث للمسودة.",
  ],
};
async function api(path, opt = {}) {
  const res = await fetch(path, opt);
  let obj;
  try {
    obj = await res.json();
  } catch {
    obj = {};
  }
  if (!res.ok) {
    const err = new Error(
      errors[obj.error]
        ? t(...errors[obj.error])
        : t("Request failed", "تعذّر إكمال الطلب") +
          " (" +
          (obj.error || res.status) +
          ")",
    );
    err.status = res.status;
    err.code = obj.error;
    throw err;
  }
  return obj;
}
const post = (data) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
function language() {
  document.documentElement.lang = ar ? "ar" : "en";
  document.documentElement.dir = ar ? "rtl" : "ltr";
  lang.textContent = ar ? "English" : "العربية";
  logout.hidden = !principal;
  logout.textContent = t("Sign out", "تسجيل الخروج");
}
function signIn() {
  language();
  frame.innerHTML =
    '<main class="login-shell"><section class="intro"><div class="eyebrow">' +
    t("Academic integrity", "النزاهة الأكاديمية") +
    "</div><h1>" +
    t("Evidence for a closer reading.", "أدلة تساعدك على قراءة أدق.") +
    "</h1><p>" +
    t(
      "Review source matches, inspect file history and revisit the writing process in one bilingual workspace.",
      "راجع المقاطع المتشابهة، وافحص خصائص الملف، وتتبّع كيف تطوّر النص أثناء الكتابة.",
    ) +
    '</p><div class="facets"><span>' +
    t("Source matching", "مطابقة المصادر") +
    "</span><span>" +
    t("File forensics", "فحص الملفات") +
    "</span><span>" +
    t("Writing history", "سجل الكتابة") +
    '</span></div></section><form class="login-form" id="login"><div><div class="eyebrow">' +
    t("Review studio", "استوديو المراجعة") +
    "</div><h2>" +
    t("Workspace sign-in", "الدخول إلى مساحة العمل") +
    "</h2></div><label>" +
    t("Username", "اسم المستخدم") +
    '<input autocomplete="username" id="username" dir="ltr" required></label><label>' +
    t("Password", "كلمة المرور") +
    '<input id="password" type="password" autocomplete="current-password" dir="ltr" required></label><button class="primary">' +
    t("Sign in", "دخول") +
    '</button><a href="/acceptance?lang=' + (ar ? 'ar' : 'en') + '">' +
    t("View acceptance results", "عرض نتائج التقييم") +
    '</a><p class="error" role="alert" id="sign-error"></p></form></main>';
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      principal = await api(
        "/api/login",
        post({
          username: $("#username").value.trim(),
          password: $("#password").value,
        }),
      );
      await go(location.hash === "#acceptance" ? "health" : "desk");
    } catch (x) {
      $("#sign-error").textContent = x.message;
    } finally {
      b.disabled = false;
    }
  };
}
const navNames = {
  desk: ["Review desk", "مكتب المراجعة"],
  records: ["Submissions", "المستندات"],
  clarity: ["Clarity editor", "محرر الكتابة"],
  health: ["Model & system", "النموذج والاختبارات"],
  members: ["Members", "الأعضاء"],
};
const head = (small, title, sub = "") =>
  '<div class="page-head"><div class="eyebrow">' +
  small +
  "</div><h1>" +
  title +
  "</h1>" +
  (sub ? "<p>" + sub + "</p>" : "") +
  "</div>";
function shell() {
  language();
  frame.innerHTML =
    '<div class="stage"><div class="bar"><nav>' +
    Object.entries(navNames)
      .filter(([id]) => id !== "members" || principal.role === "admin")
      .map(
        ([id, label]) =>
          '<button data-nav="' +
          id +
          '" class="' +
          (page === id ? "active" : "") +
          '">' +
          t(...label) +
          "</button>",
      )
      .join("") +
    '</nav><span class="role">' +
    esc(
      principal.role === "instructor"
        ? t("Instructor", "مدرّس")
        : principal.role === "admin"
          ? t("Administrator", "مسؤول")
          : t("Student", "طالب"),
    ) +
    '</span></div><main id="content" tabindex="-1"></main></div>';
  document
    .querySelectorAll("[data-nav]")
    .forEach((b) => (b.onclick = () => go(b.dataset.nav)));
}
async function go(next, r = null) {
  if (clean) {
    if (!(await clean())) return;
    clean = null;
  }
  page = next;
  const seq = ++navToken;
  if (r) report = r;
  shell();
  const c = $("#content");
  try {
    if (next === "desk") await desk(c, seq);
    else if (next === "records") await records(c, seq);
    else if (next === "health") await health(c, seq);
    else if (next === "report") renderReport(c, report);
    else if (next === "members") members(c);
    else {
      c.innerHTML =
        head(
          t("Clarity", "مساحة الكتابة"),
          t("Writing session", "جلسة الكتابة"),
        ) + '<section class="panel editor-shell" id="editor"></section>';
      const cleanup = await mountClarity($("#editor"), {
        ar,
        api,
        notify,
        onReport: (r) => go("report", r),
      });
      if (seq === navToken) clean = cleanup;
      else await cleanup();
    }
  } catch (e) {
    if (seq === navToken) {
      c.innerHTML =
        '<div class="panel space" role="alert">' + esc(e.message) + "</div>";
      if (e.status === 401) {
        principal = null;
        signIn();
      }
    }
  }
}
const fmtFile = (f) =>
  f === "clarity" ? t("Editor", "المحرر") : String(f).toUpperCase();
function list(rows) {
  return rows.length
    ? '<ul class="list">' +
        rows
          .map(
            (r) =>
              '<li><button class="row-link" data-id="' +
              esc(r.id) +
              '">' +
              esc(fmtFile(r.kind)) +
              " · " +
              esc(r.id.slice(0, 8)) +
              '</button><div class="meta">' +
              esc(date(r.created)) +
              " · " +
              esc(r.words) +
              " " +
              t("words", "كلمة") +
              "</div></li>",
          )
          .join("") +
        "</ul>"
    : '<p class="hint">' +
        t(
          "Your uploaded documents will appear here.",
          "ستظهر هنا الملفات التي ترفعها.",
        ) +
        "</p>";
}
function bindReports(c) {
  c.querySelectorAll("[data-id]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await go("report", await api("/api/reports/" + b.dataset.id));
        } catch (e) {
          notify(e.message);
        }
      }),
  );
}
async function desk(c, seq) {
  c.innerHTML =
    head(t("Workspace", "مساحة العمل"), t("Review desk", "مكتب المراجعة")) +
    '<div class="grid"><section class="panel"><h3>' +
    t("Analyze a document", "تحليل مستند") +
    '</h3><div id="drop" class="drop"><div class="glyph" aria-hidden="true"></div><strong>' +
    t("Choose a file or drop it here", "اختر ملفًا أو اسحبه إلى هنا") +
    '</strong><small>DOCX · PDF · TXT · PNG · JPEG &nbsp; / &nbsp; 8 MiB</small><input id="file" type="file" aria-label="' +
    t("Choose file", "اختيار ملف") +
    '" accept=".docx,.pdf,.txt,.png,.jpeg,.jpg"><span id="chosen" class="meta"></span></div><div class="settings"><label><input id="quotes" type="checkbox" checked>' +
    t("Exclude quotations", "استبعاد الاقتباسات") +
    '</label><label><input id="refs" type="checkbox" checked>' +
    t("Exclude bibliography", "استبعاد المراجع") +
    '</label></div><div class="settings file-opts"><label><input id="index" type="checkbox" checked>' +
    t(
      "Include in this cohort’s similarity index",
      "إدراج النص في فهرس تشابه المجموعة",
    ) +
    '</label></div><div class="actions"><button id="upload" class="primary" disabled>' +
    t("Run analysis", "بدء التحليل") +
    '</button><span role="status" id="upstatus"></span></div><p class="subtle gap">' +
    t(
      "Original files are processed in memory. Masked reports and drafts expire after seven days.",
      "تُفحص الملفات الأصلية في الذاكرة. تنتهي صلاحية التقارير والمسودات المحجوبة المعرّفات بعد سبعة أيام.",
    ) +
    '</p></section><aside><section class="panel"><div class="inline"><h3>' +
    t("Recent submissions", "أحدث المستندات") +
    '</h3></div><div id="recent" aria-live="polite">…</div></section><section class="panel"><h3>' +
    t("Reading the signals", "قراءة المؤشرات") +
    '</h3><p class="hint">' +
    t(
      "A similarity match identifies a source to inspect. A writing signal calls for a closer reading. An instructor reviews the evidence before any academic decision.",
      "تُحيل نتيجة التشابه إلى مصدر يمكن مراجعته. أما مؤشر الكتابة فيوجّه الانتباه إلى مقطع يستحق القراءة. يراجع المدرّس الأدلة قبل اتخاذ أي قرار أكاديمي.",
    ) +
    "</p></section></aside></div>";
  let selected = null;
  const setFile = (f) => {
    selected = f;
    $("#chosen").textContent = f?.name || "";
    $("#upload").disabled = !f;
  };
  $("#file").onchange = (e) => setFile(e.target.files[0]);
  const drop = $("#drop");
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add("over");
  };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    setFile(e.dataTransfer.files[0]);
  };
  btn("#upload", async (e) => {
    if (!selected) return;
    const b = e.currentTarget;
    b.disabled = true;
    const s = $("#upstatus");
    s.textContent = t("Analyzing…", "جارٍ التحليل…");
    try {
      if (selected.size > 8388608) throw Error(t(...errors.size_limit));
      const data = await api("/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-format": selected.name.split(".").pop().toLowerCase(),
          "x-index": $("#index").checked ? "yes" : "no",
          "x-quotes": $("#quotes").checked ? "exclude" : "include",
          "x-references": $("#refs").checked ? "exclude" : "include",
        },
        body: selected,
      });
      if (seq === navToken) await go("report", data);
    } catch (x) {
      s.textContent = x.message;
    } finally {
      b.disabled = false;
    }
  });
  const data = await api("/api/reports");
  if (seq === navToken) {
    $("#recent").innerHTML = list(data.reports.slice(0, 5));
    bindReports(c);
  }
}
async function records(c, seq) {
  c.innerHTML =
    head(t("Cohort archive", "سجل المجموعة"), t("Submissions", "المستندات")) +
    '<section class="panel"><label class="field">' +
    t(
      "Filter by file type or document ID",
      "بحث بصيغة الملف أو معرّف المستند",
    ) +
    '<input id="search" type="text"></label><div id="rows"></div><button id="more" class="ghost" hidden>' +
    t("Load more", "عرض المزيد") +
    "</button></section>";
  let all = [],
    more = true;
  const show = () => {
    const q = $("#search").value.toLowerCase().trim();
    $("#rows").innerHTML = list(
      all.filter((r) => (r.id + " " + r.kind).toLowerCase().includes(q)),
    );
    bindReports(c);
    $("#more").hidden = !more;
  };
  const load = async () => {
    const last = all.at(-1);
    const r = await api(
      "/api/reports" +
        (last ? "?before=" + last.created + "&last=" + last.id : ""),
    );
    if (seq !== navToken) return;
    all.push(...r.reports);
    more = r.more;
    show();
  };
  $("#search").oninput = show;
  btn("#more", () => load().catch((x) => notify(x.message)));
  await load();
}
function tree(data, depth = 0) {
  if (data == null || data === "") return '<span class="subtle">—</span>';
  if (typeof data !== "object")
    return esc(typeof data === "string" ? fileTerm(data, ar) : data);
  const entries = Object.entries(data);
  if (!entries.length)
    return (
      '<span class="subtle">' + t("No entries", "لا توجد عناصر") + "</span>"
    );
  if (depth > 7) return "<pre>" + esc(JSON.stringify(data, null, 2)) + "</pre>";
  return (
    '<div class="tree">' +
    entries
      .map(([k, v]) =>
        typeof v === "object" && v !== null
          ? "<details><summary>" +
            esc(fileTerm(k, ar)) +
            " (" +
            Object.keys(v).length +
            ")</summary>" +
            tree(v, depth + 1) +
            "</details>"
          : '<div class="data"><dt>' +
            esc(fileTerm(k, ar)) +
            "</dt><dd>" +
            tree(v, depth + 1) +
            "</dd></div>",
      )
      .join("") +
    "</div>"
  );
}
function highlight(text, spans, mode) {
  const ids = [...new Set(spans.map((x) => x.sourceId))];
  let out = "",
    pos = 0;
  const order = spans.map((span, index) => ({ span, index }))
    .sort((a, b) => a.span.start - b.span.start);
  for (const { span: s, index } of order) {
    if (s.start < pos || s.end <= s.start || s.end > text.length) continue;
    const passage = esc(text.slice(s.start, s.end));
    out += esc(text.slice(pos, s.start));
    if (mode === "ai") out += '<mark class="ai-mark">' + passage + '</mark>';
    else out += '<a class="passage-link source' + (ids.indexOf(s.sourceId) % 4) +
      '" href="#match-' + index + '" data-evidence="' + index + '">' + passage + '</a>';
    pos = s.end;
  }
  return out + esc(text.slice(pos));
}
function renderReport(c, r) {
  const sim = r.similarity,
    det = r.detector;
  c.innerHTML =
    head(
      t("Document review", "مراجعة المستند"),
      esc(fmtFile(r.format)) + " · <bdi>" + esc(r.id.slice(0, 8)) + "</bdi>",
      esc(date(r.created)),
    ) +
    '<div class="metric-grid">' +
    [
      [displayedOverlap(sim, ar), t("Source overlap", "التشابه مع المصادر")],
      [det.display ?? "—", t("AI writing signal", "مؤشّر الكتابة المولّدة"), writingExplanation(det, ar)],
      [r.words, t("Extracted words", "الكلمات المستخرجة")],
    ]
      .map(
        ([v, k, explanation]) =>
          '<div class="metric"><strong><bdi dir="ltr">' +
          esc(v) +
          "</bdi></strong><span>" +
          k +
          "</span>" + (explanation ? '<small class="metric-note">' + esc(explanation) + "</small>" : "") + "</div>",
      )
      .join("") +
    '</div><section class="panel"><div class="tabs">' +
    [
      ["matches", t("Similarity", "التشابه")],
      ["writing", t("Writing signals", "مؤشرات الكتابة")],
      ["file", t("File & provenance", "الملف والمنشأ")],
      ["refs", t("Citations", "المراجع")],
    ]
      .map(([k, v]) => '<button data-tab="' + k + '">' + v + "</button>")
      .join("") +
    '</div><div id="detail"></div></section><div class="actions"><a class="action" download href="/api/reports/' +
    r.id +
    "/pdf?lang=" +
    (ar ? "ar" : "en") +
    '">' +
    t("Download PDF in English", "تنزيل PDF بالعربية") +
    '</a><a class="ghost" download href="/api/reports/' + esc(r.id) + '/pdf?lang=' + (ar ? 'en' : 'ar') + '">' +
    t("Download PDF in Arabic", "تنزيل PDF بالإنجليزية") +
    '</a><a class="ghost" download href="/api/reports/' +
    r.id +
    '/json">' +
    t("Download JSON", "تنزيل JSON") +
    '</a></div><p class="hint">'+t("Report ID", "معرّف التقرير")+' · <bdi class="report-id">'+esc(r.id)+'</bdi></p>';
  const detail = $("#detail");
  let activeSim = sim;
  let applied = { ...r.options };
  const filterSummary = () => t(
    "Overlap divides matched words by eligible words. Excluding quotes or references removes those words from both counts. Exports retain the original saved settings.",
    "تُحسب النسبة بقسمة الكلمات المطابقة على المشمولة. يحذف استبعاد الاقتباسات أو المراجع كلماتها من العدّين. تعرض ملفات التصدير الإعدادات الأصلية المحفوظة."
  );
  const similarityView = () => {
    const matches = activeSim.matches || [],
      ids = [...new Set(matches.map((x) => x.sourceId))];
    const indexOf = new Map(matches.map((m, i) => [m, i]));
    const metric = c.querySelector(".metric strong");
    if (metric) metric.querySelector("bdi").textContent = displayedOverlap(activeSim, ar);
    detail.innerHTML =
      '<div class="settings"><label><input id="rq" type="checkbox">' +
      t("Exclude quotations", "استبعاد الاقتباسات") +
      '</label><label><input id="rb" type="checkbox">' +
      t("Exclude bibliography", "استبعاد المراجع") +
      '</label><button id="refilter" class="ghost">' +
      t("Apply", "تطبيق") +
      '</button></div><p class="hint">' +
      esc(displayedOverlap(activeSim, ar)) +
      " · " +
      esc(activeSim.matchedWords) +
      " / " +
      esc(activeSim.eligibleWords) +
      " " +
      t("eligible words", "كلمة مشمولة") +
      '</p><p class="hint">' + filterSummary() + '</p><p class="mini-bar gap">' + esc(sourceScope(activeSim, ar)) + '</p><div class="grid"><div class="review-text" dir="auto">' +
      (highlight(r.text, matches, "sim") ||
        t("No extractable text", "لا يوجد نص قابل للاستخراج")) +
      "</div><aside><h3>" +
      t("Matched sources", "المصادر المطابقة") +
      '</h3><ul class="list">' +
      (ids.length
        ? ids
            .map((id, i) => {
              const m = matches.find((x) => x.sourceId === id);
              const url = m.sourceUrl || "";
              return (
                '<li><mark class="source' +
                (i % 4) +
                '">' +
                esc(m.sourceTitle || id) +
                "</mark><br><small>" +
                esc(matches.filter((x) => x.sourceId === id).length) +
                " " +
                t("passages", "مقاطع") +
                "</small>" +
                (/^https:\/\//i.test(url)
                  ? ' · <a target="_blank" rel="noopener noreferrer" href="' +
                    esc(url) +
                    '">' +
                    t("Source", "المصدر") +
                    "</a>"
                  : "") +
                "<details><summary>" +
                t("Evidence", "الدليل") +
                "</summary>" +
                matches
                  .filter((x) => x.sourceId === id)
                  .map((match) => {
                    const index = indexOf.get(match);
                    const range = Number.isInteger(match.sourceStart) && Number.isInteger(match.sourceEnd)
                      ? '<bdi>' + match.sourceStart + '–' + match.sourceEnd + '</bdi>' : '';
                    return '<article class="match-pair" tabindex="-1" id="match-' + index + '"><strong>' +
                      t("Submission passage", "المقطع في المستند") + '</strong><p dir="auto">' +
                      esc(r.text.slice(match.start, match.end)) + '</p><strong>' +
                      t("Source passage", "المقطع في المصدر") + '</strong><blockquote dir="auto">' +
                      (esc(match.sourceExcerpt) || t("Excerpt unavailable in this saved report.", "لا يتوفر مقتطف المصدر في هذا التقرير المحفوظ.")) +
                      '</blockquote><small>' + (match.method === "verbatim" ? t("Verbatim", "تطابق حرفي") : t("Paraphrase", "إعادة صياغة")) +
                      ' · ' + t("Source offsets", "موضع المقطع في المصدر") + ' ' + range + '</small></article>';
                  })
                  .join("") +
                "</details></li>"
              );
            })
            .join("")
        : "<li>" + t("No source matched.", "لم تظهر مقاطع مطابقة.") + "</li>") +
      "</ul></aside></div>";
    $("#rq").checked = applied.excludeQuotes;
    $("#rb").checked = applied.excludeReferences;
    detail.querySelectorAll("[data-evidence]").forEach(link => {
      link.onclick = event => {
        event.preventDefault();
        const evidence = detail.querySelector("#match-" + link.dataset.evidence);
        if (!evidence) return;
        evidence.closest("details").open = true;
        evidence.focus();
        evidence.scrollIntoView({block:"center"});
      };
    });
    btn("#refilter", async (e) => {
      const a = $("#rq").checked,
        b = $("#rb").checked;
      e.currentTarget.disabled = true;
      try {
        activeSim = await api(
          "/api/reports/" +
            r.id +
            "/similarity?quotes=" +
            (a ? "exclude" : "include") +
            "&references=" +
            (b ? "exclude" : "include"),
        );
        applied = { excludeQuotes: a, excludeReferences: b };
        similarityView();
      } catch (x) {
        notify(x.message);
        similarityView();
      }
    });
  };
  const tab = (k) => {
    c.querySelectorAll("[data-tab]").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === k),
    );
    if (k === "matches") similarityView();
    else if (k === "writing") {
      detail.innerHTML =
        "<h3>" +
        t("Sentence-level review", "مراجعة الجمل") +
        '</h3><p class="mini-bar gap">' +
        t(
          "Experimental detector. False alerts exceeded the target, especially on Arabic human text. Use the Model & system tab to inspect results.",
          "كاشف تجريبي. تجاوزت الإنذارات الخاطئة الحد المطلوب، خصوصًا في النصوص العربية البشرية. راجع نتائج الاختبارات في بطاقة النموذج.",
        ) +
        '</p><p class="hint">' +
        esc(writingExplanation(det, ar)) +
        '</p><p class="hint">' + t("Eligible words", "الكلمات المؤهلة") + ' · <bdi>' + esc(det.eligibleWords) + '</bdi>. ' +
        t("The percentage is the share of eligible words in selected segments.", "تعبّر النسبة عن حصة الكلمات المؤهلة الواقعة في المقاطع التي حدّدها الكاشف.") + '</p>' +
        (det.status === "analyzed" && det.segments?.some(s => s.flagged) ? '<label class="field">' +
          t("Blue highlighting", "عرض التظليل الأزرق") + '<select data-writing-level><option value="sentences">' +
          t("Sentences", "الجمل") + '</option><option value="passages">' + t("Contiguous passages", "المقاطع المتصلة") +
          '</option></select></label>' : '') + '<div class="review-text" data-writing-text dir="auto"></div>';
      const displaySpans = () => {
        const segments = det.status === "analyzed" ? det.segments || [] : [];
        const spans = detail.querySelector("[data-writing-level]")?.value === "passages" ?
          writingPassages(r.text, segments) : segments.filter(s => s.flagged);
        detail.querySelector("[data-writing-text]").innerHTML = highlight(r.text, spans, "ai");
      };
      const level = detail.querySelector("[data-writing-level]");
      if (level) level.onchange = displaySpans;
      displaySpans();
    } else if (k === "file")
      detail.innerHTML =
        "<h3>" +
        t("Content credentials", "اعتماد المحتوى") +
        "</h3>" +
        tree(r.provenance) +
        '<h3 class="space">' +
        t("Extracted file properties", "خصائص الملف المستخرجة") +
        "</h3>" +
        tree(r.forensics) +
        (r.telemetry
          ? '<h3 class="space">' +
            t("Writing session", "جلسة الكتابة") +
            "</h3>" +
            tree(r.telemetry)
          : "");
    else
      detail.innerHTML =
        "<h3>" +
        t("Reference verification", "التحقق من المراجع") +
        "</h3>" +
        (!r.citations?.length
          ? '<p class="hint">' +
            t(
              "No DOI or ISBN identifiers were found.",
              "لم يُعثر على معرّفات DOI أو ISBN في النص.",
            ) +
            "</p>"
          : r.citations
              .map(
                (x) =>
                  '<div class="record"><strong dir="ltr">' +
                  esc(x.id) +
                  "</strong> · " +
                  esc(x.kind.toUpperCase()) +
                  "<p>" +
                  esc(x.title || "") +
                  "</p><small>" +
                  esc(fileTerm(x.status, ar)) +
                  " · " +
                  esc(x.registry || "") +
                  "</small>" +
                  (x.publisherSource
                    ? '<p><a target="_blank" rel="noopener noreferrer" href="' +
                      esc(x.publisherSource) +
                      '">' +
                      t("Publisher record", "سجل الناشر") +
                      "</a></p>"
                    : "") +
                  (x.attempts?.length
                    ? "<details><summary>" +
                      t("Registry checks", "استعلامات السجلات") +
                      "</summary>" +
                      tree(x.attempts) +
                      "</details>"
                    : "") +
                  "</div>",
              )
              .join(""));
  };
  c.querySelectorAll("[data-tab]").forEach(
    (b) => (b.onclick = () => tab(b.dataset.tab)),
  );
  tab("matches");
}
async function health(c, seq) {
  c.innerHTML =
    head(
      t("System oversight", "متابعة النظام"),
      t("Model card & checks", "بطاقة النموذج والاختبارات"),
    ) + '<div class="loading">…</div>';
  const [h, d] = await Promise.all([
    api("/api/health"),
    api("/api/health/details"),
  ]);
  if (seq !== navToken) return;
  const groups = d.model.groups || [];
  const deferredEvidence = [];
  const evidenceSection = (label, value) => {
    const id = deferredEvidence.push(value) - 1;
    return '<details data-observation="' + id + '"><summary>' + label + '</summary></details>';
  };
  const checkList = (checks) =>
    checks
      .map(
        (ch) =>
          '<div class="record"><span class="badge ' +
          (ch.status === "failed"
            ? "fail"
            : ch.status === "passed"
              ? ""
              : "warn") +
          '">' +
          esc(
            {
              passed: t("Passed", "اجتاز"),
              failed: t("Failed", "لم يجتز"),
              unverified: t("Unverified", "غير متحقق"),
              partial: t("Partial", "جزئي"),
            }[ch.status] || ch.status,
          ) +
          "</span> <strong>" +
          esc(ar ? ch.ar || ch.name : ch.name) +
          '</strong><p class="hint">' +
          esc(ar ? ch.detailsAr || ch.detail : ch.detail) +
          "</p>" +
          (ch.evidence
            ? evidenceSection(t("Run evidence", "بيانات التشغيل"), ch.evidence)
            : "") +
          "</div>",
      )
      .join("");
  c.innerHTML =
    head(
      t("System oversight", "متابعة النظام"),
      t("Model card & checks", "بطاقة النموذج والاختبارات"),
    ) +
    '<div class="grid"><div><section class="panel"><div class="eyebrow">' +
    t("Acceptance register", "سجل القبول") +
    "</div><h2>" +
    t("Test evidence", "نتائج الاختبار") +
    "</h2>" +
    [...d.runs, d.baseline]
      .map((run, i) => {
        const title = esc(ar ? run.titleAr || run.title : run.title);
        const content = checkList(run.checks || []);
        return i === 0 ? '<h3 class="space">' + title + '</h3>' + content
          : '<details class="past-run"><summary>' + title + '</summary>' + content + '</details>';
      })
      .join("") +
    '</section>' + independentPanel(d.model.release5,t,esc) + studyPanel(d.model.release4, t, esc) +
    (["instructor","admin"].includes(principal.role) ? '<div id="blind-panel"></div>' : '') + '</div><aside><section class="panel"><div class="inline"><h3>' +
    t("System health", "حالة النظام") +
    '</h3><span class="badge">' +
    t("Online", "متصل") +
    '</span></div><p class="hint">' +
    t("Database probe", "زمن استجابة قاعدة البيانات") +
    " · " +
    esc(h.dbMs) +
    " ms</p><small>" +
    esc(h.at) +
    '</small></section><section class="panel"><div class="eyebrow">' +
    esc(d.model.version) +
    "</div><h3>" +
    t("Writing detector", "كاشف الكتابة") +
    '</h3><p class="hint">' +
    t(
      "Language-specific classifiers examine overlapping 96-word windows. Fewer than 48 eligible words produce no score. Scores between 1% and 19% appear as *%.",
      "يفحص الكاشف نوافذ متداخلة من ٩٦ كلمة. يمتنع عن عرض مؤشر إذا قلّ النص المؤهل عن ٤٨ كلمة، ويحجب القيم من ١٪ إلى ١٩٪ بالرمز *%.",
    ) +
    '</p><p class="mini-bar gap">' +
    t(
      "False alerts exceeded 1% on independent human texts. An instructor must review all signals.",
      "تجاوزت الإنذارات الخاطئة ١٪ على نصوص بشرية مستقلة. يحتاج كل مؤشر إلى مراجعة المدرّس.",
    ) +
    "</p>" +
    groups
      .map(
        (g) =>
          '<div class="record"><strong>' +
          esc(g.group) +
          "</strong><div>" +
          esc(g.numeric_alerts) +
          " / " +
          esc(g.eligible) +
          " · " +
          esc(((100 * g.numeric_alerts) / g.eligible).toFixed(2)) +
          "%</div><small>" +
          t("Visible alerts on human texts", "إنذارات ظاهرة على نصوص بشرية") +
          "</small></div>",
      )
      .join("") +
    "<details><summary>" +
    t("Training, recall and limits", "التدريب والحساسية وحدود القياس") +
    "</summary>" +
    tree(d.model) +
    '</details></section><section class="panel"><h3>' +
    t("Privacy & retention", "الخصوصية والاحتفاظ") +
    '</h3><p class="hint">' +
    t(
      "Only DOI and ISBN identifiers are sent to registries. Raw uploads stay in request memory. Pattern-based masking covers selected identifiers and labelled names. Review other identifying details before upload.",
      "تتلقى سجلات المراجع معرّفات DOI وISBN فقط. تبقى الملفات الأصلية في ذاكرة الطلب. يحجب النظام أنماطًا محددة من المعرّفات والأسماء المسبوقة بحقل تعريفي. راجع تفاصيل الهوية الأخرى قبل الرفع.",
    ) +
    '</p></section><section class="panel"><h3>LTI 1.3</h3><a href="/lti/config" target="_blank" rel="noopener">' +
    t("Registration endpoints", "نقاط ربط نظام التعلم") +
    "</a><details><summary>" +
    t("Protocol checks", "اختبارات البروتوكول") +
    "</summary>" +
    tree(d.lti) +
    "</details></section></aside></div>";
  if (c.querySelector("#blind-panel")) mountBlindPanel(c.querySelector("#blind-panel"), {t,api,esc});
  c.querySelectorAll("[data-observation]").forEach(el => {
    el.ontoggle = () => {
      if (!el.open) return;
      el.insertAdjacentHTML("beforeend", tree(deferredEvidence[Number(el.dataset.observation)]));
      el.ontoggle = null;
    };
  });
}
function members(c) {
  c.innerHTML =
    head(
      t("Administration", "الإدارة"),
      t("Course members", "أعضاء المجموعة"),
    ) +
    '<form class="panel login-form" id="add"><label>' +
    t("Username", "اسم المستخدم") +
    '<input type="text" name="username" required pattern="[a-z][a-z0-9-]{3,31}" autocomplete="off"></label><label>' +
    t("Role", "الدور") +
    '<select name="role"><option value="student">' +
    t("Student", "طالب") +
    '</option><option value="instructor">' +
    t("Instructor", "مدرّس") +
    '</option></select></label><button class="primary">' +
    t("Create course account", "إنشاء حساب للمجموعة") +
    '</button><output dir="auto"></output></form>';
  $("#add").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const result = await api(
        "/api/members",
        post(Object.fromEntries(new FormData(f))),
      );
      f.querySelector("output").textContent =
        result.username + " / " + result.password;
    } catch (x) {
      f.querySelector("output").textContent = x.message;
    }
  };
}
lang.onclick = async () => {
  if (clean && !(await clean())) return;
  clean = null;
  ar = !ar;
  localStorage.setItem("mizan-language", ar ? "ar" : "en");
  principal ? await go(page) : signIn();
};
logout.onclick = async () => {
  if (clean && !(await clean())) return;
  clean = null;
  try {
    await api("/api/logout", post({}));
    principal = null;
    report = null;
    signIn();
  } catch (e) {
    notify(e.message);
  }
};
language();
api("/api/me")
  .then((p) => {
    principal = p;
    if (p.source === "lti" && p.locale && localStorage.getItem("mizan-language") === null) {
      ar = p.locale === "ar";
    }
    return go(location.hash === "#acceptance" ? "health" : "desk");
  })
  .catch(signIn);
