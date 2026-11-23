# File inspection and citation verification

The Worker calls `inspectFile(bytes,filename)` on the file's original bytes. Signature bytes determine the format; the extension must agree. Exports retain process metadata, aggregate text signals and selected provenance results. Authors, filenames, raw certificate subjects and other descriptive names are omitted. DOCX styling metadata and client-supplied editing time are review signals. Images and image-only PDFs can yield empty text. There is no OCR.

`verifyReferences(text)` queries Crossref, the DOI Handle System, and Open Library by identifier alone. An ISBN checksum failure can be established offline. Registry errors and deadlines remain distinct from known missing identifiers. A successful lookup establishes the identifier exists; it does not certify every bibliographic field or cited claim. Up to 48 distinct identifiers are listed, 16 live requests for identifiers can be initiated with four concurrent lookups and a six-second overall deadline. The per-isolate cache retains public records for six hours.

Word text extraction applies document defaults, inherited paragraph and character styles, and direct run formatting for hidden text and explicit white RGB. It counts tracked insertions/deletions and excludes deleted or moved-from runs and historical formatting from the active reading. Theme colors and background-dependent contrast require visual review.

## Provenance and scope

C2PA inspection reads JPEG APP11 segments and PNG caBX chunks, DOCX package credential and embedded images, and PDF document-level associated files. For supported active manifests the module decodes the claim, checks the COSE signature using its embedded leaf public key, validates local assertion hashes, and compares the source's bytes to the signed data-hash assertion when exclusions are confined to recognized manifest container ranges. Independent timestamp trust, revocation, certificate policy and external trust lists are outside this verifier. A verified embedded signature is not an institutional trust decision. Unsupported encodings and unverified bindings remain explicit. TIFF, MP4, external/remote manifests, and PDF page-level credentials are outside the current scope.

## Local regression checks

Run `node --test research/media/tests/media.test.mjs` from the project root. The binary Word, PDF and unsigned image fixtures in `tests/fixtures` were created by `tests/make_files.py`. These controlled files exercise file parsing and do not constitute a blind human-authorship dataset.

The signed JPEG is an unmodified official test asset from [contentauth/c2pa-rs](https://github.com/contentauth/c2pa-rs/blob/main/sdk/tests/fixtures/CA.jpg), Git blob `551e611e5a4434355d62ce6952d65162fc991dfc`, SHA-256 `e71bff58fc57640803e6e65f7534e2fb0c2f99018c85276cc14b30f04427cc76`. Its test certificate does not establish public signer trust. See the included upstream license.

PDF.js 5.6.205, sax-js 1.6.1 and pako are included with licenses under `vendor/`. Local adaptations wrap ZIP/XML helpers as ES modules and limit PDF.js decoded streams to 8 MiB, document-level attachment count to 128 and total credential attachment data to 8 MiB. PDF.js uses in-process message delivery, disables evaluation and does not render page images, enable XFA, or fetch remote fonts. PDF.js scanning of uncompressed literal markers is labeled separately from actual page/catalog values.

Technical references: [C2PA standard](https://spec.c2pa.org/specifications/specifications/2.2/specs/ContentCredentials.html) · [Open Library ISBN APIs](https://openlibrary.org/dev/docs/api/books) · [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) · [DOI Handle REST API](https://www.doi.org/factsheets/DOIProxy.html).

## Registry diagnosis

Per-attempt audit data records only the service name, a status category (timeout, network error, HTTP/decoding outcome, or overall budget) and any HTTP status. A transport error cannot establish whether a reference exists. Only a matching record from a live authority earns `verified`. The DOI Handle System's JSON response code 100 establishes a missing identifier; it is commonly sent as HTTP 404, per the [DOI Handbook, section 11.3.2](https://www.doi.org/doi-handbook/DOIHandbook_2025.pdf).

When a live lookup is unavailable, three peer-reviewed articles already indexed for similarity have independently inspected publisher metadata in `publisher-index.json`. A match returns `matched_publisher_snapshot`, the publisher page and verification date alongside the failed live attempts. Snapshot matches are excluded from live acceptance checks and do not populate the live registry cache.

To reproduce the live resolver observation from a runtime, run `node research/media/tests/registry-probe.mjs`. A reachable production resolver needs HTTPS GET access to `api.crossref.org`, `doi.org`, and `openlibrary.org`, within their published usage limits. The script records the actual outcomes whether or not the current deployment has permission to reach these endpoints.

ISBN lookup queries Open Library by ISBN. When it is inconclusive, the Worker checks Crossref's exact ISBN filter and the public Google Books volumes API within the same deadline, without an API key. Returned ISBNs must pass their own checksums and map to the same canonical ISBN-13; print/eBook/paperback ISBNs are not generally interchangeable. Crossref chapter hits use the container title when available. If a catalog attaches different titles to the same ISBN, the report omits the title. Additional service endpoint: `https://www.googleapis.com/books/v1/volumes`. Protocol references: [Crossref exact ISBN filter](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/) and [Google Books volume resources](https://developers.google.com/books/docs/v1/reference/volumes). The real test edition and two distinct editions are listed together in the [publisher's catalog](https://link.springer.com/book/10.1007/978-1-4899-2174-1).
