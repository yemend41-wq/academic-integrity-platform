"""Inspect and render the real PDFs written by export-fixtures.mjs (no mocks)."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import pymupdf
from pypdf import PdfReader

out = Path(sys.argv[1])
info = json.loads((out/'runs.json').read_text())
results = []
for run in info['summaries']:
    lang = run['locale']
    path = out/(lang+'.pdf')
    reader = PdfReader(path, strict=True)
    assert len(reader.pages) > 1
    content = b'\n'.join(p.get_contents().get_data() for p in reader.pages)
    def actual(s):
        return (b'FEFF'+s.encode('utf-16-be').hex().encode()).lower() in content.lower()
    assert actual(info['sourceSHA256'])
    assert actual('PDF_EXPORT_END')
    title = 'Academic integrity audit' if lang=='en' else 'تقرير تدقيق النزاهة الأكاديمية'
    assert actual(title)
    assert actual('فحص المستند') if lang=='ar' else actual('File inspection')
    assert actual('اختبار تَشْكِيل وتداخل اللغات. Reference ID 2026-11-23-A يحتوي تاريخاً قابلاً للقراءة.')
    doc = pymupdf.open(path)
    font = reader.pages[0]['/Resources']['/Font']['/F']
    assert font['/ToUnicode'].get_data()
    assert font['/DescendantFonts'][0].get_object()['/FontDescriptor']['/FontFile2'].get_data()
    for index, page in enumerate(doc):
        assert abs(page.rect.width-595.28)<0.1 and abs(page.rect.height-841.89)<0.1
        assert len(page.get_text().strip())>20
        bitmap = page.get_pixmap(matrix=pymupdf.Matrix(1,1), colorspace=pymupdf.csGRAY)
        assert len(set(bitmap.samples)) > 10
        assert actual(('صفحة' if lang=='ar' else 'Page')+' '+str(index+1)+(' من ' if lang=='ar' else ' / ')+str(len(doc)))
        # Text must remain inside the paper. Both engines can extract text with
        # different bidi serialization; the logical ActualText was checked above.
        for w in page.get_text('words'):
            assert -2 <= w[0] <= w[2] <= page.rect.width + 2, (index,w)
            assert -2 <= w[1] <= w[3] <= page.rect.height + 2, (index,w)
    subprocess.run(['pdftoppm','-f','1','-l','1','-r','100','-png',str(path),str(out/lang)],check=True)
    results.append({**run,'pages':len(doc),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'checks':['strict PDF parse','A4 page bounds','render all pages','embedded TrueType and Unicode CMap','logical Arabic and English fields','final field and all page numbers']})
print(json.dumps({'environment':'Node.js + local Poppler, MuPDF and pypdf; source-inspection QA files','runAt':info['observedAt'],'sourceSHA256':info['sourceSHA256'],'status':'passed','runs':results},ensure_ascii=False,indent=2))
