# AI detector evaluation R6

The web Worker runs the model identified in the live model card. Research candidates in this directory are offline only. Counts and derived metrics are available at `/detector-study.json`. Neither case text nor credentials belong in this source tree.

## Lightweight challengers

`protocol.json` fixes the feature family, split, calibration, ensemble weights and promotion gates. `acquire.py` and `prepare.py` describe development inputs and overlap exclusions. Use the explicit file/directory arguments in their help. `extract.mjs` produces sparse character features, and `fit.py` fits them on development rows only. The trained configuration can be instantiated with the core module for local comparisons. Individual researcher-supplied text, manually licensed corpora, raw predictions and unpromoted study weights are excluded from the web Worker.

## Pretrained specialists

`specialist-lock.json` records exact model IDs, revisions, artifact SHA-256s, positive class indices, threshold and aggregation. Store the corresponding publisher tokenizer/configuration and licensed weights locally under `en/` (including `onnx/model_quantized.onnx`) and `ar/`; verify the hashes before use. Install NumPy, tokenizers, ONNX Runtime, PyTorch CPU and transformers in an isolated environment. The reference inference script loads only local files. Run `python specialist.py --help` for the prediction interface. Inputs are line-delimited JSON with `id`, `lang` and `text`. Use a separate answer key only after immutable predictions exist.

The research output is window evidence. Its binary decisions are not percentages of generated words and cannot be substituted for the live model's selected-word share.
