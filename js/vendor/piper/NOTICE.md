# Dmitri neural voice

The model is `ru_RU-dmitri-medium`, from rhasspy/piper-voices at the revision
in manifest.json. Its dataset is CC0; see MODEL_CARD.md. Piper is MIT licensed;
see PIPER-LICENSE.txt. The compressed model is split into parts smaller than
Cloudflare's static asset size limit. No changes were made to the weights.

ONNX Runtime Web 1.18.0 is copyright Microsoft Corporation, MIT licensed;
see ONNX-LICENSE.txt. `ort.wasm.min.js` is the unmodified upstream WASM runtime.

The phonemizer is the unmodified build from @diffusionstudio/piper-wasm 1.0.0
(MIT package). It includes eSpeak NG (GPL-3.0); see ESPEAK-LICENSE.txt.
Corresponding source and build instructions: PHONEMIZER-BUILD.md and
https://github.com/diffusion-studio/piper-wasm/tree/69522c832bd52d7c16389e9a8aee568065027689
https://github.com/wide-video/piper-phonemize
https://github.com/rhasspy/espeak-ng

The application communicates with this separate voice worker by text/audio
messages. Recordings and assistant text are not sent to a speech synthesis provider.
Assets are distributed by this repository and cached locally after checksum validation.
