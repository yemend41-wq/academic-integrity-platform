import bidiFactory from './vendor/bidi.mjs';
import font from './vendor/font.mjs';

const bidi = bidiFactory();
const encoder = new TextEncoder();
const page = {width: 595.28, height: 841.89, margin: 45, content: 505.28};
const color = {ink: '0.075 0.12 0.17', accent: '0.015 0.35 0.36', soft: '0.34 0.40 0.44'};
const dictionary = {
  en: {title: 'Academic integrity audit', brand: 'MIZAN', id: 'Review ID', date: 'Analysis time', page: 'Page', warning: 'Signals support a human review. An authorship estimate alone cannot establish misconduct.'},
  ar: {title: 'تقرير تدقيق النزاهة الأكاديمية', brand: 'ميزان', id: 'معرّف المراجعة', date: 'وقت التحليل', page: 'صفحة', warning: 'تعين هذه المؤشرات المراجع على قراءة الأدلة. يتطلب إثبات المخالفة أدلة مستقلة عن تقدير مصدر النص.'}
};
const n = x => Number(x.toFixed(2));
const joinPrev = value => value === 'R' || value === 'D' || value === 'C';
const joinNext = value => value === 'L' || value === 'D' || value === 'C';
const utf16Hex = str => Array.from({length:str.length}, (_,i)=>str.charCodeAt(i).toString(16).padStart(4,'0')).join('');
const gidHex = id => id.toString(16).padStart(4,'0');

function unicodeClusters(text) {
  const clusters = [];
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0);
    if (/\p{M}/u.test(ch) && clusters.length) {
      clusters.at(-1).marks.push(cp);
    } else {
      clusters.push({cp, marks:[]});
    }
  }
  const shaped = [];
  for (let i = 0; i < clusters.length; i++) {
    const current = clusters[i];
    const before = font.joining[clusters[i - 1]?.cp];
    const after = font.joining[clusters[i + 1]?.cp];
    const here = font.joining[current.cp];
    const previousJoin = joinPrev(here) && joinNext(before);
    const nextJoin = joinNext(here) && joinPrev(after);
    let shape = current.cp;
    let marks = current.marks;
    if (shape === 0x644 && font.lam[clusters[i + 1]?.cp]) {
      const next = clusters[++i];
      shape = font.lam[next.cp][Number(previousJoin)];
      marks = [...marks, ...next.marks];
    } else if (font.forms[shape]) {
      shape = font.forms[shape][Number(previousJoin) + 2 * Number(nextJoin)];
    }
    shaped.push({cp:current.cp, shape, marks});
  }
  return shaped;
}

function shapeLine(text, px, direction) {
  const clusters = unicodeClusters(text);
  // Each representative occupies one UTF-16 unit. Unknown supplementary glyphs
  // retain their logical text in ActualText while the subset draws replacement.
  const representatives = clusters.map(c => String.fromCharCode(c.cp <= 65535 ? c.cp : 0xfffd)).join('');
  // Isolate machine-readable ASCII IDs so an Arabic paragraph cannot reorder
  // date components or punctuation in a DOI, URL or technical identifier.
  const position = [];
  const wrapped = [];
  let cursor = 0;
  const isolate = /[A-Za-z0-9]+(?:[/:.@+_%?=&-]+[A-Za-z0-9]+)*(?: +[A-Za-z0-9]+(?:[/:.@+_%?=&-]+[A-Za-z0-9]+)*)*/g;
  function append(i) { position.push(i); wrapped.push(representatives[i]); }
  for (const match of representatives.matchAll(isolate)) {
    while (cursor < match.index) append(cursor++);
    wrapped.push('\u2066'); position.push(-1);
    while (cursor < match.index + match[0].length) append(cursor++);
    wrapped.push('\u2069'); position.push(-1);
  }
  while (cursor < representatives.length) append(cursor++);
  const bidiText = wrapped.join('');
  const levels = bidi.getEmbeddingLevels(bidiText, direction);
  const order = bidi.getReorderedIndices(bidiText, levels);
  let advance = 0;
  const shapes = [];
  for (const visualIndex of order) {
    const i = position[visualIndex];
    if (i < 0) continue;
    const cluster = clusters[i];
    if (cluster.cp === 0x200c || cluster.cp === 0x200d) continue;
    const mirrored = levels.levels[visualIndex] % 2 && bidi.getMirroredCharacter(representatives[i]);
    const cp = mirrored ? mirrored.codePointAt(0) : cluster.shape;
    const gid = font.cmap[cp] ?? font.cmap[0xfffd];
    const w = font.widths[gid];
    shapes.push({gid, x:advance, y:0, text:String.fromCodePoint(cp).normalize('NFKC')});
    for (const mark of cluster.marks) {
      const mg = font.cmap[mark];
      if (mg == null) continue;
      const base = font.baseAnchors[gid];
      const anchor = font.markAnchors[mg];
      const dx = base && anchor ? base[0] - anchor[0] : w / 2;
      const dy = base && anchor ? base[1] - anchor[1] : 0;
      shapes.push({gid:mg, x:advance + dx, y:dy, text:String.fromCodePoint(mark)});
    }
    advance += w;
  }
  const scale = px / font.upm;
  return {shapes, width:advance*scale, scale, rtl:Boolean(levels.paragraphs[0]?.level % 2)};
}

function wrap(text, size, maxWidth) {
  const paragraphs = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const direction = bidi.getEmbeddingLevels(paragraph).paragraphs[0]?.level % 2 ? 'rtl' : 'ltr';
    const words = paragraph.trim().split(/\s+/u);
    let line = '';
    let used = 0;
    const space = shapeLine(' ', size).width;
    for (const word of words) {
      const width = shapeLine(word, size).width;
      if (line && used + space + width > maxWidth) {
        lines.push({line,direction});
        line = '';
        used = 0;
      }
      if (width <= maxWidth) {
        used += (line ? space : 0) + width;
        line += (line ? ' ' : '') + word;
        continue;
      }
      // URLs and identifiers can exceed a line without containing spaces.
      for (const ch of word) {
        const cw = shapeLine(ch, size).width;
        if (line && used + cw > maxWidth) {
          lines.push({line,direction});
          line = '';
          used = 0;
        }
        line += ch;
        used += cw;
      }
    }
    lines.push({line,direction});
  }
  return lines;
}

function concat(parts) {
  const chunks = parts.map(p => typeof p === 'string' ? encoder.encode(p) : p);
  const output = new Uint8Array(chunks.reduce((a,c)=>a+c.length,0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk,offset);
    offset += chunk.length;
  }
  return output;
}
function stream(bytes, dict='') {
  const buffer = typeof bytes === 'string' ? encoder.encode(bytes) : bytes;
  return concat(['<< /Length ', String(buffer.length), ' ', dict, ' >>\nstream\n', buffer, '\nendstream']);
}
function cmapStream(mapping) {
  const entries = [...mapping];
  const out = ['/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /MizanUnicode def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange'];
  for (let i=0; i<entries.length; i+=100) {
    const block = entries.slice(i,i+100);
    out.push(block.length + ' beginbfchar', ...block.map(([gid,t])=>'<'+gidHex(gid)+'> <'+utf16Hex(t)+'>'), 'endbfchar');
  }
  out.push('endcmap CMapName currentdict /CMap defineresource pop end end');
  return stream(out.join('\n'));
}

function serialize(pages, cmap) {
  const fontBytes = Uint8Array.from(atob(font.font), c => c.charCodeAt(0));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(9+i*2)+' 0 R').join(' ')+'] >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /MizanSans /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MizanSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /CIDToGIDMap /Identity /DW 600 /W [0 ['+font.widths.map(w=>Math.round(w*1000/font.upm)).join(' ')+']] >>',
    '<< /Type /FontDescriptor /FontName /MizanSans /Flags 32 /FontBBox [-1021 -463 1793 1232] /ItalicAngle 0 /Ascent 928 /Descent -236 /CapHeight 729 /StemV 85 /FontFile2 6 0 R >>',
    stream(fontBytes, '/Length1 '+font.rawLength+' /Filter /FlateDecode'),
    cmapStream(cmap),
    '<< /ProcSet [/PDF /Text] /Font << /F 3 0 R >> >>'
  ];
  for (let i=0; i<pages.length; i++) {
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+page.width+' '+page.height+'] /Resources 8 0 R /Contents '+(10+i*2)+' 0 R >>',
      stream(pages[i].join('\n')));
  }
  const parts = ['%PDF-1.7\n'];
  const offsets = [];
  let pos = parts[0].length;
  for (const [i,obj] of objects.entries()) {
    offsets.push(pos);
    const bytes = concat([(i+1)+' 0 obj\n',obj,'\nendobj\n']);
    parts.push(bytes);
    pos += bytes.length;
  }
  parts.push('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n',
    offsets.map(v=>String(v).padStart(10,'0')+' 00000 n \n').join(''),
    'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+pos+'\n%%EOF\n');
  return concat(parts);
}

export function createAuditPdf({id, createdAt, locale='en', sections=[]}) {
  const language = locale === 'ar' ? 'ar' : 'en';
  const d = dictionary[language];
  const pages = [];
  const cmap = new Map();
  let commands;
  let y;
  function draw(text, size, baseline, ink=color.ink, align, direction) {
    const line = shapeLine(text, size, direction);
    const x = align === 'right' || (align !== 'left' && line.rtl) ? page.width-page.margin-line.width : page.margin;
    commands.push('/Span << /ActualText <FEFF'+utf16Hex(text)+'> >> BDC','BT /F '+size+' Tf '+ink+' rg');
    // Font widths place consecutive base glyphs. Start a new positioned run
    // whenever an attached diacritic needs its font-specific anchor.
    let pending = '';
    let expectedX = NaN;
    let row = NaN;
    for (const glyph of line.shapes) {
      cmap.set(glyph.gid,glyph.text);
      if (glyph.x !== expectedX || glyph.y !== row) {
        if (pending) commands.push('<'+pending+'> Tj');
        pending = '';
        commands.push('1 0 0 1 '+n(x+glyph.x*line.scale)+' '+n(page.height-baseline+glyph.y*line.scale)+' Tm');
      }
      pending += gidHex(glyph.gid);
      expectedX = glyph.x + font.widths[glyph.gid];
      row = glyph.y;
    }
    if (pending) commands.push('<'+pending+'> Tj');
    commands.push('ET EMC');
  }
  function rule(baseline) {
    commands.push('0.81 0.85 0.86 RG 0.6 w '+page.margin+' '+n(page.height-baseline)+' m '+(page.width-page.margin)+' '+n(page.height-baseline)+' l S');
  }
  function newPage() {
    commands = [];
    pages.push(commands);
    draw(d.brand,12,35,color.accent, language==='ar'?'right':'left');
    rule(47);
    y=70;
  }
  function ensure(height) { if (y+height > page.height-58) newPage(); }
  function block(value,size,leading,ink=color.ink) {
    for (const {line,direction} of wrap(value,size,page.content)) {
      ensure(leading);
      draw(line,size,y,ink,undefined,direction);
      y+=leading;
    }
  }
  newPage();
  block(d.title,24,34,color.accent);
  block(d.id+' · '+String(id),10,15,color.soft);
  if (createdAt) block(d.date+' · '+String(createdAt),10,16,color.soft);
  y+=10;
  for (const section of sections) {
    ensure(75);
    rule(y);
    y+=22;
    block(section.title,14,22,color.accent);
    for (const {label,value} of section.rows ?? []) {
      ensure(37);
      if (label) block(label,9.5,15,color.soft);
      block(value,11,17);
      y+=5;
    }
    y+=6;
  }
  ensure(55);
  rule(y);
  y+=20;
  block(d.warning,10,16,color.soft);
  for (let i=0; i<pages.length; i++) {
    commands=pages[i];
    rule(page.height-42);
    draw(d.page+' '+(i+1)+(language==='ar'?' من ':' / ')+pages.length,9,page.height-25,color.soft,language==='ar'?'right':'left');
  }
  return serialize(pages,cmap);
}
