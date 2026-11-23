"""Compare two real PDF exports across three independent readers and two renderers.

Usage: generate rtl-fixture.mjs into two folders, then pass BEFORE AFTER --out RESULT.
--examples may point to previously exported private PDFs; only aggregate counts are retained.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import unicodedata

import numpy as np
from PIL import Image
import pymupdf
import pypdf

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('before', type=Path)
parser.add_argument('after', type=Path)
parser.add_argument('--out', type=Path, required=True)
parser.add_argument('--examples', type=Path)
args = parser.parse_args()

UUID = '849e3a01-b619-4a34-9b86-c8e80c5509c2'
ISO = '2026-11-23T18:30:45.000Z'
MIXED = 'راجع المدرِّس الملف PDF يوم 23-11-2026 ثم كتب الملاحظات.'
URL = 'https://example.org/paper/2026-11-23?stage=2'


def normalized(s):
    # PDF readers introduce line breaks, directional controls and Unicode spaces.
    # Keep all letters, word boundaries, punctuation and combining marks.
    return ' '.join(unicodedata.normalize('NFC', ''.join(c for c in s if unicodedata.category(c) != 'Cf')).split())


def fields(text, lang):
    text = normalized(text)
    return {k: text.count(normalized(v)) == 1 for k, v in {
        'title': 'تقرير تدقيق النزاهة الأكاديمية' if lang == 'ar' else 'Academic integrity audit',
        'id': UUID, 'timestamp': ISO, 'model': 'AIP-HL-3', 'url': URL, 'mixedSentence': MIXED,
    }.items()}


def semantic_nodes(reader):
    struct = reader.trailer['/Root'].get('/StructTreeRoot')
    if not struct:
        return []
    return [node.get_object() for part in struct.get_object()['/K'] for node in part.get_object()['/K']]


def inspect(file, lang):
    reader = pypdf.PdfReader(file, strict=True)
    root = reader.trailer['/Root']
    nodes = semantic_nodes(reader)
    with pymupdf.open(file) as doc:
        page = doc[0]
        read = {
            'PyMuPDF': fields(page.get_text(), lang),
            'pypdf': fields(reader.pages[0].extract_text(), lang),
            'PopplerPdftotext': fields(subprocess.check_output(['pdftotext', str(file), '-']).decode(), lang),
        }
        geom = {}
        for k, token in {'numeric': '2345', 'model': 'AIP-HL-3', 'url': URL}.items():
            groups = page.search_for(token)
            assert groups, k
            box = groups[0]
            geom[k] = {'xMinPt': round(box.x0, 2), 'xMaxPt': round(box.x1, 2)}
        pix = page.get_pixmap(matrix=pymupdf.Matrix(1, 1), colorspace=pymupdf.csGRAY)
        assert len(set(pix.samples)) > 10
        contents = b''.join(p.get_contents().get_data() for p in reader.pages)
        matrices = re.findall(rb'([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) [-\d.]+ [-\d.]+ Tm', contents)
        assert matrices and all(a == b'1' and b == c == b'0' and d == b'1' for a, b, c, d in matrices)
        tagged_text = subprocess.check_output(['pdfinfo', '-struct-text', str(file)], stderr=subprocess.DEVNULL).decode() if nodes else ''
    lines = [str(n.get('/ActualText') or n.get('/Alt')) for n in nodes]
    return {
        'pdfSHA256': hashlib.sha256(file.read_bytes()).hexdigest(), 'pages': len(reader.pages),
        'catalogLanguage': root.get('/Lang'), 'pageLanguages': [p.get('/Lang') for p in reader.pages],
        'readingDirection': str(root.get('/ViewerPreferences', {}).get('/Direction', '')) or None,
        'structuredExactMixedSentence': MIXED in lines,
        'PopplerStructuredMixedSentence': normalized(MIXED) in normalized(tagged_text),
        'uprightTextMatrices': len(matrices), 'fontEmbedded': bool(reader.pages[0]['/Resources']['/Font']['/F']['/DescendantFonts'][0]
            .get_object()['/FontDescriptor']['/FontFile2'].get_data()), 'ordinaryExtraction': read, 'position': geom,
    }


def raster(directory):
    file = directory / 'ar.pdf'
    prefix = str(directory / 'rtl-check')
    subprocess.run(['pdftoppm', '-f', '1', '-l', '1', '-r', '144', '-gray', '-png', str(file), prefix], check=True)
    # The heading baseline, paper size and font do not change between these exports.
    return np.array(Image.open(prefix + '-1.png').convert('L').crop((370, 100, 1125, 154))) < 170


def anonymous_examples(directory):
    stats = dict(arabicAudits=0, englishAudits=0, copiedArabicTitlePyMuPDF=0,
                 copiedArabicTitlePypdf=0, copiedArabicTitlePoppler=0, documentedLanguage=0)
    digests = set()
    for file in directory.iterdir():
        if file.suffix.lower() != '.pdf':
            continue
        digest = hashlib.sha256(file.read_bytes()).digest()
        if digest in digests:
            continue
        digests.add(digest)
        r = pypdf.PdfReader(file)
        first = r.pages[0]
        fonts = first.get('/Resources', {}).get('/Font', {})
        if not any(f.get_object().get('/BaseFont') == '/MizanSans' for f in fonts.values()):
            continue
        stats['documentedLanguage'] += int(bool(r.trailer['/Root'].get('/Lang')))
        pp = first.extract_text()
        if 'Academic integrity audit' in pp:
            stats['englishAudits'] += 1
            continue
        stats['arabicAudits'] += 1
        title = 'تقرير تدقيق النزاهة الأكاديمية'
        stats['copiedArabicTitlePypdf'] += int(title in normalized(pp))
        with pymupdf.open(file) as d:
            stats['copiedArabicTitlePyMuPDF'] += int(title in normalized(d[0].get_text()))
        plain = subprocess.check_output(['pdftotext', '-f', '1', '-l', '1', str(file), '-']).decode()
        stats['copiedArabicTitlePoppler'] += int(title in normalized(plain))
    return stats


result = {'checkedUTC': datetime.now(timezone.utc).isoformat(), 'versions': {
    'PyMuPDF': pymupdf.__version__, 'pypdf': pypdf.__version__,
    'Poppler': subprocess.run(['pdftotext', '-v'], capture_output=True, text=True).stderr.splitlines()[0]},
    'scope': 'Deterministic bilingual audit fixture using real embedded glyphs, before and after. '
             'Normalization uses NFC and whitespace folding and discards bidi format controls. All scalar order checks precede any drawing comparison.',
    'implementationSHA256': hashlib.sha256((Path(__file__).resolve().parents[1] / 'audit.mjs').read_bytes()).hexdigest(),
    'before': {lang: inspect(args.before / (lang + '.pdf'), lang) for lang in ('ar', 'en')},
    'after': {lang: inspect(args.after / (lang + '.pdf'), lang) for lang in ('ar', 'en')},
}
if args.examples:
    result['suppliedBeforeFilesAggregate'] = anonymous_examples(args.examples)
base = raster(args.before)
updated = raster(args.after)
overlap = np.logical_and(base, updated).sum() / np.logical_or(base, updated).sum()
result['rasterHeadingInkOverlap'] = round(float(overlap), 4)
assert overlap > 0.8, overlap
for lang, entry in result['after'].items():
    assert entry['catalogLanguage'] == lang and entry['pageLanguages'] == [lang]
    assert entry['readingDirection'] == ('/R2L' if lang == 'ar' else '/L2R')
    assert entry['fontEmbedded'] and entry['structuredExactMixedSentence'] and entry['PopplerStructuredMixedSentence']
    for name, checks in entry['ordinaryExtraction'].items():
        assert all(v for k, v in checks.items() if k != 'mixedSentence')
        if name != 'PopplerPdftotext' or lang == 'ar':
            assert checks['mixedSentence']
    for box in entry['position'].values():
        assert abs((box['xMaxPt'] - 550.28) if lang == 'ar' else (box['xMinPt'] - 45)) < 0.2
result['limitation'] = ('Poppler plain-text geometry can reorder whole Arabic and Latin runs in an English-dominant page. '
                        'The tagged PDF reading order and the independent MuPDF and pypdf extractions retain the complete logical sentence. '
                        'Raw glyph-order extraction is not a logical-text mode.')
result['result'] = 'passed specified RTL, technical identifier, reading-order, raster and page-language checks'
with args.out.open('x', encoding='utf-8') as output:
    output.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print('Passed Arabic and English export checks. Heading ink overlap:', result['rasterHeadingInkOverlap'])
