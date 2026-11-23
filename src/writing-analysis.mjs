import {detect} from "../research/detector/detector.mjs";
import {tokenize} from "../research/detector/features.mjs";
import {version} from "../research/detector/weights.mjs";

const evidenceLimit = 120;

// Offsets are UTF-16 indices into the redacted detector input used in the report.
// A PDF line break can be typographic. Only a blank line starts a PDF text block.
function paragraphEvidence(text, words, segments, format) {
  const boundary = format === "docx" ? /\r?\n/g : /(?:\r?\n)[^\S\n]*(?:\r?\n)+/g;
  const rows = [];
  let from = 0, wi = 0, si = 0, total = 0;
  function add(end) {
    let count = 0, eligible = 0, selected = 0;
    const first = wi;
    while (wi < words.length && words[wi].start < end) {
      const word = words[wi++];
      while (si < segments.length && segments[si].end <= word.start) si++;
      const segment = segments[si];
      count++;
      if (segment && segment.start <= word.start && word.end <= segment.end) {
        eligible++;
        if (segment.flagged) selected++;
      }
    }
    if (count) {
      total++;
      if (rows.length < evidenceLimit) rows.push({number:total, start:words[first].start,
        end:words[wi-1].end, words:count, eligibleWords:eligible, selectedWords:selected});
    }
    from = end;
  }
  for (const match of text.matchAll(boundary)) add(match.index + match[0].length);
  if (from < text.length) add(text.length);
  return {unit:format === "pdf" ? "text_block" : "paragraph", total, rows};
}

export function analyzeWriting(text, format, forensics = {}) {
  const words = text.length > 100000 ? [] : tokenize(text);
  const details = {revision:1, confidence:"not_calibrated", lexicalWords:words.length,
    extraction: {format, pages:forensics.pageCount ?? null, pagesWithText:forensics.pagesWithLetters ?? null}};
  let reason;
  if (text.length > 100000) reason = "writing_view_limit";
  else if (!text.trim()) reason = "no_text_layer";
  else if ((text.match(/\uFFFD/g) || []).length >= Math.max(3, text.length * 0.02)) reason = "unreliable_decoding";
  if (reason) return {model:version,status:"unavailable",reason,display:null,
    eligibleWords:0,flaggedWords:null,segments:[],review:details};
  const result = detect(text, words);
  if (result.status === "insufficient") {
    result.reason = words.length < 48 ? "too_short" : "no_supported_window";
  } else if (result.eligibleWords * 2 < words.length) {
    return {model:version,status:"uncertain",reason:"limited_language_coverage",display:null,
      eligibleWords:result.eligibleWords,flaggedWords:null,segments:[],review:details};
  } else if (result.status === "analyzed") {
    details.paragraphs = paragraphEvidence(text, words, result.segments, format);
  }
  return {...result,review:details};
}
