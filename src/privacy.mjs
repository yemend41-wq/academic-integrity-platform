// Redact before indexing, retention and export. Mask by UTF-16 length to retain offsets.
const identifierPatterns = [
  /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}/gu,
  /(?<![\p{L}\d])784[- ]?\d{4}[- ]?\d{7}[- ]?\d(?!\d)/gu,
  /(?<!\d)(?:\+|00)(?:971|968|966|965|974|973|967)(?:[ ()-]*\d){8,9}(?![0-9])/gu,
  /(?:Student\s*(?:ID|Number)|University\s*ID|الرقم\s*الجامعي|رقم\s*الطالب)\s*[:#\-]?\s*[A-Z\d٠-٩-]{4,22}/giu,
  /(?:^|\n)(?:Name|Student\s*Name|اسم الطالب(?:ة)?|الاسم)\s*[:：]\s*[^\n]{1,100}/giu,
  /(?:\+\d{1,3}[ -]?)?(?:\(\d{3}\)[ -]?\d{3}[ -]?\d{4}|\b05\d[ -]?\d{3}[ -]?\d{4}\b)/gu,
];
export function maskPII(text) {
  const original = String(text);
  const normalized = original.replace(/[٠-٩۰-۹]/g, digit =>
    String(digit.charCodeAt(0) % 16)
  );
  let masked = normalized;
  for (const pattern of identifierPatterns)
    masked = masked.replace(pattern, value => value.replace(/[^\s]/g, "█"));
  if (normalized === original) return masked;
  return original.replace(/[^\s]/g, (value, index) =>
    masked[index] === "█" ? "█" : value
  );
}
export function cleanEvidence(value, key = "") {
  if (
    /(creator|author|lastmodifiedby|manager|company|operator|person|email|filename|lastprinted|thumbnail|guid|subjectname)/i.test(
      key,
    )
  )
    return "[redacted]";
  if (Array.isArray(value))
    return value.slice(0, 1200).map((v) => cleanEvidence(v, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, cleanEvidence(v, k)]),
    );
  return typeof value === "string" ? maskPII(value) : value;
}
export function delta(before, after) {
  let start = 0,
    suffix = 0;
  while (
    start < Math.min(before.length, after.length) &&
    before[start] === after[start]
  )
    start++;
  while (
    suffix < Math.min(before.length, after.length) - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  return {
    start,
    remove: before.length - start - suffix,
    insert: after.slice(start, after.length - suffix),
  };
}
