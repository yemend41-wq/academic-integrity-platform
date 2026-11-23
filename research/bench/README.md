# Acceptance fixtures and HTTP measurement

The two English files contain exactly 3,000 words from Herman Melville’s *Moby-Dick* (1851). The first passage begins at “Call me Ishmael.” The upstream source is the public-domain United States edition of Project Gutenberg eBook 2701, mirrored by GITenberg at commit bdf1948e6cd00963730971e5624e764a35f238c3. The measurement text removes headings and separates punctuation inside compounds so that whitespace and alphabetic runs return the same count. Attribution and test notes are outside the document bodies. Four PDF pages carry the same words as the DOCX. The files serve as performance inputs. Literary English is not representative of student or ESL prose.

[Book and rights statement](https://www.gutenberg.org/ebooks/2701) · [Pinned source](https://raw.githubusercontent.com/GITenberg/Moby-Dick--Or-The-Whale_2701/bdf1948e6cd00963730971e5624e764a35f238c3/2701-0.txt)

The Arabic document is original, programmatically authored test prose about a paper collection trial, with deliberate format markers and fictional identifiers. The manifest identifies those markers. This document is for Arabic rendering, metadata and redaction regression tests. Neither fixture establishes accuracy, authorship or fairness.

Run `python fixtures.py` from this directory to regenerate the office files, validate their extracted text and record SHA-256 digests. Tested generation versions: Python 3.12, python-docx 1.2.0, reportlab 4.4.9, pypdf 6.21.4. To reproduce the text extraction, download the pinned upstream text to a local file and pass it to `python source/extract.py PATH`. The extraction script checks the original digest.

## HTTP protocol

`benchmark.py` (httpx 0.28.1) accepts only the hard-coded project HTTPS origin or a local loopback origin with an explicit port. For local secure-cookie runs, use HTTPS with a local trusted CA supplied via --local-ca. It neither retries nor follows redirects. Test only an authorized service. Supply MIZAN_PASSWORD and, when needed, MIZAN_USER in the environment. The output omits credentials and cookies.

```sh
python benchmark.py --origin https://mizan-integrity-studio.yemend41.chatgpt.site --mode load --out RUN.json
```

Two separate serial probes, one for each file type, precede the 50-upload cohort. A failure to log in, upload, parse or independently retrieve a probe stops the load step. The load step sends 25 DOCX files and 25 PDFs from one authenticated account behind a common start barrier. The report checks exact word counts, detector and similarity objects, extracted text if present, unique report IDs, and readback of the same analysis. Client elapsed time covers the complete upload and returned result; storage readback has a separate client timer. Start spread is measured at the caller, not inside a server's queue. Raw observations identify each fixture by SHA-256. Timings include client and network overhead. These measurements alone cannot establish mobile UI performance, unique-user capacity, uptime or the AI detector’s false-positive rate.

The harness creates real test reports with cohort indexing disabled. Use a fresh evidence filename per run. The script returns a nonzero status if either correctness or the defined timing target fails. The raw evidence distinguishes failed requests, valid slower responses and successful readbacks.
