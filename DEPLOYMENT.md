# TradeLog: Cloudflare

Frontend: https://maga17mm-hub.github.io/TRADES/

Full application and API: https://tradelog.maga17mm-trades.workers.dev/

GitHub Pages keeps its existing local data. `js/backend.js` sends only API calls to Cloudflare. The Worker accepts cross-origin requests only from this GitHub Pages origin. Its session token is scoped to the current browser tab; the full Cloudflare site uses an HttpOnly cookie. Old v32 profiles are imported from their Gist on authenticated login or recovery; their profile codes, trades, notes and presets remain usable.

## Deploy

Requires Node 22 or newer, a free Cloudflare account, and Wrangler authentication:

```sh
npm ci
npx wrangler login
npm test
npx wrangler d1 migrations apply tradelog --remote
npm run deploy
```

`npm run deploy` deploys both the private Python voice signature service and the public application. `tools/build.cjs` includes only public application assets. Server modules, dependencies, test data and credentials are excluded.

This configuration uses the owner's existing D1 database. For a different account, create a new D1 database and replace `database_id` in `wrangler.jsonc` before applying migrations. Do not point another project at the existing production database.

## Server secrets

Set these under the `tradelog` Worker → Settings → Variables and Secrets, using type **Secret**:

- `AUTH_SECRET`: a random secret of at least 32 characters, used to hash recovery codes.
- `AI_API_KEY`: the existing AI provider key. The key is never embedded in browser assets.
- `LEGACY_GITHUB_TOKEN`: used only to read old Gists during migration; not required for new accounts.
- `SMTP_USER`: the complete sending mailbox address.
- `SMTP_PASSWORD`: its app password, not the ordinary mailbox password.

Public settings in `wrangler.jsonc` select the AI provider/model and SMTP host. SMTP uses TLS on port 465. Mail.ru, Gmail and Yandex SMTP hosts are supported; sending from one provider works for recipients at other providers too.

For Mail.ru, create a separate app password with **send-only** permission:
https://help.mail.ru/mail/login/mailer/

For Gmail, app passwords require two-step verification:
https://support.google.com/accounts/answer/185833

The old source exposed API/GitHub credentials in browser JavaScript. This release removes them from published assets, but old Git history still contains them. Replace exposed credentials through their providers and update server secrets. Keep the legacy Gist token available only while existing accounts need migration; new profiles use private D1 storage.

## Verification

`npm test` checks recovery delivery errors, expiry, attempt limits, atomic one-time consumption, session revocation, old profile migration, cross-origin access, SMTP replies, dictation lifecycle, microphone release and cancellation of pending transcription. `GET /api/status` reports which connections are configured without revealing secrets. Actual email receipt must also be checked in the recipient mailbox. For an actual browser/WASM voice check, serve the repository locally and open `tests/piper-browser.html`; it verifies short/long WAV generation and provides a downloadable sample.

Example dictation:

> Запиши сделку по биткоину: шорт, пятнадцать минут, вход шестьдесят восемь тысяч пятьсот, стоп минус один эр.

The assistant asks for missing asset, direction or result instead of inventing them. Dictation parsing and saving work without GPT. Modern browsers record microphone audio with MediaRecorder and send it to authenticated `/api/transcribe`, using Whisper large v3 turbo through the Workers AI binding. This avoids the browser's proprietary speech recognition service, which is unavailable in some browsers. Recording stops after a speech pause, a second tap, or 45 seconds. Closing the assistant cancels recording/transcription and releases the microphone. Recordings are not saved in D1. Browsers without MediaRecorder retain the native speech recognition fallback.

Workers AI is included in Cloudflare's free plan with a daily allocation of 10,000 neurons: https://developers.cloudflare.com/workers-ai/platform/pricing/. No paid plan is enabled by this deployment; requests fail with a clear message when the free quota is exhausted. Whisper requests are rate limited per authenticated account.

The default voice is now the free Piper `ru_RU-dmitri-medium` neural model, selected by the owner after upstream Microsoft speech failures. It has a different timbre from Microsoft's Dmitry. Inference runs in a dedicated browser worker using single-threaded ONNX Runtime WASM, without cross-origin isolation. Around 70 MB downloads from this site's own assets on first speech; compressed files are checked against SHA-256 and cached in a separate IndexedDB database. Cached inference works offline. Cancellation terminates the worker; idle workers are released after two minutes. Audio playback reuses a Web Audio context unlocked by user interaction. Audio is generated and scheduled by phrase, so long replies start playing before the entire answer is synthesized. A fresh CLI phonemizer per phrase and disabled ONNX CPU memory arenas keep long replies from accumulating WASM memory.

Voice model and runtime assets are committed under `js/vendor/piper/` so both GitHub Pages and Workers serve the same files. To regenerate them, run `node tools/prepare-voice.cjs` after `npm ci`. Model revision and checksums are pinned in manifest.json. Licenses and source/build links are beside the assets. Models are split to stay below Cloudflare's per-asset size limit.

Microsoft Dmitry remains an explicitly selectable internet voice. Its free upstream service has intermittent failures (also reproducible with the upstream edge-tts client). Byte-limited SSML chunks, connection/audio timeouts and a retry reduce failures, but this optional voice remains dependent on Microsoft's service. System voices are explicit options and are never silently substituted for Piper.

The private Python module is derived from `edge-tts` 7.3.1 (LGPL-3.0), with its source, modification notice and license in `cloudflare/voice-signature/`. This is necessary for the current service protocol. Audio is received through a native Worker WebSocket transport.
