import {randomBytes, randomInt, timingSafeEqual} from 'node:crypto';

export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const now = () => Math.floor(Date.now() / 1000);
const randomToken = () => randomBytes(32).toString('base64url');
export const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const syncFields = ['trades', 'thoughts', 'presets', 'deletedTradeUuids', 'deletedThoughtUuids', 'updatedAt'];
const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export function required(env, key) {
  if (!env[key]) throw new ApiError('Сервис ещё не настроен. Обратитесь к владельцу сайта.', 503);
  return env[key];
}

export async function passwordRecord(password, allowLegacyLength = false) {
  if (typeof password !== 'string' || password.length < (allowLegacyLength ? 1 : 8) || password.length > 256)
    throw new ApiError('Пароль должен содержать от 8 до 256 символов.');
  const salt = randomBytes(16).toString('hex');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt: Buffer.from(salt, 'hex'), iterations: 100000, hash: 'SHA-256'}, key, 256);
  return `pbkdf2$100000$${salt}$${Buffer.from(bits).toString('hex')}`;
}
export async function passwordMatches(password, record) {
  if (typeof password !== 'string' || password.length > 256) return false;
  if (record?.startsWith('legacy$')) {
    const legacy = JSON.parse(Buffer.from(record.slice(7), 'base64url').toString());
    return legacyPasswordMatches({passwordHash: legacy.hash, userEmail: legacy.email}, password);
  }
  if (!record?.startsWith('pbkdf2$')) return false;
  const [, count, salt, expected] = record.split('$');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', salt: Buffer.from(salt, 'hex'), iterations: Number(count), hash: 'SHA-256'}, key, 256);
  return equal(Buffer.from(bits).toString('hex'), expected);
}
export async function rateLimit(env, key, maximum, seconds) {
  const timestamp = now();
  const hashed = await digest(key);
  const row = await query(env, `INSERT INTO rate_limits(key,hits,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN expires<=? THEN 1 ELSE hits+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING hits`,
    hashed, timestamp + seconds, timestamp, timestamp).first();
  if (row.hits > maximum) throw new ApiError('Слишком много запросов. Попробуйте позже.', 429);
}

async function accountByIdentifier(env, identifier) {
  return query(env, 'SELECT * FROM accounts WHERE id=? OR email=? COLLATE NOCASE', identifier, identifier).first();
}
async function github(env, path) {
  const response = await fetch('https://api.github.com/gists' + path, {headers: {
    Authorization: 'Bearer ' + required(env, 'LEGACY_GITHUB_TOKEN'),
    Accept: 'application/vnd.github+json', 'User-Agent': 'TradeLog-Migration'
  }, signal: AbortSignal.timeout(20000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError('Не удалось загрузить старый профиль. Повторите позже.', 502);
  return response.json();
}
async function unpackGist(gist) {
  const file = gist?.files?.['tradelog_vault.json'] || (gist?.files ? Object.values(gist.files)[0] : null);
  if (!file) return null;
  let data;
  if (file.truncated || !file.content) {
    if (new URL(file.raw_url).hostname !== 'gist.githubusercontent.com') throw new ApiError('Некорректный адрес старого хранилища.', 502);
    const response = await fetch(file.raw_url, {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new ApiError('Не удалось загрузить данные старого профиля.', 502);
    data = await response.json();
  } else data = JSON.parse(file.content);
  return {...data, vaultId: gist.id};
}
async function legacyVault(env, identifier) {
  if (!env.LEGACY_GITHUB_TOKEN) return null;
  if (/^[a-f0-9]{20,40}$/i.test(identifier)) return unpackGist(await github(env, '/' + identifier));
  if (!identifier.includes('@')) return null;
  for (let page = 1; page <= 10; page++) {
    const list = await github(env, `?per_page=100&page=${page}`);
    for (const item of list || []) {
      if (!item.files?.['tradelog_vault.json']) continue;
      const data = await unpackGist(await github(env, '/' + item.id));
      if (data?.userEmail?.toLowerCase() === identifier.toLowerCase()) return data;
    }
    if (!list || list.length < 100) return null;
  }
  throw new ApiError('Используйте код старого профиля для входа.');
}
async function legacyPasswordMatches(vault, password) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const email = vault.userEmail || '';
  for (const candidate of [password, password.trim()]) {
    for (const address of [email, email.toLowerCase()]) {
      if (vault.passwordHash && equal(await digest(candidate + ':' + address), vault.passwordHash)) return true;
    }
  }
  return !!vault.savedPassword && equal(vault.savedPassword, password);
}

function chunkStatements(env, id, vault) {
  const safe = {};
  for (const field of syncFields) if (field in vault) safe[field] = vault[field];
  const text = JSON.stringify(safe);
  if (text.length > 18000000) throw new ApiError('Объём профиля превышает 18 МБ. Сохраните резервную копию и уменьшите вложения.', 413);
  const statements = [query(env, 'DELETE FROM vault_chunks WHERE account_id=?', id)];
  // Store large photo journals in chunks below D1's per-row limit, atomically.
  for (let offset = 0; offset < text.length; offset += 400000)
    statements.push(query(env, 'INSERT INTO vault_chunks(account_id,chunk_index,content) VALUES(?,?,?)', id, offset / 400000, text.slice(offset, offset + 400000)));
  return statements;
}
async function publicVault(env, account) {
  const chunks = await query(env, 'SELECT content FROM vault_chunks WHERE account_id=? ORDER BY chunk_index', account.id).all();
  let data = JSON.parse(chunks.results.map(row => row.content).join('') || '{}');
  if ((!data.trades || data.trades.length === 0) && env.LEGACY_GITHUB_TOKEN) {
    try {
      const legacy = await legacyVault(env, account.id) || (account.email ? await legacyVault(env, account.email) : null);
      if (legacy && Array.isArray(legacy.trades) && legacy.trades.length > 0) {
        data = { ...legacy, ...data, trades: legacy.trades, thoughts: legacy.thoughts || data.thoughts || [] };
        await env.DB.batch(chunkStatements(env, account.id, data));
      }
    } catch (_) {}
  }
  return {...data, version: 3, vaultId: account.id, userId: account.id, userName: account.name,
    userEmail: account.email, createdAt: account.created_at};
}
async function importLegacy(env, vault, password) {
  const existing = await accountByIdentifier(env, vault.vaultId) || await accountByIdentifier(env, vault.userEmail);
  if (existing) return existing;
  let record;
  if (password) record = await passwordRecord(password, true);
  else {
    const hash = /^[a-f0-9]{64}$/i.test(vault.passwordHash || '') ? vault.passwordHash
      : vault.savedPassword ? await digest(vault.savedPassword + ':' + vault.userEmail) : '';
    record = 'legacy$' + Buffer.from(JSON.stringify({hash, email: vault.userEmail})).toString('base64url');
  }
  const account = {id: vault.vaultId, email: vault.userEmail.toLowerCase(), name: vault.userName || 'Трейдер',
    password: record,
    version: randomToken(), created_at: vault.createdAt || new Date().toISOString()};
  await env.DB.batch([
    query(env, 'INSERT INTO accounts(id,email,name,password,version,created_at) VALUES(?,?,?,?,?,?)', account.id, account.email, account.name, account.password, account.version, account.created_at),
    ...chunkStatements(env, account.id, vault)
  ]);
  return account;
}

function sessionCookie(token, url) {
  return `tradelog_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 2592000 : 0}${new URL(url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function newSession(env, account, url) {
  const token = randomToken();
  await query(env, 'INSERT INTO sessions(token_hash,account_id,version,expires) VALUES(?,?,?,?)', await digest(token), account.id, account.version, now() + 2592000).run();
  return sessionCookie(token, url);
}
function cookieToken(request) {
  return request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1]
    || request.headers.get('Cookie')?.match(/(?:^|;\s*)tradelog_session=([^;]+)/)?.[1] || '';
}
export async function authenticate(request, env) {
  const token = cookieToken(request);
  if (!token) throw new ApiError('Войдите в профиль для подключения к облаку.', 401);
  const account = await query(env, `SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id
    WHERE s.token_hash=? AND s.expires>? AND s.version=a.version`, await digest(token), now()).first();
  if (!account) throw new ApiError('Сессия завершена. Войдите в профиль снова.', 401);
  return account;
}

export async function sendRecovery(env, email, code) {
  const host = required(env, 'SMTP_HOST');
  required(env, 'SMTP_USER'); required(env, 'SMTP_PASSWORD');
  if (!['smtp.mail.ru', 'smtp.gmail.com', 'smtp.yandex.ru'].includes(host)) throw new ApiError('Неизвестный почтовый сервер.', 503);
  try {
    const {sendSmtp} = await import('./smtp.mjs');
    await sendSmtp(env, email, `Ваш код восстановления TradeLog: ${code}\n\nВведите его на сайте в течение 15 минут.\nЕсли вы не запрашивали сброс, проигнорируйте это письмо.`);
  } catch (error) {
    console.error('SMTP failure', error.code || error.name, error.message?.startsWith('SMTP_') ? error.message : 'CONNECTION');
    throw new ApiError('Письмо не отправлено. Проверьте настройки отправителя или повторите позже.', 502);
  }
}

function cleanIdentifier(raw) {
  if (!raw) return '';
  let str = String(raw).trim().replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').replace(/^["']|["']$/g, '');
  if (str.toUpperCase().startsWith('TL-') || str.toUpperCase().startsWith('TL_')) str = str.substring(3).trim();
  const urlMatch = str.match(/gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]{20,40})/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  return str;
}

export async function handleAccount(body, request, env, services = {}) {
  const action = body.action;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const identifier = cleanIdentifier(body.identifier || body.email || '');
  const email = cleanIdentifier(body.email || (identifier.includes('@') ? identifier : '')).toLowerCase();
  if (action === 'logout') {
    await query(env, 'DELETE FROM sessions WHERE token_hash=?', await digest(cookieToken(request))).run();
    return {data: {}, cookie: sessionCookie('', request.url)};
  }
  if (action === 'register') {
    await rateLimit(env, 'register:' + ip, 5, 3600);
    const vault = body.vault || {};
    const address = String(vault.userEmail || '').trim().toLowerCase();
    const name = String(vault.userName || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || name.length < 2 || name.length > 100) throw new ApiError('Введите имя и корректный email.');
    if (await accountByIdentifier(env, address) || await legacyVault(env, address)) throw new ApiError('Профиль с этим email уже существует. Войдите или восстановите пароль.', 409);
    const account = {id: randomBytes(16).toString('hex'), email: address, name,
      password: await passwordRecord(body.password), version: randomToken(), created_at: new Date().toISOString()};
    await env.DB.batch([
      query(env, 'INSERT INTO accounts(id,email,name,password,version,created_at) VALUES(?,?,?,?,?,?)', account.id, address, name, account.password, account.version, account.created_at),
      ...chunkStatements(env, account.id, vault)
    ]);
    return {data: await publicVault(env, account), cookie: await newSession(env, account, request.url)};
  }
  if (action === 'login') {
    await rateLimit(env, 'login-ip:' + ip, 30, 900);
    await rateLimit(env, 'login-account:' + identifier.toLowerCase(), 10, 900);
    let account = await accountByIdentifier(env, identifier);
    if (!account) {
      const legacy = await legacyVault(env, identifier);
      if (legacy && await legacyPasswordMatches(legacy, body.password)) account = await importLegacy(env, legacy, body.password);
      else throw new ApiError('Неверный email, код профиля или пароль.', 401);
    } else if (!await passwordMatches(body.password, account.password)) {
      throw new ApiError('Неверный email, код профиля или пароль.', 401);
    }
    if (account.password.startsWith('legacy$')) {
      const upgraded = await passwordRecord(body.password, true);
      const changed = await query(env, 'UPDATE accounts SET password=? WHERE id=? AND password=? RETURNING id', upgraded, account.id, account.password).first();
      if (!changed) throw new ApiError('Профиль обновлён. Повторите вход.', 409);
      account.password = upgraded;
    }
    return {data: await publicVault(env, account), cookie: await newSession(env, account, request.url)};
  }
  if (action === 'reset-request') {
    required(env, 'SMTP_USER'); required(env, 'SMTP_PASSWORD');
    await rateLimit(env, 'reset-ip:' + ip, 10, 3600);
    await rateLimit(env, 'reset-address:' + email, 10, 86400);
    let account = await accountByIdentifier(env, identifier);
    if (!account) {
      const legacy = await legacyVault(env, identifier);
      if (legacy?.userEmail?.toLowerCase() === email) account = await importLegacy(env, legacy, null);
    }
    if (!account || account.email.toLowerCase() !== email) return {data: {sent: true}};
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const codeHash = await digest(required(env, 'AUTH_SECRET') + ':' + account.id + ':' + code);
    const updated = await query(env, `UPDATE accounts SET reset_hash=?,reset_expires=?,reset_attempts=5,reset_sent_at=?
      WHERE id=? AND reset_sent_at<=? RETURNING id`, codeHash, now() + 900, now(), account.id, now() - 60).first();
    if (!updated) throw new ApiError('Подождите минуту перед повторной отправкой.', 429);
    try { await (services.sendRecovery || sendRecovery)(env, email, code); }
    catch (error) {
      await query(env, 'UPDATE accounts SET reset_hash=NULL,reset_attempts=0,reset_sent_at=0 WHERE id=? AND reset_hash=?', account.id, codeHash).run();
      throw error;
    }
    return {data: {sent: true}};
  }
  if (action === 'reset-confirm') {
    await rateLimit(env, 'reset-verify:' + ip, 30, 900);
    const account = await accountByIdentifier(env, identifier);
    if (!account || account.email.toLowerCase() !== email) throw new ApiError('Код неверен или истёк. Запросите новое письмо.');
    const attempted = await query(env, `UPDATE accounts SET reset_attempts=reset_attempts-1
      WHERE id=? AND reset_attempts>0 AND reset_expires>? RETURNING reset_hash`, account.id, now()).first();
    const codeHash = await digest(required(env, 'AUTH_SECRET') + ':' + account.id + ':' + String(body.code || '').trim());
    if (!attempted?.reset_hash || !equal(attempted.reset_hash, codeHash)) throw new ApiError('Код неверен или истёк. Запросите новое письмо.');
    const password = await passwordRecord(body.password);
    const version = randomToken();
    // One atomic compare-and-set consumes the code and invalidates previous sessions.
    const changed = await query(env, `UPDATE accounts SET password=?,version=?,reset_hash=NULL,reset_attempts=0
      WHERE id=? AND reset_hash=? AND reset_expires>? RETURNING id`, password, version, account.id, codeHash, now()).first();
    if (!changed) throw new ApiError('Код уже использован. Войдите с новым паролем.');
    account.password = password; account.version = version;
    return {data: await publicVault(env, account), cookie: await newSession(env, account, request.url)};
  }
  const account = await authenticate(request, env);
  if (identifier && identifier.toLowerCase() !== account.id.toLowerCase() && identifier.toLowerCase() !== account.email.toLowerCase()) {
    throw new ApiError('Нет доступа к другому профилю.', 403);
  }
  if (action === 'read') return {data: await publicVault(env, account)};
  if (action === 'sync') {
    await rateLimit(env, 'sync:' + account.id, 60, 60);
    await env.DB.batch(chunkStatements(env, account.id, body.vault || {}));
    return {data: await publicVault(env, account)};
  }
  throw new ApiError('Неизвестная операция.');
}

export async function cleanup(env) {
  await env.DB.batch([
    query(env, 'DELETE FROM sessions WHERE expires<?', now()),
    query(env, 'DELETE FROM rate_limits WHERE expires<?', now())
  ]);
}
