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
