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
    const index = i;
    let shape = current.cp;
    let alef;
    const marks = current.marks.map(cp => ({cp, index}));
    if (shape === 0x644 && font.lam[clusters[i + 1]?.cp]) {
      const next = clusters[++i];
      shape = font.lam[next.cp][Number(previousJoin)];
      alef = next.cp;
      marks.push(...next.marks.map(cp => ({cp, index:i})));
    } else if (font.forms[shape]) {
      shape = font.forms[shape][Number(previousJoin) + 2 * Number(nextJoin)];
    }
    shaped.push({cp:current.cp, shape, marks, index, alef});
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
    const {index} = cluster;
    if (cluster.alef) {
      // One visible outline represents two selectable Unicode characters. Its
      // right and left halves carry the lam and alef in logical reading order.
      const half = w / 2;
      shapes.push({index, gid, text:'ل', x:advance + half, width:half, dx:-half, dy:0});
      shapes.push({index:index + 1, gid:null, text:String.fromCodePoint(cluster.alef),
                   x:advance, width:half, dx:0, dy:0});
    } else {
      const glyph = {index, gid, text:String.fromCodePoint(cluster.cp), x:advance, width:w};
      if (mirrored || font.cmap[cp] == null) Object.assign(glyph, {dx:0, dy:0});
      shapes.push(glyph);
    }
    for (const mark of cluster.marks) {
      const mg = font.cmap[mark.cp];
      if (mg == null) continue;
      const base = font.baseAnchors[gid], anchor = font.markAnchors[mg];
      const dx = base && anchor ? base[0] - anchor[0] : w / 2;
      const dy = base && anchor ? base[1] - anchor[1] : 0;
      // Give the zero-advance scalar a distinct position next to its logical
      // base. The wrapper paints the original mark precisely at the font anchor.
      const relative = levels.levels[visualIndex] % 2 ? -font.upm / 400 : w;
      shapes.push({index:mark.index + 0.5, gid:mg, text:String.fromCodePoint(mark.cp),
                   x:advance + relative, width:0, dx:dx-relative, dy});
    }
    advance += w;
  }
  shapes.sort((a,b) => a.index - b.index);
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
function cmapStream(mapping, bytes=2) {
  const code = value => value.toString(16).padStart(bytes * 2, '0');
  const entries = [...mapping];
  const out = ['/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /MizanUnicode def /CMapType 2 def',
    '1 begincodespacerange <'+code(0)+'> <'+'FF'.repeat(bytes)+'> endcodespacerange'];
  for (let i=0; i<entries.length; i+=100) {
    const block = entries.slice(i,i+100);
    out.push(block.length + ' beginbfchar', ...block.map(([id,t])=>'<'+code(id)+'> <'+utf16Hex(t)+'>'), 'endbfchar');
  }
  out.push('endcmap CMapName currentdict /CMap defineresource pop end end');
  return stream(out.join('\n'));
}

const charsPerFont = 200;
function addClusterFonts(objects, characters) {
  const resources = ['/F 3 0 R'];
  for (let offset=0; offset<characters.length; offset+=charsPerFont) {
    const chunk = characters.slice(offset,offset+charsPerFont);
    const procs = [], names = [], map = new Map();
    for (const [i,glyph] of chunk.entries()) {
      const name = '/g'+(i+1);
      names.push(name);
      map.set(i+1,glyph.text);
      const outline = glyph.gid == null ? '' :
        ' BT /F '+font.upm+' Tf 1 0 0 1 '+n(glyph.dx)+' '+n(glyph.dy)+' Tm <'+gidHex(glyph.gid)+'> Tj ET';
      const id = objects.push(stream(n(glyph.width)+' 0 d0'+outline));
      procs.push(name+' '+id+' 0 R');
    }
    const unicode = objects.push(cmapStream(map,1));
    const scale = 1 / font.upm;
    const fontId = objects.push('<< /Type /Font /Subtype /Type3 /FontBBox [-2300 -1000 3650 3000] /FontMatrix ['+scale+' 0 0 '+scale+' 0 0] '+
      '/CharProcs << '+procs.join(' ')+' >> /Encoding << /Type /Encoding /Differences [1 '+names.join(' ')+'] >> /FirstChar 1 /LastChar '+chunk.length+
      ' /Widths ['+chunk.map(g=>n(g.width)).join(' ')+'] /ToUnicode '+unicode+' 0 R /Resources << /Font << /F 3 0 R >> >> >>');
    resources.push('/X'+(offset/charsPerFont)+' '+fontId+' 0 R');
  }
  return '<< /ProcSet [/PDF /Text] /Font << '+resources.join(' ')+' >> >>';
}

function addStructure(objects, lines, locale) {
  const root = objects.push(null);
  const parents = [], parts=[];
  for (const [i,blocks] of lines.entries()) {
    const pageId = 9+2*i, part = objects.push(null), children=[];
    for (const [mcid,block] of blocks.entries()) {
      const alternative = block.runReplacement ? '/Alt' : '/ActualText';
      const id = objects.push('<< /Type /StructElem /S /'+block.role+' /P '+part+' 0 R /Pg '+pageId+
        ' 0 R /K '+mcid+' '+alternative+' <FEFF'+utf16Hex(block.text)+'> >>');
      children.push(id+' 0 R');
    }
    const refs = '['+children.join(' ')+']';
    objects[part-1]='<< /Type /StructElem /S /Part /P '+root+' 0 R /Pg '+pageId+' 0 R /K '+refs+' >>';
    parts.push(part+' 0 R');
    parents.push(i+' '+refs);
  }
  const tree = objects.push('<< /Nums ['+parents.join(' ')+'] >>');
  objects[root-1]='<< /Type /StructTreeRoot /K ['+parts.join(' ')+'] /ParentTree '+tree+' 0 R /ParentTreeNextKey '+lines.length+' >>';
  objects[0]='<< /Type /Catalog /Pages 2 0 R /Lang ('+locale+') /MarkInfo << /Marked true >> /StructTreeRoot '+root+
    ' 0 R /ViewerPreferences << /Direction /'+(locale==='ar'?'R2L':'L2R')+' >> >>';
}

function serialize(pages, cmap, special, lines, locale) {
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
    objects.push('<< /Type /Page /Parent 2 0 R /Lang ('+locale+') /StructParents '+i+' /MediaBox [0 0 '+page.width+' '+page.height+'] /Resources 8 0 R /Contents '+(10+i*2)+' 0 R >>',
      stream(pages[i].join('\n')));
  }
  objects[7] = addClusterFonts(objects, special);
  addStructure(objects, lines, locale);
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
  const cmap = new Map(), special = [], aliases = new Map(), logicalPages=[];
  let commands, logicalLines, y;
  function encode(glyph) {
    const previous = cmap.get(glyph.gid);
    if (glyph.dx == null && (previous == null || previous === glyph.text)) {
      cmap.set(glyph.gid, glyph.text);
      return ['F', gidHex(glyph.gid)];
    }
    const dx = glyph.dx ?? 0, dy = glyph.dy ?? 0;
    const key = [glyph.gid,dx,dy,glyph.width,glyph.text].join('|');
    let id = aliases.get(key);
    if (id == null) {
      id = special.length;
      aliases.set(key,id);
      special.push({gid:glyph.gid, dx, dy, width:glyph.width, text:glyph.text});
    }
    return ['X'+Math.floor(id/charsPerFont), (id%charsPerFont+1).toString(16).padStart(2,'0')];
  }
  function draw(text, size, baseline, ink=color.ink, direction, role='P') {
    if (!text) return;
    const line = shapeLine(text, size, direction);
    // Every line shares the reading margin of the report. Each LTR technical
    // run keeps an upright font matrix and its intrinsic character order.
    const x = language === 'ar' || line.rtl ? page.width-page.margin-line.width : page.margin;
    const mcid = logicalLines.push({text,role})-1;
    commands.push('/'+role+' << /MCID '+mcid+' >> BDC');
    let letters='', runText='', face, origin, after;
    function flush(nextText='') {
      if (!letters) return;
      const technical = line.rtl && /[A-Za-z0-9]/.test(runText) &&
        /^[A-Za-z0-9:/._@+%?=& -]+$/.test(runText);
      // Poppler assigns spaces at bidi boundaries to the adjoining run. A
      // nonbreaking replacement retains an existing lexical boundary on copy.
      const boundary = technical && (runText.endsWith(' ') || nextText === ' ');
      if (boundary) {
        logicalLines[mcid].runReplacement = true;
        commands.push('/Span << /ActualText <FEFF'+utf16Hex(runText.trimEnd()+'\u00a0')+'> >> BDC');
      }
      commands.push('BT /'+face+' '+size+' Tf '+ink+' rg',
        '1 0 0 1 '+n(x+origin*line.scale)+' '+n(page.height-baseline)+' Tm','<'+letters+'> Tj ET');
      if (boundary) commands.push('EMC');
      letters=''; runText='';
    }
    for (const glyph of line.shapes) {
      const [key, value] = encode(glyph);
      if (!letters || after !== glyph.x || face !== key) {
        flush(glyph.text);
        origin = glyph.x; face = key;
      }
      letters += value; runText += glyph.text; after=glyph.x+glyph.width;
    }
    flush();
    commands.push('EMC');
  }
  function rule(baseline) {
    commands.push('0.81 0.85 0.86 RG 0.6 w '+page.margin+' '+n(page.height-baseline)+' m '+(page.width-page.margin)+' '+n(page.height-baseline)+' l S');
  }
  function newPage() {
    commands = [];
    pages.push(commands);
    logicalLines=[]; logicalPages.push(logicalLines);
    draw(d.brand,12,35,color.accent);
    rule(47);
    y=70;
  }
  function ensure(height) { if (y+height > page.height-58) newPage(); }
  function block(value,size,leading,ink=color.ink,role='P') {
    for (const {line,direction} of wrap(value,size,page.content)) {
      ensure(leading);
      draw(line,size,y,ink,direction,role);
      y+=leading;
    }
  }
  newPage();
  block(d.title,24,34,color.accent,'H1');
  block(d.id+' · '+String(id),10,15,color.soft);
  if (createdAt) block(d.date+' · '+String(createdAt),10,16,color.soft);
  y+=10;
  for (const section of sections) {
    ensure(75);
    rule(y);
    y+=22;
    block(section.title,14,22,color.accent,'H2');
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
    commands=pages[i]; logicalLines=logicalPages[i];
    rule(page.height-42);
    draw(d.page+' '+(i+1)+(language==='ar'?' من ':' / ')+pages.length,9,page.height-25,color.soft);
  }
  return serialize(pages,cmap,special,logicalPages,language);
}
