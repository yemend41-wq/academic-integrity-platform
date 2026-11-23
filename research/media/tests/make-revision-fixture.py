"""Reproduce the release-four Word fixture from the checked-in bilingual Word file."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import sys
from lxml import etree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
SOURCE = Path(__file__).parent / 'fixtures' / 'bilingual-forensics.docx'


def node(parent, tag, **attrs):
    return ET.SubElement(parent, W + tag, {W + k: str(v) for k, v in attrs.items()})


def run(parent, text, style=None, visible=False, old_hidden=False):
    r = node(parent, 'r')
    rp = node(r, 'rPr')
    if style:
        node(rp, 'rStyle', val=style)
    if visible:
        node(rp, 'vanish', val='0')
        node(rp, 'color', val='000000')
    if old_hidden:
        old = node(node(rp, 'rPrChange', id=9, author='QA Reviewer'), 'rPr')
        node(old, 'vanish')
        node(old, 'color', val='FFFFFF')
    node(r, 't').text = text


def change(name, raw):
    if name not in ('word/document.xml', 'word/styles.xml'):
        return raw
    root = ET.fromstring(raw)
    if name == 'word/styles.xml':
        for kind, label, base, prop in [
            ('character', 'QAHidden', None, 'hide'),
            ('character', 'QAHiddenChild', 'QAHidden', None),
            ('character', 'QAWhite', None, 'white'),
            ('character', 'QAToggle', 'QAHidden', 'hide'),
            ('paragraph', 'QAParaHidden', None, 'hide'),
        ]:
            style = node(root, 'style', type=kind, styleId=label)
            node(style, 'name', val=label)
            if base:
                node(style, 'basedOn', val=base)
            if prop:
                props = node(style, 'rPr')
                if prop == 'hide':
                    node(props, 'vanish')
                else:
                    node(props, 'color', val='FFFFFF')
    else:
        body = root.find(W+'body')
        section = body.find(W+'sectPr')
        if section is not None:
            body.remove(section)
        p = node(body, 'p')
        run(p, 'INHERITED_HIDDEN', 'QAHiddenChild')
        run(p, 'INHERITED_WHITE', 'QAWhite')
        run(p, 'DIRECT_VISIBLE', 'QAHiddenChild', visible=True)
        run(p, 'TOGGLED_VISIBLE', 'QAToggle')
        run(p, 'PREVIOUS_FORMAT_VISIBLE', old_hidden=True)
        p = node(body, 'p')
        node(node(p, 'pPr'), 'pStyle', val='QAParaHidden')
        run(p, 'PARAGRAPH_HIDDEN')
        run(p, 'PARAGRAPH_OVERRIDE_VISIBLE', visible=True)
        p = node(body, 'p')
        run(node(p, 'moveFrom', id=1, author='QA Reviewer'), 'MOVE_OLD')
        run(node(p, 'moveTo', id=2, author='QA Reviewer'), 'MOVE_NEW')
        run(node(p, 'ins', id=3, author='QA Reviewer'), 'NEW_INSERTION')
        deleted = node(node(p, 'del', id=4, author='QA Reviewer'), 'r')
        node(deleted, 'delText').text = 'OLD_DELETION'
        run(node(body, 'p'), 'Contact release.fixture@example.test. Office +968 9123 4567.')
        if section is not None:
            body.append(section)
    return ET.tostring(root, encoding='UTF-8', xml_declaration=True)


if __name__ == '__main__':
    with ZipFile(SOURCE) as origin, ZipFile(sys.argv[1], 'w', ZIP_DEFLATED) as out:
        for name in origin.namelist():
            entry = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            out.writestr(entry, change(name, origin.read(name)))
