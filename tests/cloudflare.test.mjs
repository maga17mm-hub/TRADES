import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ApiError, authenticate, digest, handleAccount, passwordMatches} from '../cloudflare/accounts.mjs';
import worker, {checkOrigin} from '../cloudflare/index.mjs';
import {sendSmtp} from '../cloudflare/smtp.mjs';
import {synthesize, splitSpeechText} from '../cloudflare/speech.mjs';
import {transcribe} from '../cloudflare/transcribe.mjs';

test('long Cyrillic, emoji and XML characters stay within the speech byte budget without lost text', () => {
  const text = ('Дневник & сделки <BTC> 😀. '.repeat(80) + 'я'.repeat(1900));
  const pieces = splitSpeechText(text);
  assert.ok(pieces.length > 3);
  assert.equal(pieces.join(''), text);
  for (const piece of pieces) {
    const escaped = piece.replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char]));
    assert.ok(Buffer.byteLength(escaped) <= 1800);
    assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(piece));
  }
  assert.deepEqual(splitSpeechText('\0Привет\u000B'), ['Привет']);
});

test('server transcription validates audio, uses Russian Whisper and reports silence and free quota errors', async () => {
  const audio = Buffer.alloc(160, 1).toString('base64');
  await assert.rejects(transcribe({audio}, {}), error => error.status === 503);
  await assert.rejects(transcribe({audio: 'not base64'}, {AI: {}}), error => error.status === 400);
  await assert.rejects(transcribe({audio: 'A'.repeat(5600001)}, {AI: {}}), error => error.status === 400);
  const env = {AI: {run: async (model, input) => {
    assert.equal(model, '@cf/openai/whisper-large-v3-turbo');
    assert.equal(input.language, 'ru'); assert.equal(input.audio, audio);
    return {text: '  Запиши сделку по биткоину, лонг, прибыль 2,5р.  '};
  }}};
  assert.equal((await transcribe({audio}, env)).text, 'Запиши сделку по биткоину, лонг, прибыль 2,5р.');
  await assert.rejects(transcribe({audio}, {AI: {run: async () => ({text: ' '})}}), error => error.status === 422);
  await assert.rejects(transcribe({audio}, {AI: {run: async () => {throw new Error('daily neurons quota exceeded');}}}), error => error.status === 502 && /бесплатный лимит/.test(error.message));
});

test('neural speech preserves binary audio and waits for delayed Blob frames before turn.end', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const useBlob of [false, true]) {
      const sent = [];
      const header = new TextEncoder().encode('Path:audio\r\nContent-Type: audio/mpeg\r\n');
      const frame = new Uint8Array(2 + header.length + 3);
      frame[0] = header.length >> 8; frame[1] = header.length & 255;
      frame.set(header, 2); frame.set([255, 243, 192], 2 + header.length);
      class SlowBlob extends Blob {
        async arrayBuffer() { await new Promise(resolve => setTimeout(resolve, 10)); return super.arrayBuffer(); }
      }
      const socket = new EventTarget();
      socket.accept = () => {};
      socket.close = () => socket.dispatchEvent(new Event('close'));
      socket.send = message => {
        sent.push(message);
        if (sent.length === 2) {
          queueMicrotask(() => {
            socket.dispatchEvent(new MessageEvent('message', {data: useBlob ? new SlowBlob([frame]) : frame.buffer}));
            socket.dispatchEvent(new MessageEvent('message', {data: 'Path:turn.end\r\n\r\n'}));
          });
        }
      };
      globalThis.fetch = async () => ({webSocket: socket});
      const result = await synthesize('Сделка <сохранена>', {VOICE_SIGNATURE: {fetch: async () => Response.json({token: 'test-signature', version: '2-test'})}});
      assert.deepEqual([...result], [255, 243, 192]);
      assert.ok(sent[1].includes('DmitryNeural'));
      assert.ok(sent[1].includes('&lt;сохранена&gt;'));
      assert.equal(JSON.parse(sent[0].split('\r\n\r\n')[1]).context.synthesis.audio.metadataoptions.wordBoundaryEnabled, 'true');
    }
  } finally { globalThis.fetch = originalFetch; }
});

class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../cloudflare/migrations/0001_accounts.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    return {bind: (...args) => ({
      first: async () => statement.get(...args) || null,
      all: async () => ({results: statement.all(...args)}),
      run: async () => statement.run(...args)
    })};
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const results = []; for (const s of statements) results.push(await s.run()); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
const fixture = () => ({DB: new D1(), AUTH_SECRET: 'test-only-private-secret-for-recovery', SMTP_HOST: 'smtp.mail.ru', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only'});
const request = cookie => new Request('https://trades.example/api/account', {method: 'POST', headers: {'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie.split(';')[0]} : {})}});
const register = (env, vault = {}) => handleAccount({action: 'register', password: 'old-password', vault: {
  userName: 'Трейдер', userEmail: 'trader@example.test', trades: [{uuid: 'keep-this', images: ['test-image']}], thoughts: [{uuid: 'note'}],
  presets: {tickers: ['BTC/USDT']}, ...vault}}, request(), env);
const mail = async (env, id, services) => handleAccount({action: 'reset-request', identifier: id, email: 'trader@example.test'}, request(), env, services);
const confirm = (env, id, code, password = 'new-password') => handleAccount({action: 'reset-confirm', identifier: id, email: 'trader@example.test', code, password}, request(), env);

test('registration, login and read preserve photos, notes and presets without disclosing password', async () => {
  const env = fixture();
  const result = await register(env);
  assert.equal(result.data.trades[0].images[0], 'test-image');
  assert.equal(result.data.thoughts[0].uuid, 'note');
  assert.deepEqual(result.data.presets.tickers, ['BTC/USDT']);
  assert.equal(result.data.password, undefined);
  assert.match(result.cookie, /HttpOnly; SameSite=Strict/);
  assert.match(result.cookie, /Secure/);
  const account = await authenticate(request(result.cookie), env);
  assert.ok(await passwordMatches('old-password', account.password));
  const login = await handleAccount({action: 'login', identifier: 'TRADER@example.test', password: 'old-password'}, request(), env);
  assert.equal(login.data.vaultId, result.data.vaultId);
});
test('duplicate registration and wrong passwords are rejected', async () => {
  const env = fixture(); await register(env);
  await assert.rejects(register(env), error => error.status === 409);
  await assert.rejects(handleAccount({action: 'login', identifier: 'trader@example.test', password: 'wrong'}, request(), env), error => error.status === 401);
});
test('SMTP failure is visible and clears failed recovery so retry is possible', async () => {
  const env = fixture(); const {data} = await register(env);
  await assert.rejects(mail(env, data.vaultId, {sendRecovery: async () => {throw new ApiError('mail failure', 502);}}));
  const account = env.DB.db.prepare('SELECT * FROM accounts').get();
  assert.equal(account.reset_hash, null); assert.equal(account.reset_sent_at, 0);
});
test('code is mailed, never returned, stored hashed, expires, and preserves all journal data', async () => {
  const env = fixture(); const original = await register(env);
  let code;
  const sent = await mail(env, original.data.vaultId, {sendRecovery: async (_, email, value) => {
    assert.equal(email, 'trader@example.test'); code = value;
  }});
  assert.deepEqual(sent.data, {sent: true}); assert.match(code, /^\d{6}$/);
  const account = env.DB.db.prepare('SELECT * FROM accounts').get();
  assert.notEqual(account.reset_hash, code); assert.equal(account.reset_attempts, 5);
  await assert.rejects(confirm(env, account.id, 'wrong'));
  const recovered = await confirm(env, account.id, code);
  assert.deepEqual(recovered.data.trades, original.data.trades);
  assert.deepEqual(recovered.data.thoughts, original.data.thoughts);
  await assert.rejects(authenticate(request(original.cookie), env), error => error.status === 401);
  await assert.rejects(confirm(env, account.id, code));
  const updated = await authenticate(request(recovered.cookie), env);
  assert.ok(await passwordMatches('new-password', updated.password));
  assert.equal(await passwordMatches('old-password', updated.password), false);
});
test('expired recovery code rejected', async () => {
  const env = fixture(); const {data} = await register(env); let code;
  await mail(env, data.vaultId, {sendRecovery: async (_, __, value) => code = value});
  env.DB.db.exec('UPDATE accounts SET reset_expires=0');
  await assert.rejects(confirm(env, data.vaultId, code));
});
test('five failed attempts lock recovery, including the correct code afterwards', async () => {
  const env = fixture(); const {data} = await register(env); let code;
  await mail(env, data.vaultId, {sendRecovery: async (_, __, value) => code = value});
  for (let i = 0; i < 5; i++) await assert.rejects(confirm(env, data.vaultId, 'wrong'));
  await assert.rejects(confirm(env, data.vaultId, code));
});
test('concurrent confirmations consume the code exactly once', async () => {
  const env = fixture(); const {data} = await register(env); let code;
  await mail(env, data.vaultId, {sendRecovery: async (_, __, value) => code = value});
  const results = await Promise.allSettled([confirm(env, data.vaultId, code, 'new-password-a'), confirm(env, data.vaultId, code, 'new-password-b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('unknown or mismatched email does not send or expose a code', async () => {
  const env = fixture(); const {data} = await register(env); let calls = 0;
  const result = await handleAccount({action: 'reset-request', identifier: data.vaultId, email: 'other@example.test'}, request(), env, {sendRecovery: async () => calls++});
  assert.equal(calls, 0); assert.deepEqual(result.data, {sent: true});
});
test('cooldown and login rate limit survive between requests', async () => {
  const env = fixture(); const {data} = await register(env);
  await mail(env, data.vaultId, {sendRecovery: async () => {}});
  await assert.rejects(mail(env, data.vaultId, {sendRecovery: async () => {}}), error => error.status === 429);
  for (let i = 0; i < 10; i++) await assert.rejects(handleAccount({action: 'login', identifier: data.vaultId, password: 'wrong'}, request(), env));
  await assert.rejects(handleAccount({action: 'login', identifier: data.vaultId, password: 'old-password'}, request(), env), error => error.status === 429);
});
test('sync cannot change authentication or another account and stores multiple chunks intact', async () => {
  const env = fixture(); const {data, cookie} = await register(env);
  await assert.rejects(handleAccount({action: 'read', identifier: 'another-profile'}, request(cookie), env), error => error.status === 403);
  const photo = 'x'.repeat(850000);
  const result = await handleAccount({action: 'sync', vault: {trades: [{uuid: 'photo', images: [photo]}],
    email: 'attacker@example.test', password: 'forged', reset_hash: 'forged'}}, request(cookie), env);
  assert.equal(result.data.trades[0].images[0], photo);
  const account = await authenticate(request(cookie), env);
  assert.equal(account.email, 'trader@example.test');
  assert.equal(account.reset_hash, null);
  assert.ok(await passwordMatches('old-password', account.password));
});
test('logout revokes the server session, forged cookies rejected', async () => {
  const env = fixture(); const {cookie} = await register(env);
  await handleAccount({action: 'logout'}, request(cookie), env);
  await assert.rejects(authenticate(request(cookie), env));
  await assert.rejects(authenticate(request('tradelog_session=forged'), env));
});
test('cross-origin, invalid JSON, unauthenticated chat and speech rejected', async () => {
  assert.throws(() => checkOrigin(new Request('https://trades.example/api/account', {headers: {Origin: 'https://evil.example'}})), error => error.status === 403);
  const env = fixture();
  for (const endpoint of ['chat', 'speech']) {
    const response = await worker.fetch(new Request(`https://trades.example/api/${endpoint}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}), env);
    assert.equal(response.status, 401);
  }
  const malformed = await worker.fetch(new Request('https://trades.example/api/account', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '['}), env);
  assert.equal(malformed.status, 400);
});
test('legacy Gist login migrates data and validates the original password first', async () => {
  const env = fixture(); env.LEGACY_GITHUB_TOKEN = 'test-only-token';
  const id = 'a'.repeat(32);
  const vault = {userEmail: 'legacy@example.test', userName: 'Legacy', passwordHash: await digest('old:legacy@example.test'), trades: [{uuid: 'legacy-trade'}]};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({id, files: {'tradelog_vault.json': {content: JSON.stringify(vault)}}});
  try {
    await assert.rejects(handleAccount({action: 'login', identifier: id, password: 'wrong'}, request(), env));
    assert.equal(env.DB.db.prepare('SELECT count(*) AS count FROM accounts').get().count, 0);
    const result = await handleAccount({action: 'login', identifier: id, password: 'old'}, request(), env);
    assert.equal(result.data.vaultId, id); assert.equal(result.data.trades[0].uuid, 'legacy-trade');
    assert.equal(result.data.passwordHash, undefined);
    assert.ok(await passwordMatches('old', (await authenticate(request(result.cookie), env)).password));
  } finally { globalThis.fetch = originalFetch; }
});
test('failed recovery during legacy migration keeps the original password usable', async () => {
  const env = fixture(); env.LEGACY_GITHUB_TOKEN = 'test-only-token';
  const id = 'b'.repeat(32);
  const vault = {userEmail: 'trader@example.test', userName: 'Legacy', passwordHash: await digest('old:trader@example.test'), trades: [{uuid: 'legacy-trade'}]};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({id, files: {'tradelog_vault.json': {content: JSON.stringify(vault)}}});
  try {
    await assert.rejects(mail(env, id, {sendRecovery: async () => {throw new ApiError('SMTP failed', 502);}}));
    const result = await handleAccount({action: 'login', identifier: id, password: 'old'}, request(), env);
    assert.equal(result.data.trades[0].uuid, 'legacy-trade');
    assert.equal((await authenticate(request(result.cookie), env)).password.startsWith('pbkdf2$'), true);
  } finally { globalThis.fetch = originalFetch; }
});
test('GitHub Pages gets a scoped session, other origins get no CORS access or session', async () => {
  const env = fixture();
  const {data} = await register(env);
  const pages = 'https://maga17mm-hub.github.io';
  const response = await worker.fetch(new Request('https://trades.example/api/account', {method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: pages, 'Sec-Fetch-Site': 'cross-site'},
    body: JSON.stringify({action: 'login', identifier: data.vaultId, password: 'old-password'})}), env);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), pages);
  const token = (await response.json()).sessionToken;
  assert.ok(token); assert.equal(response.headers.get('Set-Cookie'), null);
  const read = await worker.fetch(new Request('https://trades.example/api/account', {method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: pages, Authorization: 'Bearer ' + token},
    body: JSON.stringify({action: 'read', identifier: data.vaultId})}), env);
  assert.equal(read.status, 200); assert.equal((await read.json()).sessionToken, undefined);
  const preflight = await worker.fetch(new Request('https://trades.example/api/account', {method: 'OPTIONS', headers: {Origin: pages}}), env);
  assert.equal(preflight.status, 204);
  const rejected = await worker.fetch(new Request('https://trades.example/api/account', {method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: 'https://evil.example'}, body: '{}'}), env);
  assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
});

function smtpFixture(rejection) {
  const commands = [];
  let controller, closed = false, stage = 0;
  const encoder = new TextEncoder();
  const replies = ['250-mail.example\r\n250 AUTH LOGIN\r\n', '334 Username\r\n', '334 Password\r\n',
    '235 Authenticated\r\n', '250 Sender OK\r\n', '250 Recipient OK\r\n', '354 Send data\r\n', '250 Queued\r\n'];
  const socket = {opened: Promise.resolve(), closed: Promise.resolve(),
    readable: new ReadableStream({start(value) {controller = value; controller.enqueue(encoder.encode('220 Ready\r\n'));}}),
    writable: new WritableStream({write(value) {
      commands.push(new TextDecoder().decode(value));
      if (stage < replies.length) controller.enqueue(encoder.encode(rejection?.stage === stage ? rejection.reply : replies[stage]));
      stage++;
    }}),
    async close() {if (!closed) {closed = true; controller.close();}}
  };
  return {commands, connect: (address, options) => {assert.equal(address.port, 465); assert.equal(options.secureTransport, 'on'); return socket;}};
}
test('SMTP uses TLS, handles multiline replies and confirms delivery only after DATA acceptance', async () => {
  const smtp = smtpFixture();
  await sendSmtp({SMTP_HOST: 'smtp.mail.ru', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'app-password'},
    'recipient@gmail.com', 'Ваш код: 123456', smtp.connect);
  assert.equal(smtp.commands[5], 'RCPT TO:<recipient@gmail.com>\r\n');
  const message = smtp.commands[7];
  assert.match(message, /To: <recipient@gmail.com>/);
  const encodedBody = message.split('\r\n\r\n')[1].replace(/\r\n\.\r\n$/, '');
  assert.equal(Buffer.from(encodedBody, 'base64').toString(), 'Ваш код: 123456');
});
test('SMTP auth failure or rejection after DATA never reports successful delivery', async () => {
  for (const rejection of [{stage: 3, reply: '535 Authentication failed\r\n'}, {stage: 7, reply: '550 Rejected\r\n'}]) {
    const smtp = smtpFixture(rejection);
    await assert.rejects(sendSmtp({SMTP_HOST: 'smtp.mail.ru', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'app-password'},
      'recipient@mail.ru', 'Код', smtp.connect), /SMTP_REJECTED_/);
  }
});
test('SMTP rejects header injection before connecting', async () => {
  await assert.rejects(sendSmtp({SMTP_USER: 'sender@example.test\r\nBCC: other@example.test'}, 'recipient@mail.ru', 'Код'), /SMTP_INVALID_ADDRESS/);
});
