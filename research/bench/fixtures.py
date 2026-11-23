"""Create actual office and PDF fixtures, then independently extract and validate their text."""
import datetime as dt
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'fixtures'
OUT.mkdir(exist_ok=True)
TEXT = (ROOT/'source'/'melville-excerpt.txt').read_text(encoding='utf-8').strip()
WORDS = TEXT.split()
assert len(WORDS) == len(re.findall('[A-Za-z]+', TEXT)) == 3000

def hash_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def doc_setup(title):
    doc = Document()
    style = doc.styles['Normal']
    style.font.name = 'Arial'
    style.font.size = Pt(11)
    section = doc.sections[0]
    section.top_margin = section.bottom_margin = Inches(0.78)
    section.right_margin = section.left_margin = Inches(0.8)
    props = doc.core_properties
    props.title, props.author, props.last_modified_by = title, 'Mizan benchmark fixture', 'Mizan benchmark fixture'
    props.revision = 3
    props.created = props.modified = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    return doc

def save_doc(doc, path):
    # DOCX is ZIP; normalize container timestamps for repeatable byte digests.
    with tempfile.TemporaryDirectory() as tmp:
        initial = Path(tmp)/'unpacked.docx'
        doc.save(initial)
        with zipfile.ZipFile(initial) as src, zipfile.ZipFile(path,'w') as dest:
            for name in sorted(src.namelist()):
                info = zipfile.ZipInfo(name, date_time=(2000,1,1,0,0,0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o600 << 16
                dest.writestr(info, src.read(name))

doc = doc_setup('Moby-Dick | 3,000-word measurement fixture')
for para in TEXT.split('\n\n'):
    doc.add_paragraph(para)
docx = OUT/'melville-3000.docx'
save_doc(doc, docx)
assert ' '.join(p.text for p in Document(docx).paragraphs).split() == WORDS

pdf = OUT/'melville-3000.pdf'
pdfdoc = SimpleDocTemplate(str(pdf), pagesize=A4, rightMargin=44,leftMargin=44, topMargin=44,bottomMargin=44,
                           title='Moby-Dick | 3,000-word measurement fixture',author='Mizan benchmark fixture',
                           invariant=1,pageCompression=1)
para_style=ParagraphStyle('Body',fontName='Times-Roman',fontSize=11,leading=15,splitLongWords=0,
                          spaceAfter=7,allowWidows=1,allowOrphans=1)
story=[Paragraph(escape(para),para_style) for para in TEXT.split('\n\n')]
pdfdoc.build(story)
pages=PdfReader(pdf).pages
assert ' '.join(p.extract_text() for p in pages).split() == WORDS
ar = doc_setup('محضر عربي لاختبار خصائص الملف')
# This short authored QA fixture exercises Arabic, bidirectional text, and supported detection signals.
# It is not a labeled human essay and is excluded from accuracy estimates.
paras = [
 'تسجيل تجربة فرز الأوراق',
 'جمع الفريق ثلاث عينات من صناديق الورق عند مدخل المكتبة، ثم وزن كل عينة قبل إزالة المواد المخالطة. كشف الفرز عن قطع صغيرة من البلاستيك في صندوقين، لذلك سجّل الفريق الوزن الصافي بعد التنقية.',
 'اختلف وزن الورق بين الصباح والمساء. اقترحت المجموعة إعادة القياس في يوم آخر قبل تفسير الفرق أو تعميم الملاحظة على بقية المباني.',
 'رقم الطالب: AA123456',
 'البريد التجريبي: pen@example.invalid',
 'مثال إملائي باللغة الإنجليزية: colour, color, centre, center.',
 'علامة اختبار للمحرف غير المرئي: تحل\u200bيل.',
]
for i, line in enumerate(paras):
    p=ar.add_paragraph()
    p._p.get_or_add_pPr().append(OxmlElement('w:bidi'))
    p.alignment=WD_ALIGN_PARAGRAPH.RIGHT
    p._p.set(qn('w:rsidR'), '4321ABCD' if i % 2 else '4321DCBA')
    p._p.set(qn('w14:paraId'), f'{i+1:08X}')
    p.add_run(line)
hidden=ar.add_paragraph().add_run('اختبار خاصية الإخفاء')
hidden.font.hidden=True
white=ar.add_paragraph().add_run('اختبار لون أبيض')
white.font.color.rgb=RGBColor.from_string('FFFFFF')
arpath=OUT/'arabic-format-signals.docx'
save_doc(ar,arpath)
with zipfile.ZipFile(arpath) as z:
    main=z.read('word/document.xml')
    assert all(b in main for b in (b'<w:vanish', b'w:val="FFFFFF"', b'w14:paraId', b'w:rsidR=', '\u200b'.encode()))
    assert 'تسجيل تجربة'.encode() in main

records=[
    {'file':docx.name,'format':'docx','words':3000,'parser':'python-docx','source':'Melville, Moby-Dick (1851), normalized historical English literary excerpt'},
    {'file':pdf.name,'format':'pdf','words':3000,'pages':len(pages),'parser':'pypdf','source':'same excerpt, independently extracted from PDF'},
    {'file':arpath.name,'format':'docx','script':'Arabic','source':'original functional QA text; excluded from authorship metrics',
     'signals':['Arabic and Latin text','directional paragraphs','2 explicitly assigned paragraph revision-session IDs; package defaults also present','7 paraIds','w:vanish','FFFFFF text','U+200B','US/UK spelling examples','labeled synthetic student ID','reserved example.invalid email']}
]
for r in records:
    p=OUT/r['file']
    r.update(bytes=p.stat().st_size,sha256=hash_file(p))
manifest={'version':1,'normalization':'ASCII compounds split at internal punctuation; count agrees with whitespace and ASCII letter spans; no visible title or footer','normalized_text_sha256':hash_file(ROOT/'source'/'melville-excerpt.txt'),'files':records}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps(records,ensure_ascii=False))
