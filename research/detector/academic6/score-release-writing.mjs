// Score bytes exclusively on this machine. Source entrypoint and raw detector are distinguished by their hashes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [privateFolder, checkout, evidenceOutput] = process.argv.slice(2);
const expectedModules = {
  "src/analysis.mjs":
    "122b7b96018e4bf4e812a2b4ef91af1007c84f7d0c900937c1f36bfc1533a702",
  "src/writing-analysis.mjs":
    "987ae97e94953ae2c36f5023ea96a0bb950f0cf8de10e9d72f3ecb7c7d8f0e21",
  "src/privacy.mjs":
    "7d2470236938787e0084c257ba8022fe85eec031e1cab031f31ff82759fa21f7",
  "research/detector/detector.mjs":
    "cb391d55f830689750af1299066e1270346db22d6a4054f165635cb3120d91ad",
  "research/detector/inference.mjs":
    "b0433bf6e86240e20071206f2fb06fa61578542246f81b88628b86a4970878be",
  "research/detector/features.mjs":
    "e54462c8828a2369e6a428a56a280e032ec4df64f13ac740aae61a6abb39d6f6",
  "research/detector/weights.mjs":
    "956864e902eff441336432abbdf2bc4a9cc18af6027eed01e63d630ed836adef",
};
const hex = (x) => createHash("sha256").update(x).digest("hex");
const root = path.resolve(checkout);
const absolute = (rel) => path.join(root, rel);
const load = (rel) => import(pathToFileURL(absolute(rel)));
const options = new Set([
  "analyzed",
  "suppressed",
  "unavailable",
  "uncertain",
  "insufficient",
]);
function jsonRows(file, expected) {
  const b = fs.readFileSync(file);
  if (expected) assert.equal(hex(b), expected);
  return b.toString("utf8").trimEnd().split("\n").map(JSON.parse);
}
for (const [rel, checksum] of Object.entries(expectedModules))
  assert.equal(hex(fs.readFileSync(absolute(rel))), checksum, rel);
const { blindWritingScore } = await load("src/analysis.mjs");
const { analyzeWriting } = await load("src/writing-analysis.mjs");
const { maskPII } = await load("src/privacy.mjs");
const { detect } = await load("research/detector/detector.mjs");
const { tokenize } = await load("research/detector/features.mjs");
const { models, version } = await load("research/detector/weights.mjs");
const source = fs.readFileSync(
  absolute("research/detector/inference.mjs"),
  "utf8"
);
const mask = "flaggedWords:suppressed?null:flaggedWords";
assert.equal(source.split(mask).length, 2);
const debugSource = source
  .replace(mask, "flaggedWords")
  .replace(
    "'./features.mjs'",
    JSON.stringify(
      pathToFileURL(absolute("research/detector/features.mjs")).href
    )
  );
const audit = (
  await import(
    "data:text/javascript;base64," + Buffer.from(debugSource).toString("base64")
  )
).createDetector(models, version);
function comparison(a, b) {
  return [
    a.model === b.model,
    a.status === b.status,
    a.display === b.display,
    a.eligibleWords === b.eligibleWords,
  ].every(Boolean);
}
function bump(obj, key) {
  obj[key] = (obj[key] ?? 0) + 1;
}
const legacyHashes = JSON.parse(
  fs.readFileSync(new URL("./replay.json", import.meta.url))
).byteIdentical;
const study = [];
for (const [folder, label, manifestName] of [
  [privateFolder, "main", "freeze.json"],
  [path.join(privateFolder, "long"), "long", "long-freeze.json"],
]) {
  const manifest = JSON.parse(
    fs.readFileSync(new URL(manifestName, import.meta.url))
  );
  const raw = jsonRows(
    path.join(folder, "all-input.jsonl"),
    manifest.inputFiles["all-input.jsonl"]
  );
  const truth = new Map(
    jsonRows(
      path.join(folder, "truth.jsonl"),
      manifest.inputFiles["truth.jsonl"]
    ).map((r) => [r.id, r])
  );
  const old = new Map(
    jsonRows(
      path.join(folder, "fixed-output.jsonl"),
      legacyHashes[label + "-fixed-decisions"]
    )
      .filter((r) => r.model === "AIP-HL-3")
      .map((r) => [r.id, r])
  );
  const receipt = {
    panel: label,
    files: raw.length,
    rawDetectorParity: 0,
    localAuthenticatedScoringFunctionParity: 0,
    submittedSHA256Matches: 0,
    releaseParagraphEvidenceChecked: 0,
    paragraphDetailLimitHits: 0,
    mixedDocumentsWithExtraSourceParagraphBreaks: 0,
    mixedVisibleParagraphBlockChecks: 0,
    changedDocuments: 0,
    changedByCohort: {},
    changedPublicTransitions: {},
    releaseStatusByCohort: {},
    allByCohort: {},
    releaseStatuses: {},
    releaseReasons: {},
    transformations: {},
  };
  const privateRows = [];
  for (const row of raw) {
    const t = truth.get(row.id),
      prev = old.get(row.id);
    assert.ok(t && prev);
    const bytes = fs.readFileSync(
      path.join(folder, "utf8-files", row.id + ".txt")
    );
    assert.deepEqual(bytes, Buffer.from(row.text, "utf8"));
    const fileValue = await blindWritingScore(bytes, "txt");
    assert.equal(fileValue.sha256, hex(bytes));
    receipt.submittedSHA256Matches++;
    const text = maskPII(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    );
    const words = tokenize(text);
    const observed = analyzeWriting(text, "txt", {
        encoding: "UTF-8",
        bytes: bytes.length,
      }),
      rawNow = detect(text);
    assert.ok(comparison(rawNow, { ...prev, eligibleWords: prev.eligible }));
    receipt.rawDetectorParity++;
    assert.ok(comparison(observed, fileValue));
    receipt.localAuthenticatedScoringFunctionParity++;
    assert.ok(options.has(observed.status));
    assert.equal(observed.review.lexicalWords, words.length);
    const measured = observed.display !== null;
    assert.equal(
      measured,
      observed.status === "analyzed" || observed.status === "suppressed"
    );
    if (observed.status === "uncertain") {
      assert.equal(observed.reason, "limited_language_coverage");
      assert.ok(2 * observed.eligibleWords < words.length);
    }
    if (!measured) assert.deepEqual(observed.segments, []);
    const cohort = [t.lang, t.cohort, t.origin].join("/");
    bump(receipt.allByCohort, cohort);
    receipt.releaseStatusByCohort[cohort] ??= {};
    bump(receipt.releaseStatusByCohort[cohort], observed.status);
    const change =
      observed.status !== prev.status ||
      observed.display !== prev.display ||
      observed.eligibleWords !== prev.eligible;
    if (change) {
      receipt.changedDocuments++;
      bump(receipt.changedByCohort, cohort);
      bump(
        receipt.changedPublicTransitions,
        [
          cohort,
          prev.status,
          prev.display ?? "null",
          observed.status,
          observed.display ?? "null",
          observed.reason ?? "none",
        ].join("/")
      );
    }
    bump(receipt.releaseStatuses, observed.status);
    if (observed.reason) bump(receipt.releaseReasons, observed.reason);
    bump(
      receipt.transformations,
      [prev.status, observed.status, observed.reason ?? "none"].join("/")
    );
    const result = {
      id: row.id,
      model: "AIP-HL-3/R6",
      reportedModel: observed.model,
      display: observed.display,
      status: observed.status,
      reason: observed.reason ?? null,
      eligible: observed.eligibleWords,
      words: words.length,
    };
    const paragraphs = observed.review.paragraphs;
    if (paragraphs) {
      assert.equal(paragraphs.unit, "paragraph");
      assert.ok(
        paragraphs.rows.length <= 120 &&
          paragraphs.rows.length <= paragraphs.total
      );
      if (paragraphs.total > 120) receipt.paragraphDetailLimitHits++;
      if (paragraphs.rows.length === paragraphs.total) {
        assert.equal(
          paragraphs.rows.reduce((n, p) => n + p.eligibleWords, 0),
          observed.eligibleWords
        );
        assert.equal(
          paragraphs.rows.reduce((n, p) => n + p.selectedWords, 0),
          observed.flaggedWords
        );
      }
      receipt.releaseParagraphEvidenceChecked++;
    }
    if (t.cohort === "mixed") {
      let flagged = observed.flaggedWords;
      if (observed.status === "suppressed") {
        const r = audit(text);
        assert.equal(r.display, observed.display);
        assert.equal(r.eligibleWords, observed.eligibleWords);
        assert.ok(r.flaggedWords > 0 && 5 * r.flaggedWords < r.eligibleWords);
        flagged = r.flaggedWords;
      }
      result.estimated = measured
        ? (100 * flagged) / observed.eligibleWords
        : null;
      result.span = { tp: 0, fp: 0, fn: 0, tn: 0 };
      if (manifest.expectedWords)
        result.paragraphSpan = { tp: 0, fp: 0, fn: 0, tn: 0 };
      const painted = observed.segments.filter((s) => s.flagged);
      if (paragraphs && paragraphs.total > t.paragraphs.length)
        receipt.mixedDocumentsWithExtraSourceParagraphBreaks++;
      for (const block of t.paragraphs) {
        const inside = words.filter(
          (w) => w.start >= block.start && w.end <= block.end
        );
        let shown = 0;
        for (const w of inside) {
          const positive = painted.some(
            (s) => w.start >= s.start && w.end <= s.end
          );
          shown += Number(positive);
          result.span[
            block.machine ? (positive ? "tp" : "fn") : positive ? "fp" : "tn"
          ]++;
        }
        if (paragraphs) {
          const within = paragraphs.rows.filter(
            (p) => p.start >= block.start && p.end <= block.end
          );
          assert.equal(
            within.reduce((n, p) => n + p.words, 0),
            inside.length
          );
          assert.equal(
            within.reduce((n, p) => n + p.selectedWords, 0),
            shown
          );
          receipt.mixedVisibleParagraphBlockChecks++;
        }
        if (result.paragraphSpan) {
          const positive = 2 * shown >= inside.length;
          result.paragraphSpan[
            block.machine ? (positive ? "tp" : "fn") : positive ? "fp" : "tn"
          ]++;
        }
      }
      assert.equal(
        result.span.tp + result.span.fn,
        (t.truthPercentage * words.length) / 100
      );
    }
    privateRows.push(result);
  }
  const output = privateRows.map((r) => JSON.stringify(r) + "\n").join("");
  fs.writeFileSync(path.join(folder, "release-writing-output.jsonl"), output, {
    mode: 0o600,
  });
  receipt.privateDecisionSHA256 = hex(output);
  study.push(receipt);
}
fs.writeFileSync(
  evidenceOutput,
  JSON.stringify(
    {
      dateUTC: new Date().toISOString(),
      testedSourceCommit: "3ca39cd8bd4ce8cc34715bfc1b05e6cc13a6169b",
      releaseAnalysisLabel: "AIP-HL-3/R6",
      apiModelVersion: version,
      sourceSHA256: expectedModules,
      scope:
        "Local product source review and byte-oriented blind scoring parity. Cohort and status counts only. HTTPS publication is verified separately by the release owner.",
      studies: study,
    },
    null,
    2
  ) + "\n"
);
console.log(
  study.map((r) => ({
    panel: r.panel,
    files: r.files,
    changed: r.changedDocuments,
    cohorts: r.changedByCohort,
    statuses: r.releaseStatuses,
    parity: r.localAuthenticatedScoringFunctionParity,
  }))
);
