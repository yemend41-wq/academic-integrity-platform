# Mizan · Academic Integrity Studio

Bilingual English–Arabic academic integrity workspace. An instructor can examine source-linked text matches, experimental writing signals, file and provenance details, citation lookups, draft revision history, and downloadable PDF/JSON audits. All evidence is for human review. Accuracy limitations are published in the site.

## Build and test

Use Node 24, Python 3 with pypdf, and npm. Run npm ci, npm run build and npm test. Local edge load checks use node scripts/edge-benchmark.mjs. Actual binary fixtures, provenance, reproducible data preparation and scores are under research/. The site's acceptance register distinguishes local measurements from HTTPS tests.

## Deployment and accounts

dist/server/index.js is the Worker entry point. Bind a D1 database as DB. Apply the SQL in drizzle/ before serving traffic. Provide ACCOUNT_VERIFIERS as a server-side secret, a JSON map from pre-provisioned username to the SHA-256 hex digest of a unique high-entropy random credential. Use evaluator for the instructor, candidate for a learner and registrar for the course administrator. Store plaintext credentials in a password manager. Never use human-chosen passwords for this bootstrap map. Additional users get random credentials and salted PBKDF2 hashes. Access and the comparison index are restricted by cohort; students may read only their own reports.

Raw upload bytes are held in request memory. Reports and draft history expire after seven days; schedule POST /api/retention/tick daily; verify /api/retention for the UTC epoch of the last completed purge. The trigger cannot change retention rules or access records. A D1 lease rate-limits cleanup. Configure LTI_PLATFORMS and LTI_SUBJECT_KEY only for an approved LMS registration. See research/lti/README.md.

The public reference collection and correctness limits are described in research/similarity/NOTICE.md. Detector measurement denominators, split protocol and failed release gates are preserved in research/detector/card.json. Distribution notices for third-party code and fonts are retained under research/. No learner submissions, session tokens or evaluator credentials belong in source control.

## Assessment release 4

The bilingual public register at `/acceptance` lists the scope of each measured result. The signed-in model and system page includes the underlying research and the archived hosted runs. The detector remains AIP-HL-3. The frozen HL-5 challenger failed its machine-recall gate. See `research/detector/release4-study.json` and the two release-4 runs in `research/similarity/training/`.

Run `npm test` for Worker integration and `npm run test:module-audit` for the real-file parsing, privacy and rendering checks. For end-to-end load, use `node scripts/release4-bench-local.mjs evidence/new-loopback.json release-4 AIP-HL-3` in a disposable local Worker or run `python scripts/release4-bench.py --help` for an authenticated hosted run. The public and loopback results have different acceptance scopes. The release-3 GitHub commit and hosted version 3 remain rollback references.

The isolated public load run is archived in `evidence/release4-authenticated-public-load.json`. A short-lived provisioner was restricted to fifty numbered students in its run. It has no access to the committee cohort or the evidence register. To close a run, replace BENCHMARK_ACCESS with the inactive object {"disabled":true}, deploy, and verify the former credential returns HTTP 401. REVIEW_PANEL_VERIFIER configures a separately scoped instructor login for the evaluation panel. Both settings accept verifiers only. Never commit actual account credentials. The nine protected HTTPS checks are in `evidence/release4-committee-functions.json`.

## Assessment release 5

The public bilingual register at `/acceptance` and its JSON download at `/acceptance.json` identify the environment for every result. In Model & system, an instructor can select real files and a locally held answer key, lock their hashes, run the live writing detector, then open the key. Private panel scoring has the same extraction and decision logic as ordinary reports. It does not add documents to the index or save a report. Counts distinguish numeric alerts, all alerts including masked scores, and abstentions.

Reviewers can switch between blue sentence highlights and contiguous passage highlights, see the full report identifier, and download either PDF language without switching the interface. `scripts/release5-register.py` builds the public record from individual observations. Two physical Android uploads and four bilingual PDF exports are documented. Opening JSON on physical Android and a platform-issued launch by the university still require direct observation. The maintained public routes are /acceptance, /model-card and /health, with ?lang=ar or ?lang=en.

The public 50-student fixed-passage and distinct-passage workloads returned 50/50 reports each, with p95 7.70 s and 8.88 s under their recorded index conditions. See evidence/release5-public-load.json. AIP-HL-3 remains experimental: 15 numeric and 34 total signals among 400 human Arabic texts in the independent M4 controls. No challenger qualified for deployment. Aggregated research is in evidence/release5-model-studies.json; the open-only local versus public parity suite and PDF regressions are recorded separately. Private submissions and private benchmark logs stay outside source control.

## AI detector release 6

The bilingual technical evaluation is available at `/detector-study?lang=ar` and `/detector-study?lang=en`. Download aggregate denominators and confidence intervals at `/detector-study.json`. R6 retains AIP-HL-3 as an experimental reviewer aid: fresh tests rejected the independently fitted character classifier, fixed ensemble and pretrained specialist alternatives. Percentages are selected-word shares. Individual authorship confidence is uncalibrated. Limited coverage, extraction failure and positive shares below 20% have distinct report states.

The extraction regression suite exercises original, purpose-created bilingual DOCX/PDF files, image-only and hybrid PDFs and Word textboxes/alternative content without changing the source-matching engine. The hosted functional runner uses only those fixtures and a committee credential supplied privately on stdin. Research model scripts and split/lock information are in the detector's `academic6` and `experiments6` directories.

Run `npm test` and `npm run test:module-audit` for local functional checks. For a temporary private evidence destination, set `MIZAN_INTEGRATION_EVIDENCE` and `MIZAN_MODULE_EVIDENCE` to local paths. Published records distinguish local and hosted measurements.
