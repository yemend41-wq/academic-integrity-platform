// Human-readable vocabulary for file-evidence keys and statuses. Keep API keys
// stable in JSON exports, and translate only at the presentation boundary.
const arabic={
  matchedISBN:'الرقم الدولي المطابق',titleAmbiguous:'تختلف العناوين في السجلات المطابقة',matched_publisher_snapshot:'مطابق لبيانات الناشر المفهرسة؛ تعذّر تأكيد السجل الحي',invalid_identifier:'صيغة المعرّف غير صالحة',publisherSource:'المصدر لدى الناشر',publisherCheckedOn:'تاريخ فحص بيانات الناشر',registryStatus:'حالة الفحص الحي',attempts:'محاولات الاستعلام',registry:'السجل',outcome:'نتيجة الاتصال',httpStatus:'رمز استجابة HTTP',deadline:'انتهت المهلة العامة',timeout:'انتهت مهلة الاتصال',network_error:'تعذّر إنشاء الاتصال',http_error:'استجابة خطأ من الخدمة أو البوابة',non_json_response:'لم يُرجع المسار بيانات JSON',body_limit:'تجاوزت الاستجابة حد القراءة',empty_response:'استجابة فارغة',response:'استجابة بيانات',
  format:'الصيغة',status:'الحالة',signature:'توقيع الادعاء',scope:'نطاق الفحص',assetBinding:'ارتباط التوقيع بمحتوى الملف',assertionHashes:'بصمات الإثباتات',trust:'الثقة في جهة التوقيع',
  manifestCount:'عدد سجلات المنشأ',assertions:'الإثباتات',byteLength:'حجم الملف بالبايت',revision:'رقم المراجعة',created:'تاريخ الإنشاء',modified:'آخر تعديل',
  core:'خصائص المستند الأساسية',app:'خصائص تطبيق التحرير',editingMinutes:'وقت التحرير المسجّل بالدقائق',embeddedMediaCount:'عدد الوسائط المضمنة',embeddedMediaScanned:'الوسائط المفحوصة',embeddedMedia:'الوسائط المضمنة',
  width:'العرض بالبكسل',height:'الارتفاع بالبكسل',chunks:'كتل PNG',headerSegments:'مقاطع ترويسة JPEG',paragraphCount:'عدد الفقرات',trackedInsertions:'الإضافات المتتبعة',
  trackedDeletions:'المحذوفات المتتبعة',hiddenTextRuns:'مقاطع النص المخفي',whiteTextRuns:'مقاطع النص الأبيض',rsidDiversity:'عدد معرّفات جلسات التحرير المتميزة',paraIdDiversity:'عدد معرّفات الفقرات المتميزة',
  pageSizes:'مقاسات الصفحات',widthMm:'العرض بالملليمتر',heightMm:'الارتفاع بالملليمتر',widthPt:'العرض بالنقطة',heightPt:'الارتفاع بالنقطة',fonts:'الخطوط',hexColors:'رموز الألوان',
  zeroWidthCharacters:'محارف عديمة العرض',bidiControls:'محارف التحكم في اتجاه النص',mixedLatinCyrillicWords:'كلمات تمزج الحروف اللاتينية والسيريلية',usSpellingTokens:'كلمات بإملاء أمريكي',ukSpellingTokens:'كلمات بإملاء بريطاني',
  TotalTime:'زمن التحرير المسجّل بالدقائق',Application:'برنامج التحرير',AppVersion:'إصدار البرنامج',Pages:'عدد الصفحات المسجّل',Words:'عدد الكلمات المسجّل',Characters:'عدد المحارف المسجّل',Paragraphs:'عدد الفقرات المسجّل',
  pageCount:'عدد الصفحات',fontFamilies:'عائلات الخطوط',visibleBaseFontNames:'أسماء الخطوط المضمّنة الظاهرة',generatorFamily:'برنامج إنشاء الملف',version:'الإصدار',creationDate:'تاريخ الإنشاء',modificationDate:'آخر تعديل',
  hasAcroForm:'يحتوي على نموذج PDF',attachmentCount:'المرفقات',xrefMarkers:'علامات جدول الإحالة',endOfFileMarkers:'علامات نهاية الملف',embeddedFileStreams:'علامات الملفات المضمنة',imageObjectMarkers:'علامات عناصر الصور',
  not_evaluated:'لم تُفحص سلسلة الثقة',not_checked:'لم يُفحص',manifest_read:'قُرئ سجل المنشأ',no_embedded_manifest_found:'لم يُعثر على سجل منشأ مضمن',no_document_level_manifest_found:'لم يُعثر على سجل منشأ على مستوى المستند',
  verified_with_embedded_leaf:'نجح التحقق بالمفتاح العام للشهادة المضمنة',invalid:'غير سليم',unsupported:'غير مدعوم',unsupported_algorithm:'خوارزمية غير مدعومة',unsupported_or_unreadable:'تعذّرت القراءة أو لا تدعم الأداة الترميز',
  container_unreadable:'تعذّرت قراءة حاوية بيانات المنشأ',non_c2pa_container:'حاوية من نوع آخر',no_leaf_certificate:'لا تتوافر شهادة الموقّع',invalid_ranges:'نطاقات البصمة غير صالحة',
  unverified_exclusion_scope:'لم يُتحقق من نطاقات الاستبعاد',reference_unresolved:'تعذّر تحديد الإثبات المشار إليه',match:'تطابق',mismatch:'عدم تطابق',
  registry_unavailable:'تعذّر الاتصال بالسجل',verified:'عُثر على المعرّف في السجل',invalid_checksum:'رقم التحقق غير صحيح',not_found:'لا يحتوي سجل المعرّفات على هذا المعرّف',
  not_found_in_queried_registries:'لم يُعثر عليه في السجلات المفحوصة',lookup_budget_exceeded:'لم يُفحص ضمن مهلة هذه العملية',unreadable_media:'تعذّرت قراءة الوسيط',
  before_first_scan:'المقاطع السابقة لبيانات الصورة','OOXML package; see embedded media separately':'حزمة المستند، وتظهر نتائج الصور المضمنة في بند الوسائط','catalog AF and named content credential attachments':'الملفات المرتبطة في فهرس المستند ومرفقات بيانات المنشأ المسماة',
  scope_unknown:'النطاق غير محدد',not_applicable:'لا ينطبق',true:'نعم',false:'لا'
};
const english={
  matchedISBN:'Matching ISBN-13',titleAmbiguous:'Catalog records list different titles',matched_publisher_snapshot:'Matches indexed publisher metadata; live registry unconfirmed',invalid_identifier:'Invalid identifier syntax',
  assetBinding:'Asset byte binding',assertionHashes:'Assertion digests',trust:'Signer trust',rsidDiversity:'Distinct editing-session IDs',paraIdDiversity:'Distinct paragraph IDs',
  manifest_read:'Manifest read',verified_with_embedded_leaf:'Signature verified against the embedded certificate',not_evaluated:'Not evaluated',invalid_checksum:'ISBN checksum failed',
  not_found_in_queried_registries:'No record in the registries checked',registry_unavailable:'Registry unavailable',no_embedded_manifest_found:'No embedded manifest found',
  no_document_level_manifest_found:'No document-level manifest found',ukSpellingTokens:'UK spelling indicators',usSpellingTokens:'US spelling indicators',
  visibleBaseFontNames:'Visible PDF base font names',lookup_budget_exceeded:'Not checked within this request’s limits'
};
export function fileTerm(value,isArabic=false){
  if(typeof value!=='string'&&typeof value!=='boolean')return value;
  const k=String(value);
  if(isArabic && Object.hasOwn(arabic,k))return arabic[k];
  if(Object.hasOwn(english,k))return english[k];
  if(Object.hasOwn(arabic,k))return k.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
  return k;
}
