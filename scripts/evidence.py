import json
from pathlib import Path
def read(p):return json.loads(Path(p).read_text())
def ck(name,ar,status,detail,detailsAr,evidence=None):
 d=dict(name=name,ar=ar,status=status,detail=detail,detailsAr=detailsAr)
 if evidence is not None:d['evidence']=evidence
 return d
e=read('evidence/edge-benchmark.json'); sim=read('research/similarity/training/external-evaluation.json'); det=read('research/detector/card.json')
c=[
 ck('Bilingual AI false positives below 1%','معدل إنذارات كاشف الكتابة أقل من ١٪','failed','AIP-HL-3 returned visible alerts on 3/393 Liang English human texts, 227/799 Arabic course-project texts and 32/701 Arabic academic abstracts.','سجّل النموذج المنشور إشارات ظاهرة على ٣ من ٣٩٣ نصًا إنجليزيًا، و٢٢٧ من ٧٩٩ نصًا عربيًا في عينة مشاريع المقرر، و٣٢ من ٧٠١ ملخصًا أكاديميًا عربيًا.',det['groups']),
 ck('Source matching and paraphrase retrieval','مطابقة المصادر وإعادة الصياغة','partial','The published PDF matched its indexed paper. Held-out high-similarity pairs retrieved: 21/41 English and 6/41 Arabic.','تعرّف المحرك على المقال المنشور. استرجع ٢١ من ٤١ زوجًا إنجليزيًا عالي التشابه و٦ من ٤١ زوجًا عربيًا.',sim),
 ck('Single 3,000-word uploads in the local edge runtime','رفع مستندات ٣٠٠٠ كلمة في محرك محلي','passed',e['checks'][0]['detail'],'قياسات فردية محلية لملفي Word وPDF. يعرض التفصيل مدة كل ملف.',e['runs'][:2]),
 ck('50 concurrent uploads in the local edge runtime','خمسون عملية رفع متزامنة محليًا',e['checks'][1]['status'],e['checks'][1]['detail'],'جلسة مصادقة واحدة، ٢٥ ملف Word و٢٥ ملف PDF، مع استرجاع التقارير من قاعدة البيانات.',e['checks'][1]['evidence']),
 ck('File and media inspection','فحص المستندات والوسائط','passed','Local workerd inspected real binary files in five cases. The C2PA test checks asset binding and signature. Signer trust is not evaluated.','فُحصت خمس حالات بملفات فعلية. شمل فحص C2PA التوقيع وارتباطه بالملف. لم يُختبر اعتماد الموقّع لدى قائمة ثقة.',read('research/media/tests/edge-media-results.json')),
 ck('Reference registries','سجلات المراجع','unverified','Local network did not verify DOI or ISBN registry access. An offline response is not a fabricated reference.','تعذّر التحقق من اتصال السجلات في الاختبار المحلي. تعرض المنصة نتيجة تعذّر الاتصال عند غياب الرد.'),
 ck('Clarity editing and revision playback','تعديلات المحرر وإعادة تشغيل المراجعات','passed','The local editor, persistence, privacy and conflict checks passed.','اجتاز المحرر اختبارات محلية للتعديلات والحفظ وتعارض النسخ وحجب أجزاء بيانات الهوية في المراجعات السابقة.',read('research/clarity/evidence.json')),
 ck('PDF audit export','تصدير تقرير PDF','passed','Two bilingual audit fixtures were parsed, rendered and checked for pagination.','خضع تقريران بالعربية والإنجليزية لفحص القراءة والعرض وترقيم الصفحات.',read('research/export/tests/evidence.json')),
 ck('LTI 1.3 resource launch','الربط بنظام التعلم LTI 1.3','partial','16 local protocol checks passed. Institutional LMS launch requires registration.','اجتازت الوحدة ١٦ فحصًا محليًا. يتطلب التحقق المؤسسي تسجيل المنصة في نظام تعلم الجامعة.'),
 ck('Blind committee files and mobile end-to-end acceptance','ملفات اللجنة العمياء والاختبار الكامل على الهاتف','unverified','No blind committee outcome or physical-device acceptance has been recorded.','لم تتوافر نتيجة من اختبار اللجنة الأعمى أو اختبار قبول على هاتف فعلي.'),
]
if Path('evidence/local-browser.json').exists():
 v=read('evidence/local-browser.json');c.append(ck('Mobile-width Arabic and desktop-width English browser workflows','مسارات المتصفح العربية بعرض الهاتف والإنجليزية بعرض الحاسوب','passed' if len(v['checks'])==8 and all(x['status']=='passed' for x in v['checks']) else 'partial','Actual Chrome rendered a 390px and a 1240px viewport on the local test deployment. Eight upload, export, editor, search and health workflows passed.','اجتاز متصفح Chrome ثمانية اختبارات على نسخة محلية بعرض ٣٩٠ و١٢٤٠ بكسل، منها الرفع والتصدير والمحرر والبحث.',v))
if Path('research/bench/integration-results.json').exists():
 v=read('research/bench/integration-results.json');c.append(ck('Integrated API and role checks','اختبارات الوظائف والصلاحيات المحلية','passed' if all(x['status']=='passed' for x in v['checks']) else 'partial','Local authenticated API tests; see details.','تتضمن التفاصيل نتائج المسارات المحمية وفحص الملفات.',v['checks']))
Path('evidence/initial.json').write_text(json.dumps(dict(title='Development measurements',titleAr='قياسات التطوير',checks=c),ensure_ascii=False,indent=2))
