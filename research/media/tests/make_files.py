"""Generate small, valid binary documents for parser regression tests only."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from io import BytesIO
from lxml import etree as E
from PIL import Image, PngImagePlugin, ImageDraw
import fitz
from docx import Document
from docx.shared import RGBColor

out = Path(__file__).parent / 'fixtures'
out.mkdir(exist_ok=True)
image = Image.new('RGB', (100, 75), (224, 237, 242))
ImageDraw.Draw(image).ellipse((15, 10, 60, 55), fill=(43, 104, 115))
png_info = PngImagePlugin.PngInfo()
png_info.add_text('Description', 'Geometric fixture, no camera provenance')
image.save(out / 'geometry.png', pnginfo=png_info)
image.save(out / 'geometry.jpg', format='JPEG')

doc = Document()
doc.core_properties.author = 'Example Reviewer'
doc.core_properties.last_modified_by = 'Example Reviewer'
doc.core_properties.revision = 4
p = doc.add_paragraph('Classroom observations use real words in two languages. ')
r = p.add_run('English colour and color. العربية لغة البحث.')
r.font.name = 'Liberation Sans'
r.font.color.rgb = RGBColor.from_string('27788A')
p = doc.add_paragraph()
p.add_run('Hidden for test').font.hidden = True
p.add_run('Paper-white text').font.color.rgb = RGBColor.from_string('FFFFFF')
doc.add_paragraph('Metadata fixture: inter\u200bnal, p\u0430per.')
doc.add_paragraph('References\n10.1038/nature12373\n10.99999/mizan-no-record-2026\nISBN 978-0-306-40615-7\nISBN 9780306406158')
doc.add_picture(str(out / 'geometry.png'))
w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
w14 = '{http://schemas.microsoft.com/office/word/2010/wordml}'
target = doc.paragraphs[2]._p
target.set(w+'rsidR', '00A01234')
target.set(w14+'paraId', '00001234')
doc.paragraphs[1]._p.set(w+'rsidR', '00A01235')
doc.paragraphs[1]._p.set(w14+'paraId', '00001235')
buf = BytesIO()
doc.save(buf)
with ZipFile(buf) as src, ZipFile(out/'bilingual-forensics.docx','w',ZIP_DEFLATED) as dest:
    for name in src.namelist():
        data = src.read(name)
        if name == 'docProps/app.xml':
            xml=E.fromstring(data)
            xml.find('{*}TotalTime').text='17'
            data=E.tostring(xml,encoding='utf-8',xml_declaration=True)
        dest.writestr(name,data)

pdf = fitz.open()
page = pdf.new_page(width=595.28, height=841.89)
page.insert_htmlbox(fitz.Rect(40,60,555,700),
    '<h1>Academic writing</h1><p>A library catalog lends structure to a source check.</p>'
    '<p dir="rtl">كتابة جامعية عربية تحتوي على كلمات بحثية.</p>'
    '<p>DOI 10.1038/nature12373</p>')
pdf.save(out/'bilingual-text.pdf',deflate=True)
