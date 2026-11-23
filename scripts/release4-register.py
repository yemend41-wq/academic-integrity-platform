"""Build the in-app acceptance register from archived observations. Unknowns stay open."""
import json
from pathlib import Path

def read(path):
    return json.loads(Path(path).read_text())

checks = []
base_path="evidence/release4-baseline-unit.json"

def add(en, ar, status, detail, arabic, implementation, test, evidence, values=None):
    checks.append(dict(name=en, ar=ar, status=status, detail=detail, detailsAr=arabic,
                       evidence=dict(implementation=implementation, test=test, record=evidence, observations=values)))

model = read('research/detector/card.json')
sim = read('research/similarity/training/release4-evaluation.json')
r = {t['language']:t for t in sim['sourceAwareRetrieval']}
rewrites=read('research/similarity/training/release4-rewrites.json')
s = r['ar']['release4']
e = r['en']['release4']
add('Hybrid source and span retrieval', 'استرجاع المصدر وتحديد المقطع', 'partial',
    f"Top-ranked correct sources: Arabic {s['top1']}/41 and English {e['top1']}/41. The benchmark uses high-similarity sentence pairs.",
    f"استُرجع المصدر الصحيح أولًا في {s['top1']} من 41 زوجًا عربيًا و{e['top1']} من 41 زوجًا إنجليزيًا. يقيس الاختبار تشابه الجمل، وتبقى إعادة الصياغة الواسعة تحديًا.",
    'research/similarity/engine.mjs + src/analysis.mjs', 'research/similarity/training/evaluate-release4.mjs', 'research/similarity/training/release4-evaluation.json',{'sentencePairs':sim,'documentRewrites':rewrites})
add('Human false-alert rate and machine recall','إنذارات النصوص البشرية وحساسية الكشف','failed',
    'The deployed detector exceeded the 1% limit on independent human cohorts. Numeric alerts and all alerts are counted separately on the model card.',
    'تجاوز الكاشف حد 1% على مجموعات بشرية مستقلة. تعرض بطاقة النموذج عدد الإنذارات الرقمية وجميع الإشارات، بما فيها النسب المحجوبة.',
    'research/detector/detector.mjs','research/detector/release4-protocol.json','research/detector/card.json',
    {'model':model['version'],'acceptance':model['acceptance'], 'frozenExperiment':model['release4']['experiment']})
add('Mixtures, paraphrasing and back-translation','النصوص المختلطة وإعادة الصياغة والترجمة العكسية','partial',
    'Results depend on genre and text transformation. Consult the model card for mixed-text error, coverage and abstentions.',
    'تختلف النتائج حسب نوع النص وطريقة تحويله. تعرض البطاقة قياسات النص المختلط وحدودها. يبقى اختبار اللجنة المستقل مفتوحًا.',
    'research/detector/inference.mjs','research/detector/evaluate.mjs + translations.mjs','research/detector/card.json', {'mixed':model['release4']['mixed'],'limits':model['release4']['metric_notes']})
audit_path='evidence/module-audit-release4.json'
audit=read(audit_path)
for label,ar,indices,src,en,arabic in [
  ('Word, PDF, PNG and JPEG','تحليل Word وPDF وPNG وJPEG',[0,1,2],'research/media/index.mjs','Known revision text and inherited styles matched the fixture. PDF text and image structure were checked.','وافق النص الظاهر والتنسيق الموروث ملف Word المعلوم؛ واستُخرج النص الثنائي من PDF وفُحصت بنية الصورتين.'),
  ('C2PA signature and asset binding','صحة توقيع C2PA وارتباطه بالملف',[3],'research/media/c2pa.mjs','The signed original and controlled modified asset were distinguished. Independent certificate trust was not evaluated.','ميّز الفحص بين الأصل الموقّع والملف المعدّل. لم يُختبر اعتماد سلسلة الشهادات من جهة ثقة مستقلة.'),
  ('Masked index and PDF/JSON exports','حجب الهوية في الفهرس وتصدير PDF وJSON',[4,5,6],'src/privacy.mjs + src/report.mjs','Checked stored text/index, JSON and both rendered PDFs.','فُحصت بيانات التخزين والفهرس وJSON، وفُتح تقريران بالعربية والإنجليزية ورُسمت صفحاتهما.'),
  ('Clarity replay and active time','إعادة الكتابة وزمن النشاط في Clarity',[7],'src/drafts.mjs + research/clarity/redaction.mjs','Reconstructed the known input sequence and independently checked active time.','أعيد تسلسل التحرير المعروف، وفُحص احتساب زمن النشاط واستبعاد التوقف.')]:
    observed=[audit['checks'][i] for i in indices]
    status='passed' if all(x['status']=='passed' for x in observed) else 'failed'
    add(label+' · local fixtures',ar+' · ملفات محلية',status,en,arabic,src,'node test/module-audit-release4.mjs',audit_path,
        {'environment':audit['environment'],'started':audit['started'],'fixtures':audit['inputs'],'checks':observed})
add('Live citation registries','التحقق الحي من سجلات المراجع','partial',
    'Invalid checksum was identified; registry outages produced a distinct unavailable outcome. Public relaunch testing remains open.',
    'كُشف رقم ISBN غير صالح حسابيًا. عند تعذّر السجل الخارجي ظهر سبب مستقل. تبقى إعادة فحص السجلات من الإصدار المنشور مطلوبة.',
    'research/media/citations.mjs','test/module-audit-release4.mjs',audit_path,audit['registry'])
local=read('evidence/release4-candidate-loopback.json')
base=read('evidence/release4-baseline-loopback-confirmed.json')
add('Indexed upload load · isolated HTTPS','أداء الرفع مع الفهرسة · HTTPS معزول',local['status'],
    'Fifty distinct learners on loopback TLS. Each retrieved its full report, peer reads were separately checked.',
    'رفع خمسون حسابًا عبر HTTPS محلي معزول؛ تحققت الأداة من تطابق تقرير كل حساب ومنع الزملاء من قراءته.',
    'src/worker.mjs + src/analysis.mjs','scripts/release4-bench-local.mjs','evidence/release4-candidate-loopback.json',
    {'utc':local['startedUTC'],'release3':base['loadSummary'],'release4':local['loadSummary'],'initialIndex':local['indexBeforeLoad'],'singles':local['singlesSummary'],'peerReads':local['crossStudentReadbackHttp']})
suite=read('research/bench/integration-results.json')
add('Permissions, retention and saved reports · local Worker','الصلاحيات والحذف الدوري والتقارير المحفوظة · محلي',
    'passed' if all(x['status']=='passed' for x in suite['checks']) else 'failed',
    'The built Worker was exercised with SQLite and the local scheduled hook. Hosted uptime and actual scheduler execution require separate evidence.',
    'اختُبر المعالج المبني مع SQLite، واستُدعيت دالة الحذف محليًا. يبقى تشغيل الجدولة على الاستضافة واستمرارية الخدمة قياسين منفصلين.',
    'src/auth.mjs + src/worker.mjs','research/bench/integration.mjs','research/bench/integration-results.json',
    {'started':suite['started'],'runtime':suite['runtime'],'checks':[{'name':x['name'],'status':x['status']} for x in suite['checks']]})
add('Public HTTPS load and 3,000-word latency','أداء الرابط العام تحت الحمل','unverified',
    'Release 3 has a public 50-account run. A release 4 public run is required for a release 4 SLA.',
    'يتوفر اختبار عام سابق لخمسين حسابًا على الإصدار الثالث. يتطلب اعتماد زمن الإصدار الرابع جولة عامة بحسابات مستقلة.',
    'src/worker.mjs + src/analysis.mjs','scripts/release4-bench.py','evidence/https-50-final.json',
    {'release3PublicP95Ms':read('evidence/https-50-final.json')['p95Ms']})
add('Mobile and desktop committee journey','رحلة اللجنة على الهاتف والحاسوب','partial',
    'Responsive browser checks and physical-device acceptance are separate observations.',
    'تختبر المحاكاة عرض الهاتف والحاسوب. يتطلب اعتماد رحلة الهاتف الحقيقي تنفيذها على الجهاز والرابط المنشور.',
    'ui/client.mjs + ui/studio.css','test/browser-runner.js','evidence/local-browser.json',read('evidence/local-browser.json'))
add('Institutional LTI 1.3 launch','الإطلاق المؤسسي عبر LTI 1.3','unverified',
    'Local protocol tests exist. An end-to-end university launch requires a registered LMS.',
    'توجد نتائج محلية لاختبار البروتوكول. يتطلب إثبات الإطلاق الجامعي منصة تعليم مسجلة لدى الجامعة.',
    'research/lti/lti.mjs','research/lti/test.mjs','research/lti/evidence.json',{'protocolTestsPassed':read('research/lti/evidence.json')['passed']})
hosted_path = Path("evidence/release4-authenticated-public-load.json")
committee_path = Path("evidence/release4-committee-functions.json")
if hosted_path.exists():
    hosted = read(hosted_path)
    run = next(c for c in checks if c['name']=='Public HTTPS load and 3,000-word latency')
    stats = hosted.get('loadSummary', {})
    singles = hosted.get('singles', [])
    if len(singles) == 2 and stats.get('verifiedReports') is not None and stats.get('p95Ms') is not None:
        n, fast = stats['verifiedReports'], stats['under15Seconds']
        p95, slowest = stats['p95Ms']/1000, stats['maxMs']/1000
        docx, pdf = [r['uploadToCompleteReportMs']/1000 for r in singles]
        denied = hosted.get('crossStudentReadbackHttp', {}).get('404', 0)
        run.update(status=hosted['status'],
          detail=f"Public HTTPS. 3,000 words indexed, Word {docx:.2f}s and PDF {pdf:.2f}s individually. {n}/50 full reports retrieved, {fast}/50 uploads below 15s, p95 {p95:.2f}s and maximum {slowest:.2f}s. {denied}/50 peer reads denied.",
          detailsAr=f"على الرابط العام مع الفهرسة، استغرق مستند Word من 3,000 كلمة {docx:.2f} ثانية وPDF {pdf:.2f} ثانية. استُرجع {n} من 50 تقريرًا، واكتملت {fast} عملية في أقل من 15 ثانية. المئين 95 بلغ {p95:.2f} ثانية والأبطأ {slowest:.2f} ثانية. رُفضت قراءة تقارير الزملاء في {denied} من 50 محاولة.")
        run['evidence'].update(record=str(hosted_path),observations={
            k:hosted.get(k) for k in ('startedUTC','finishedUTC','releaseUnderTest','health','distinctAuthenticatedStudents','indexBeforeLoad','clientStartSpreadMs','loadSummary','crossStudentReadbackHttp','singlesSummary')})
if committee_path.exists():
    committee = read(committee_path)
    by_name={c['name']:c for c in committee['checks']}
    citation=next(c for c in checks if c['name']=='Live citation registries')
    observed=by_name.get('External DOI/ISBN lookup')
    if observed and observed['status']=='passed':
        citation.update(status='passed',detail='The published service distinguished genuine DOI and ISBN, a missing DOI, and a bad ISBN checksum.',detailsAr='تحققت الخدمة المنشورة من DOI وISBN صحيحين، وميّزت مرجع DOI غير موجود ورقم ISBN غير صالح حسابيًا.')
    citation['evidence']['observations']={'local':audit['registry'],'hosted':committee['registryObservations'],'at':committee['at']}
    if by_name:
        count=sum(c['status']=='passed' for c in by_name.values())
        add('Committee workspace · public HTTPS','مساحة اللجنة على الرابط العام',
            'passed' if count==len(by_name) else 'partial',
            f'{count}/{len(by_name)} checks passed for the committee workspace. See the individual outcomes.',
            f'اجتازت مساحة اللجنة {count} من {len(by_name)} فحوص عبر HTTPS. يبيّن السجل نتيجة كل فحص منفصل.',
            'src/worker.mjs + src/auth.mjs','scripts/live-checks.py',str(committee_path),
            {'at':committee['at'],'checks':[{'name':c['name'],'status':c['status'],'detail':c['detail']} for c in by_name.values()]})
tested_at=max([audit['finished']] + ([hosted['finishedUTC']] if hosted_path.exists() else []) + ([committee['at']] if committee_path.exists() else []))
out={'testedAt':tested_at,'referenceRun':base_path,'id':'zz-release-4','title':'Release 4 · scope of acceptance','titleAr':'الإصدار الرابع · سجل القبول','model':model['version'],'checks':checks}
Path('evidence/acceptance-release-4.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
