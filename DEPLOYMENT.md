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

`npm test` checks recovery delivery errors, expiry, attempt limits, atomic one-time consumption, session revocation, old profile migration, cross-origin access, SMTP replies and dictation lifecycle. `GET /api/status` reports which connections are configured without revealing secrets. Actual email receipt must also be checked in the recipient mailbox.

Example dictation:

> Запиши сделку по биткоину: шорт, пятнадцать минут, вход шестьдесят восемь тысяч пятьсот, стоп минус один эр.

The assistant asks for missing asset, direction or result instead of inventing them. Dictation parsing and saving work without GPT. Speech recognition needs browser support, internet access to its recognition service, and microphone permission. Neural Dmitry uses the free Edge speech service through the server; it is not silently replaced with a system voice if unavailable.

The private Python module is derived from `edge-tts` 7.3.1 (LGPL-3.0), with its source, modification notice and license in `cloudflare/voice-signature/`. This is necessary for the current service protocol. Audio is received through a native Worker WebSocket transport.
