// An optional, conservative writing-analysis view for tagged horizontal Arabic PDFs.
// Returned offsets always address the returned string. No value means use legacyText.
const arabic = /\p{Script=Arabic}/u;
const present = s => s.replace(/[\uFB50-\uFDFF\uFE70-\uFEFC]+/gu, x => x.normalize('NFKC')).normalize('NFC');
const bases = s => [...present(s)].filter(c => arabic.test(c) && /\p{L}/u.test(c)).join('');
const unchanged = reason => ({writingText: null, method: 'original', reason, verifiedSpans: 0});

// Never omit a text-bearing tag, reorder an untagged region, or use a figure's alternative description as student writing.
function paragraphOrder(tree) {
  const groups = [], seen = new Set(); let valid = true, visited = 0;
  function visit(node, paragraph, depth = 0) {
    if (!node || !valid) return;
    if (depth > 64 || ++visited > 30000) { valid=false; return; }
    if (node.type === 'content') {
      if (!paragraph || !node.id || seen.has(node.id)) { valid = false; return; }
      paragraph.push(node.id); seen.add(node.id); return;
    }
    if (node.role === 'P' || /^H[1-6]?$/.test(node.role)) {
      if (paragraph) { valid = false; return; }
      paragraph = []; groups.push(paragraph);
    }
    for (const child of node.children || []) visit(child, paragraph, depth+1);
  }
  visit(tree, null);
  return valid && seen.size ? groups.filter(g => g.length) : null;
}

function markedItems(items, order) {
  const byId = new Map(order.flat().map(id => [id, {id, items: [], children: [], raw: [], used: 0}]));
  const stack = []; let active = null, inline = null, candidates = 0;
  for (const item of items) {
    if ('str' in item) {
      if (!active && item.str.trim()) return null;
      if (active && item.str.trim()) active.items.push(item);
      if (inline) inline.text += item.str;
      continue;
    }
    if (item.type === 'endMarkedContent') {
      if (inline && inline.tag === 'Span' && bases(inline.text).length === 1 && /[A-Za-z0-9+]|\p{M}/u.test(inline.text)) candidates++;
      const parent=stack.pop(); if (!parent) return null;
      active=parent.active; inline=parent.inline; continue;
    }
    stack.push({active,inline});
    if (item.id) {
      if (active || !byId.has(item.id)) return null;
      active = byId.get(item.id);
    } else if (active) {
      if (inline) return null;
      inline = {tag:item.tag,text:''}; active.children.push(inline);
    }
  }
  return candidates && [...byId.values()].every(g => g.items.length) ? byId : null;
}

// An isolated inline glyph cluster can carry an overprinted diacritic whose PDF
// translation is a zero-advance ASCII sign. Keep the visible Arabic base. A raw
// glyph reused with several marks does not identify which vowel was painted.
// No /ActualText or other alternative label is read. Explicit Unicode mark glyphs survive.
function sourceCluster(glyphs) {
  if (!glyphs.length || glyphs.length > 4) return null;
  const base = glyphs.filter(g => g.width > 0);
  if (base.length !== 1) return null;
  const mapped = present(base[0].unicode);
  if (!/^\p{L}\p{M}{0,3}$/u.test(mapped) || !arabic.test(mapped)) return null;
  const overprint = glyphs.filter(g => g !== base[0]);
  if (!overprint.length && !/\p{M}/u.test(mapped)) return null;
  if (!overprint.every(g=>g.width===0 && (/^[!-~]$/u.test(g.unicode) || /^\p{M}{1,3}$/u.test(g.unicode)))) return null;
  return bases(mapped) + overprint.map(g=>/^\p{M}+$/u.test(g.unicode)?g.unicode:'').join('');
}

function readGlyphs(list, ops, byId) {
  const numbered = new Map(), stack = []; let group = null, target = null, verified = 0;
  for (const g of byId.values()) {
    const match = /_mc(\d+)$/.exec(g.id);
    if (!match || numbered.has(+match[1])) return null;
    numbered.set(+match[1], g);
  }
  for (let at = 0; at < list.fnArray.length; at++) {
    const type = list.fnArray[at], args = list.argsArray[at];
    if (type === ops.setTextRenderingMode && args[0] > 2) return null;
    if (type === ops.beginMarkedContent || type === ops.beginMarkedContentProps) {
      stack.push({group, target});
      if (Number.isInteger(args[1])) {
        group = numbered.get(args[1]);
        if (!group || target) return null;
        target = group.raw;
      } else if (group) {
        const child = group.children[group.used++];
        if (!child || child.tag !== args[0] || target !== group.raw) return null;
        target = []; stack.at(-1).child = child;
      }
    } else if (type === ops.endMarkedContent) {
      const parent = stack.pop(); if (!parent) return null;
      if (parent.child) {
        const cluster = parent.child.tag === 'Span' ? sourceCluster(target) : null;
        if (cluster) { parent.target.push({unicode: cluster}); verified++; }
        else for (const glyph of target) parent.target.push(glyph);
      }
      group = parent.group; target = parent.target;
    } else if (type === ops.showText && target) {
      for (const g of args[0]) if (g && typeof g === 'object' && typeof g.unicode === 'string') target.push(g);
    }
  }
  return verified && !stack.length && [...byId.values()].every(g => g.used === g.children.length && g.raw.length) ? verified : null;
}

function coverage(candidate, items) {
  const grams = new Set(), normalized = bases(candidate);
  for (let i=0; i+3<=normalized.length; i++) grams.add(normalized.slice(i,i+3));
  let hits = 0;
  for (const item of items) {
    const value = bases(item.str);
    for (let i=0; i+3<=value.length; i++) if (grams.has(value.slice(i,i+3))) hits++;
  }
  return hits;
}

function logicalRun(group) {
  const glyphs = group.raw.map(g => present(g.unicode));
  const forward = glyphs.join(''), items = group.items;
  if (items.some(i => Math.abs(i.transform[1])+Math.abs(i.transform[2]) > 0.01 || i.dir === 'ttb')) return null;
  const regular = items.filter(i => i.width > 0.1 && i.height > 0.5);
  if (!regular.length) return null;
  const ys=regular.map(i=>i.transform[5]), h=Math.min(...regular.map(i=>i.height));
  if (Math.max(...ys)-Math.min(...ys) > Math.max(2,h*.45)) return null;
  const geometry = {left: Math.min(...regular.map(i=>i.transform[4])), right: Math.max(...regular.map(i=>i.transform[4]+i.width)), y:ys[0], h};
  if (!bases(forward)) {
    const fromItems = items.map(i=>present(i.str)).join('').replace(/\s/gu,'');
    if (forward.replace(/\s/gu,'') !== fromItems) return null;
    return {text:forward, ...geometry};
  }
  if ([...forward].some(c => /\p{N}/u.test(c) || (/\p{L}/u.test(c) && !arabic.test(c)))) return null;
  // Reverse encoded glyph clusters, not code points. A ligature such as lam-alef or a
  // vowel attached to a base must stay intact. Require independent PDF.js line evidence.
  const reverse = glyphs.reverse().join('');
  if (reverse === forward) return {text:forward,...geometry};
  const a=coverage(forward,items), b=coverage(reverse,items);
  if (a === b || Math.max(a,b) < 2) return null;
  return {text:b>a?reverse:forward, ...geometry};
}

function joinRuns(runs) {
  let value='', previous=null;
  for (const run of runs) {
    if (previous && !/\s$/u.test(value) && !/^\s/u.test(run.text)) {
      const h=Math.min(previous.h,run.h), gap=Math.max(previous.left,run.left)-Math.min(previous.right,run.right);
      if (gap > Math.max(1,h*.18) || (Math.abs(previous.y-run.y) > Math.max(2,h*.45) && !/[-\u00ad]$/u.test(value))) value+=' ';
    }
    value+=run.text; previous=run;
  }
  return value.replace(/[\t\r\n ]+/gu,' ').trim();
}

export async function writingPdfPage(page, ops, legacyText) {
  if (!legacyText.trim()) return unchanged('no_text');
  if (!arabic.test(legacyText) || legacyText.length > 32000) return unchanged('outside_scope');
  const order = paragraphOrder(await page.getStructTree());
  if (!order) return unchanged('no_complete_paragraph_tags');
  const tagged = await page.getTextContent({includeMarkedContent:true});
  if (tagged.items.length > 20000) return unchanged('page_bound');
  const byId = markedItems(tagged.items, order);
  if (!byId) return unchanged('no_supported_marked_text');
  const list=await page.getOperatorList();
  if (list.fnArray.length > 60000) return unchanged('page_bound');
  const verified = readGlyphs(list, ops, byId);
  if (!verified) return unchanged('unverified_glyphs');
  const paragraphs=[];
  for (const ids of order) {
    const runs = ids.map(id=>logicalRun(byId.get(id)));
    if (runs.some(r=>!r)) return unchanged('uncertain_reading_order');
    paragraphs.push(joinRuns(runs));
  }
  const text=paragraphs.join('\n\n');
  return {writingText:text === legacyText?null:text,method:'pdf_tagged_arabic_base_glyphs',verifiedSpans:verified,paragraphCount:paragraphs.length};
}
