"""Aggregate only recorded tests into the release-specific committee register."""
import json
from pathlib import Path
def read(p):return json.loads(Path(p).read_text())
a=read('evidence/https-50-final.json');f=read('evidence/https-functions-confirmation.json');g=read('evidence/https-governance-final.json')
first=read('evidence/https-functions-final.json');books=read('evidence/https-isbn-editions.json')
s=read('evidence/https-singles-final.json');det=read('research/detector/card.json')
def check(name,ar,status,en,arab,obs):return dict(name=name,ar=ar,status=status,detail=en,detailsAr=arab,evidence=obs)
checks=[]
d,p=[b['observations'][0] for b in s['batches']]
checks.append(check('Individual 3,000-word DOCX and PDF','تحليل ملف Word وملف PDF من ٣٠٠٠ كلمة','passed' if all(b['all_uploads_under_15s'] for b in s['batches']) else 'failed',f"DOCX {d['analyze_ms']/1000:.2f} s; PDF {p['analyze_ms']/1000:.2f} s.",f"استغرق Word نحو {d['analyze_ms']/1000:.2f} ثانية، وPDF نحو {p['analyze_ms']/1000:.2f} ثانية، مع استعادة النص الكامل في الملفين.",s))
n=a['uniqueReadbacks'];checks.append(check('50 students uploading concurrently','الرفع المتزامن من خمسين حساب طالب',a['status'],f"{n} distinct readbacks; 95th percentile {a['p95Ms']/1000:.2f}s, maximum {a['maxMs']/1000:.2f}s.",f"اكتمل {n} تقريرًا وأعيدت قراءتها. بلغ المئين ٩٥ نحو {a['p95Ms']/1000:.2f} ثانية، وأبطأ طلب {a['maxMs']/1000:.2f} ثانية. كانت فهرسة المجموعة مفعّلة.",a))
refs=f['registryObservations'];checkrefs={x['id']:x['status'] for x in refs}
ok=checkrefs=={'10.1038/nature12373':'verified','10.99999/mizan-evaluation-missing-2026':'not_found','9780306406157':'verified','9780306406158':'invalid_checksum'}
checks.append(check('DOI and ISBN registry availability','التحقق الحي من DOI وISBN','passed' if ok else 'failed','All four cases passed on confirmation; a prior ISBN lookup encountered registry unavailability.','نجحت الحالات الأربع عند إعادة الفحص. سبق أن تعذّر الاتصال بأحد سجلات الكتب، وسُجلت المحاولتان.',{'confirmation':refs,'firstAttempt':first['registryObservations'],'editionChecks':books['checks']}))
checks.append(check('False alerts on human writing (<1% required)','الإنذارات الخاطئة على الكتابة البشرية (المطلوب أقل من ١٪)','failed','Displayed false positives: 3/393 in one English corpus and 227/799 in an Arabic course-project corpus. Including suppressed alerts yields 9/555 in held-out MAGE/RAID English.','ظهرت إشارات رقمية على ٣ من ٣٩٣ نصًا إنجليزيًا و٢٢٧ من ٧٩٩ نصًا عربيًا. بلغ العدد في عينة MAGE/RAID الإنجليزية ٩ من ٥٥٥ عند احتساب الإشارات المحجوبة.',det['groups']))
checks.append(check('Paraphrase, mixed text and independent assessment','إعادة الصياغة والنص المختلط والتقييم المستقل','partial','High-similarity retrieval: 21/41 English, 6/41 Arabic. Confidence and fairness remain conditional on source and genre.','استرجعت المنصة ٢١ من ٤١ زوجًا إنجليزيًا عالي التشابه، و٦ من ٤١ زوجًا عربيًا. تبقى الدقة والإنصاف في نصوص الجامعة غير مثبتين.',{'similarity':read('research/similarity/training/external-evaluation.json'),'mixed':read('research/detector/active-group-metrics.json')['mixtures'],'aiRecall':det['ai_recall']}))
checks+=f['checks'][:3]+f['checks'][3:5]+f['checks'][-1:]+g['checks']
checks.append(check('Institutional LTI 1.3 launch','الإطلاق من نظام تعلم الجامعة','unverified','Protocol tests passed locally. No university LMS is registered.','اجتاز البروتوكول اختباراته المحلية. يتطلب القبول النهائي إطلاق المنصة فعليًا من نظام الجامعة.',read('research/lti/evidence.json')))
checks.append(check('Mobile and desktop browser controls','ضوابط واجهة الهاتف والحاسوب','partial','Eight rendered browser checks passed on the local copy at widths 390 and 1240 px. Live HTTPS functions were verified separately. No physical-device committee or uptime certification.', 'اجتازت النسخة المحلية ثمانية اختبارات متصفح بعرض ٣٩٠ و١٢٤٠ بكسل. اختُبرت وظائف الرابط العام بصورة مستقلة. لم يُختبر هاتف حقيقي للجنة أو استمرارية الخدمة طوال موعدها.',read('evidence/local-browser.json')))
o={'id':'zz-assessment-3','title':'Assessment build 3 · verified release record','titleAr':'إصدار التقييم الثالث · نتائج التحقق','testedAt':f['at'],'model':det['version'],'releaseCommit':'408674ec2ca3cd2193704e8ba308daf4d5f27797','checks':checks}
Path('evidence/acceptance-release-3.json').write_text(json.dumps(o,ensure_ascii=False,indent=2))
