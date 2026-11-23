// Aggregate the published decision. A suppressed percentage is an interval, not a point estimate.
const hash = /^[a-f0-9]{64}$/;
const conditions = new Set(["original", "non_native", "paraphrase", "back_translation"]);
const origins = new Set(["human", "generated", "mixed"]);

export const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
export const sha256 = async bytes => hex(await crypto.subtle.digest("SHA-256", bytes));

function confidence(hits, n) {
  if (!n) return null;
  const z = 1.95996398454, z2 = z * z, p = hits / n, factor = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const radius = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [Math.max(0,(center - radius) / factor), Math.min(1,(center + radius) / factor)];
}

function scoreInterval(result) {
  const {status, display} = result;
  if (status === "insufficient" && display === null) return null;
  if (status === "suppressed" && display === "*%") return [0, 20];
  if (status === "analyzed" && /^(?:0|[2-9][0-9]|100)%$/.test(display)) {
    const value = Number.parseInt(display, 10);
    return [value, value];
  }
  throw Error("bad_score");
}

function cohortDefinition(item) {
  if (!item || !hash.test(item.sha256) || !["ar","en"].includes(item.language) ||
      !origins.has(item.origin) || !conditions.has(item.condition)) throw Error("bad_labels");
  const share = item.generatedPercent;
  if (item.origin === "mixed" && !(Number.isFinite(share) && share > 0 && share < 100)) throw Error("bad_labels");
  if (item.origin !== "mixed" && share != null && share !== (item.origin === "human" ? 0 : 100)) throw Error("bad_labels");
  for (const field of ["authorGroup","sourceGroup"]) {
    if (item[field] != null && (typeof item[field] !== "string" || !item[field].trim() || item[field].length > 160))
      throw Error("bad_labels");
  }
  return [item.language, item.origin, item.condition, item.origin === "mixed" ? share : null];
}

export function aggregatePanel(key, scores) {
  if (key?.version !== 1 || !Array.isArray(key.cases) || !scores.size || key.cases.length !== scores.size)
    throw Error("different_files");
  const seen = new Set(), groups = new Map();
  for (const item of key.cases) {
    const definition = cohortDefinition(item);
    if (seen.has(item.sha256) || !scores.has(item.sha256)) throw Error("different_files");
    seen.add(item.sha256);
    const result = scores.get(item.sha256), interval = scoreInterval(result);
    const [language, origin, condition, generatedPercent] = definition;
    const id = JSON.stringify(definition);
    if (!groups.has(id)) groups.set(id, {
      language, origin, condition, generatedPercent, files:0, eligible:0, abstained:0, numericAlerts:0, allAlerts:0,
      suppressed:0, numeric:0, exactError:0, signedError:0, minError:0, maxError:0,
      authors:new Set(), sources:new Set(), authorUnknown:0, sourceUnknown:0,
    });
    const g = groups.get(id);
    g.files++;
    if (item.authorGroup) g.authors.add(item.authorGroup); else g.authorUnknown++;
    if (item.sourceGroup) g.sources.add(item.sourceGroup); else g.sourceUnknown++;
    if (!interval) {g.abstained++; continue;}
    g.eligible++;
    const [lo, hi] = interval;
    if (hi > 0) g.allAlerts++;
    if (lo === hi) {
      g.numeric++;
      if (lo > 0) g.numericAlerts++;
    } else g.suppressed++;
    if (origin === "mixed") {
      g.minError += Math.max(0, lo - generatedPercent, generatedPercent - hi);
      g.maxError += Math.max(Math.abs(lo - generatedPercent), Math.abs(hi - generatedPercent));
      if (lo === hi) {g.exactError += Math.abs(lo - generatedPercent); g.signedError += lo - generatedPercent;}
    }
  }
  const mean = (sum, n) => n ? sum / n : null;
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([,g]) => {
    const {exactError, signedError, minError, maxError, authors, sources, ...counts} = g;
    return {...counts, authorGroups:authors.size, sourceGroups:sources.size,
      numericAlertRate:mean(g.numericAlerts,g.eligible), numericWilson95:confidence(g.numericAlerts,g.eligible),
      allAlertRate:mean(g.allAlerts,g.eligible), allWilson95:confidence(g.allAlerts,g.eligible),
      ...(g.origin === "mixed" ? {maeNumericPP:mean(exactError,g.numeric), biasNumericPP:mean(signedError,g.numeric),
        eligibleMaeBoundsPP:g.eligible ? [minError/g.eligible,maxError/g.eligible] : null} : {})};
  });
}
