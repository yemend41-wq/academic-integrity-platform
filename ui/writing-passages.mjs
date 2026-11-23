// Keep the detector's original UTF-16 offsets and never join across unscored writing.
export function writingPassages(text, segments) {
  const passages = [];
  let current;
  for (const segment of segments) {
    if (!segment.flagged) {current = null; continue;}
    const gap = current && text.slice(current.end, segment.start);
    if (current && current.lang === segment.lang && segment.start >= current.end &&
        !/[\p{L}\p{N}]/u.test(gap) && !/\n[^\S\n]*\n/u.test(gap)) {
      current.end = segment.end;
    } else {
      current = {start:segment.start, end:segment.end, lang:segment.lang};
      passages.push(current);
    }
  }
  return passages;
}
