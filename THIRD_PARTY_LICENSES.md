# Third-party licenses

Lens itself is a personal, non-commercial portfolio project. Most of its dependencies are permissively
licensed (MIT / Apache-2.0). This file records the third-party components that carry notable license
obligations — specifically the **optional "natural voice" text-to-speech feature**, which bundles one
GPLv3 component.

> This is a good-faith attribution + notice file, not legal advice.

## Voice mode — text-to-speech ("natural voice", opt-in)

Reading questions aloud has two engines:

- **Default:** the browser's built-in `speechSynthesis` (Web Speech API). No third-party code is
  bundled or shipped for this path — **zero license exposure.**
- **Optional "natural voice" (opt-in):** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) run
  in the browser via [`kokoro-js`](https://github.com/hexgrad/kokoro) on
  [transformers.js](https://github.com/huggingface/transformers.js) + ONNX Runtime Web. This path is
  **lazy-loaded only when the user explicitly enables it**; nothing below is downloaded or served
  until then.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Kokoro-82M (model weights) | v1.0 ONNX | Apache-2.0 | https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX |
| `kokoro-js` | 1.2.1 | Apache-2.0 | https://github.com/hexgrad/kokoro |
| `@huggingface/transformers` (transformers.js) | 3.8.1 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| `onnxruntime-web` | 1.22.x | MIT | https://github.com/microsoft/onnxruntime |
| **eSpeak NG** (bundled inside `phonemizer`, used for grapheme→phoneme) | via `phonemizer` 1.2.1 | **GPL-3.0** | https://github.com/espeak-ng/espeak-ng |
| `phonemizer` (WASM wrapper around eSpeak NG) | 1.2.1 | declared Apache-2.0 (see note) | https://github.com/xenova/phonemizer.js |

### The GPLv3 component: eSpeak NG

`kokoro-js` depends on [`phonemizer`](https://github.com/xenova/phonemizer.js), which embeds
[**eSpeak NG**](https://github.com/espeak-ng/espeak-ng) compiled to WebAssembly to convert text to
phonemes. **eSpeak NG is licensed under the GNU General Public License v3 (GPL-3.0).**

Note: the `phonemizer` npm package *declares* itself Apache-2.0, but it ships GPLv3 eSpeak NG code
(there is an open upstream dispute about this). The wrapper's declared license does not override
eSpeak NG's actual GPLv3 terms, so this project treats the phonemizer/eSpeak NG component as GPLv3.

**What this means here.** When the natural-voice feature is enabled and the app is served to a
browser, the GPLv3 eSpeak NG WebAssembly is conveyed to that browser. Per GPLv3 this requires, for
that component: (1) making its source available (linked above), (2) preserving its license and
copyright notices, and (3) not imposing additional restrictions on it. This file, together with the
public source links above, is provided to satisfy the attribution/notice and source-availability
obligations for a personal, non-commercial, open-source portfolio use.

- This is **GPL-3.0, not AGPL-3.0** — there is no obligation to publish server-side source.
- The `speechSynthesis` default path carries **none** of these obligations.

### ⚠️ Before any commercial or closed-source use

GPLv3's copyleft makes this a problem the moment the project stops being an open, non-commercial
portfolio piece — e.g. selling it, closing the source, bundling it into a proprietary product, or
restricting redistribution. Before doing any of that, **either** comply fully with GPL-3.0 for the
distributed combination, **or** remove/replace the GPLv3 phonemizer. Cleanest options:

- Drop the Kokoro natural-voice path and keep only the browser `speechSynthesis` engine (zero license
  exposure — the app already defaults to it), **or**
- Swap eSpeak NG for a permissively-licensed grapheme→phoneme engine (e.g. a CMUdict/dictionary-based
  English g2p, or a permissively-licensed g2p model), **or**
- Pre-generate the audio server-side with a permissively-licensed TTS engine.
