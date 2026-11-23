import {readVisibility, readXML, wordURI} from './xml.mjs';

const compatibility = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
// These branches can carry WordprocessingML runs, including DrawingML and VML textboxes.
const supported = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
  'http://schemas.microsoft.com/office/word/2010/wordml',
  'http://schemas.microsoft.com/office/word/2012/wordml',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
  'urn:schemas-microsoft-com:vml'
]);

// Preserve the original text verbatim for ordinary files. The optional second view
// is solely the offset basis for writing analysis, never for similarity/citations.
export function writingWordXML(bytes, visibility, legacyText) {
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
    : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  if (!/(?:<|:)(?:txbxContent|AlternateContent)(?=[\s/>])/u.test(new TextDecoder(encoding).decode(bytes))) {
    return {writingText: null, method: 'original'};
  }
  if (legacyText.length > 100000) return {writingText: null, method: 'original', reason: 'view_bound'};
  const blocks = [], paragraphs = [], runs = [], branches = new Map();
  let suppressed = null, activeBranches = 0, nestedParagraphs = 0, nodes = 0, overLimit = false;
  readXML(bytes, {
    namespaces: true,
    open(node, stack) {
      if (overLimit || ++nodes > 80000) { overLimit = true; return; }
      if (suppressed) return;
      const parent = stack.at(-2), {name, uri, a} = node;
      if (uri === compatibility) {
        if (name === 'AlternateContent') branches.set(node, {selected: false});
        const branch = branches.get(parent);
        if (branch && (name === 'Choice' || name === 'Fallback')) {
          const required = (a.Requires || '').trim().split(/\s+/u).filter(Boolean);
          const available = name === 'Fallback' || (required.length > 0 && required.every(prefix =>
            supported.has(node.namespaces?.[prefix])));
          if (branch.selected || !available) suppressed = node;
          else { branch.selected = true; activeBranches++; }
        }
        return;
      }
      if (!wordURI.test(uri)) return;
      if (['del', 'moveFrom', 'rPrChange', 'pPrChange'].includes(name)) { suppressed = node; return; }
      const paragraph = paragraphs.at(-1), run = runs.at(-1);
      if (name === 'p') {
        const p = {kind: 'paragraph', parts: []};
        if (paragraph) {
          (run?.paragraph === paragraph ? run : paragraph).parts.push(p);
          nestedParagraphs++;
        } else blocks.push(p);
        paragraphs.push(p);
      } else if (name === 'pStyle' && parent?.name === 'pPr' && paragraph) paragraph.style = a.val;
      else if (name === 'r' && paragraph) {
        const r = {kind: 'run', parts: [], paragraph};
        paragraph.parts.push(r); runs.push(r);
      } else if (run && parent?.name === 'rPr') {
        if (name === 'rStyle') run.style = a.val;
        readVisibility(node, run);
      } else if (run && run.paragraph === paragraph && ['br', 'cr', 'tab'].includes(name)) run.parts.push(name === 'tab' ? '\t' : '\n');
    },
    text(value, node) {
      if (!overLimit && !suppressed && node && wordURI.test(node.uri) && node.name === 't' && runs.length) {
        runs.at(-1).parts.push(value);
      }
    },
    close(node) {
      if (overLimit) return;
      if (suppressed) { if (node === suppressed) suppressed = null; return; }
      if (node.uri === compatibility) { branches.delete(node); return; }
      if (!wordURI.test(node.uri)) return;
      if (node.name === 'p') paragraphs.pop();
      if (node.name === 'r' && runs.length) runs.pop();
    }
  });
  if (overLimit) return {writingText: null, method: 'original', reason: 'view_bound'};
  function flatten(paragraph) {
    const lines = [], current = [];
    function part(item) {
      if (typeof item === 'string') { current.push(item); return; }
      if (item.kind === 'paragraph') {
        if (current.length) lines.push(current.splice(0).join(''));
        for (const line of flatten(item)) lines.push(line);
        return;
      }
      const inherited = visibility?.(paragraph.style, item.style) || {};
      if ((item.hidden ?? inherited.hidden) || (item.white ?? inherited.white)) return;
      for (const child of item.parts) part(child);
    }
    for (const item of paragraph.parts) part(item);
    if (current.length || !lines.length) lines.push(current.join(''));
    return lines;
  }
  const text = blocks.flatMap(flatten).join('\n');
  if (text.length > 100000) return {writingText: null, method: 'original', reason: 'view_bound'};
  return {writingText: text === legacyText ? null : text, method: 'word_visible_paragraphs', activeBranches, nestedParagraphs};
}
