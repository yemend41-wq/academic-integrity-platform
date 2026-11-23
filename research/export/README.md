# Bilingual audit PDF

Import `createAuditPdf` from `./audit.mjs`. The synchronous function takes an ID, the analysis timestamp, locale and ordered sections. Each section has a localized title and rows with a label and a string value. Return its Uint8Array as an attachment with the PDF MIME type. The calling route checks ownership and passes the same privacy-filtered values the reviewer sees in the studio. An absent or withheld result should carry the explanation used by the studio.

The generated A4 PDF embeds a subset of DejaVu Sans, a Unicode map and logical ActualText. The formatter applies Unicode bidi ordering, basic Arabic contextual letter forms, lam–alef ligatures, diacritic anchors, and explicit direction for embedded ASCII identifiers. Long URLs break over multiple lines and continuation pages carry a folio. No browser print dialog, internet request or hosted font is involved. The typeface covers Arabic and Latin. Unsupported scripts draw replacement glyphs. Search and copy order for mixed-script text depends on the PDF viewer; JSON is the lossless machine-readable export.

The `vendor` directory contains the DejaVu license, the MIT license for bidi-js 1.0.3 and the vendored npm distribution. `tools/build_font.py` regenerates the font data from Debian's DejaVu Sans and Unicode data using Python FontTools. Runtime code uses JavaScript and Web Platform globals.

## Reproduce PDF checks

Run from the repository root.

```sh
node research/export/tests/export-fixtures.mjs /tmp/mizan-export-qa
python research/export/tests/verify.py /tmp/mizan-export-qa
```

The second command uses pypdf, PyMuPDF and Poppler. The local tests inspect an actual bundled file, generate both language editions, reopen the PDF objects, verify the embedded Arabic and Latin text, render every page, check drawing bounds, and confirm page numbers and the last field. The checked run is in `tests/evidence.json`. The tests do not exercise the deployed HTTP route.
