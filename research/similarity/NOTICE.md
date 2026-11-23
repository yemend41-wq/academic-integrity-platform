# Similarity index and training provenance

## Indexed publications

The built-in collection consists of two English peer-reviewed paper bodies, an Arabic journal abstract excerpt, and the English and Arabic Creative Commons Attribution 4.0 legal codes. Each source in `sources.mjs` carries its publication link, attribution, language and license. PyArabic (Taha Zerrouki, JOSS 8:4886, 2023) and Shekar (Ahmad Amirivojdan, JOSS 10:9128, 2025) are CC BY 4.0. Their authors' paper.md source files were converted to plain text, omitting YAML, bibliography, markup and links. For يحيى سليمان العمري's 2026 Arabic research abstract the index retains an excerpt of its methods section, with the publisher's Creative Commons Attribution policy. The two legal codes were converted to plain text from official Creative Commons materials; their legal text is dedicated to the public domain. The local collection and explicitly indexed cohort submissions determine retrieval coverage. The application does not have an Internet-wide academic index.

## Multilingual model and lexical data

`training/parallel.jsonl` is a text-only extraction pairing matching sentence IDs from the Arabic and English Parallel Universal Dependencies treebanks. Attribution: the CoNLL 2017 PUD/Universal Dependencies contributors, including the Google translation and annotation teams, Hans Uszkoreit, Vivien Macketanz, Aljoscha Burchardt, Slav Petrov, Tolga Kayadelen, Mohammed Attia, Ali Elkahky, Dima Taji and their colleagues. The originating treebanks credit their news and Wikipedia source texts. Source files:

- [Arabic PUD, source](https://github.com/UniversalDependencies/UD_Arabic-PUD/blob/master/ar_pud-ud-test.conllu), Git blob `075361d5425ea0d43ff6b4f5459a306e26df6fbf`.
- [English PUD, source](https://github.com/UniversalDependencies/UD_English-PUD/blob/master/en_pud-ud-test.conllu), Git blob `828f827759e7a9f89a8c42bfe79402dd65db71c3`.
- [Treebank documentation, contributors and upstream terms](https://github.com/UniversalDependencies/UD_Arabic-PUD/blob/master/README.md).

The file `training/arabic_synsets.tsv` is derived from Arabic WordNet via [Open Multilingual WordNet](https://github.com/omwn/omw-data/blob/main/wns/arb/wn-data-arb.tab), Git blob `ddcdc8b41b67c762bfad4c727b3e9c6b31340f6a`. Modification: normalize Arabic presentation, remove vowel marks and tatweel, retain multi-lemma single-word synsets including broken plurals, and sort term sets. The authors and original notices are in `training/AWN-LICENSE.txt`.

The extracts above and their derived weights/lexical tables in `model.mjs` are distributed under CC BY-SA 3.0. A copy is in `training/CC-BY-SA-3.0.txt`. [License URL](https://creativecommons.org/licenses/by-sa/3.0/).

## Reproduction and limits

Run `OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python research/similarity/training/train.py` from the repository root, with NumPy and scikit-learn available. It learns a 48-dimensional multilingual latent semantic index by decomposing TF-IDF vectors of parallel sentence pairs, then quantizes word vectors to signed bytes. This is a compact distributional model trained on 833 pairs; it has limited domain coverage. Its test split contains 167 pairs from disjoint source document groups. The script writes measured retrieval metrics to `training/evaluation.json`. This retrieval exercise does not establish performance on committee files or the AI detector's false-positive rate.

Run `node --test research/similarity/test.mjs` to check five-gram exact matching, normalisation, UTF-16 document/source offsets, English/Arabic candidate paraphrases, source scope, quote/reference exclusions, changed numerical claims and overlap handling. These controlled software checks cannot establish population-level similarity accuracy. Paraphrase retrieval requires supporting lexical anchors and abstains on weak evidence. Returned percentages measure coverage of eligible words, not authorship or misconduct. The approximate percentage includes the full selected sentence of a candidate paraphrase.


## Independent evaluation and genuine PDF fixture

`training/pyarabic-published.pdf` is the unmodified six-page publisher PDF, Taha Zerrouki, *PyArabic: A Python package for Arabic text* (JOSS, 2023), CC BY 4.0. Source: [JOSS public article archive](https://github.com/openjournals/joss-papers/blob/master/joss.04886/10.21105.joss.04886.pdf). Published DOI: https://doi.org/10.21105/joss.04886. Binary SHA-256: `b196e33fcebb974fca4ec5e9563e0c1ca54ceb026426c98a9f3ead36d182e9b1`.

`node research/similarity/training/test-external.mjs` evaluates official SemEval 2017 STS Task 1 tracks 1 (Arabic–Arabic) and 5 (English–English) and independently extracts the JOSS fixture via Poppler. The script fetches the original, SHA-256-locked sentence and gold-score files from a [public mirror](https://github.com/yaushian/mSimCSE/tree/main/data/Sts2017). An offline run can provide the same files beside the script with filenames `track1.ar-ar.input.tmp`, `track1.ar-ar.gs.tmp`, `track5.en-en.input.tmp`, `track5.en-en.gs.tmp`. The project distributes aggregate findings, not the benchmark sentences. [SemEval 2017 Task 1, data and tools](https://alt.qcri.org/semeval2017/task1/index.php?id=data-and-tools).

All 500 pairs were read. Gold scores at least 4/5 represent high similarity; scores at most 1/5 represent low similarity. Intermediate cases do not enter either count. A positive result means at least one displayed interval identifies the supplied comparison text. With thresholds fixed before first reading these labels, matching on high-similarity pairs reached 6/41 Arabic and 21/41 English. Matches on low-similarity pairs were 0/72 Arabic and 0/61 English. Short sentences and broad substitutions are especially difficult under the conservative evidence rules. These aggregates measure source retrieval; the separate AI detector evaluates human authorship.
