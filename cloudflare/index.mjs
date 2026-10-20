import {ApiError, authenticate, cleanup, handleAccount, rateLimit, required} from './accounts.mjs';
import {synthesize} from './speech.mjs';
import {transcribe} from './transcribe.mjs';

function json(data, status = 200, cookie) {
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(data), {status, headers});
}
export function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  const trustedPages = origin === 'https://maga17mm-hub.github.io' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  if ((origin && origin !== new URL(request.url).origin && !trustedPages) ||
      (request.headers.get('Sec-Fetch-Site') === 'cross-site' && !trustedPages))
    throw new ApiError('Запрос с другого сайта запрещён.', 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError('Ожидается JSON.', 415);
}
export async function api(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/status' && request.method === 'GET')
    return json({server: true, mail: !!(env.SMTP_USER && env.SMTP_PASSWORD), ai: !!env.AI_API_KEY, voice: 'ru_RU-dmitri-medium', transcription: !!env.AI});
  if (request.method !== 'POST') return json({error: 'Используйте POST.'}, 405);
  checkOrigin(request);
  const text = await request.text();
  if (text.length > 19000000) throw new ApiError('Слишком большой запрос.', 413);
  let body;
  try { body = JSON.parse(text); } catch { throw new ApiError('Некорректный JSON.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError('Некорректный JSON.');
  if (url.pathname === '/api/account') {
    const {data, cookie} = await handleAccount(body, request, env);
    if (cookie) {
      const token = cookie.match(/^tradelog_session=([^;]+)/)?.[1];
      if (token) data.sessionToken = token;
    }
    return json(data, 200, cookie);
  }
  const account = await authenticate(request, env);
  if (url.pathname === '/api/transcribe') {
    await rateLimit(env, 'transcribe:' + account.id, 10, 60);
    await rateLimit(env, 'transcribe-day:' + account.id, 100, 86400);
    return json(await transcribe(body, env));
  }
  if (url.pathname === '/api/speech') {
    await rateLimit(env, 'speech:' + account.id, 30, 60);
    const speech = typeof body.text === 'string' ? body.text.trim() : '';
    if (!speech || speech.length > 2500) throw new ApiError('Для озвучки нужен текст до 2500 символов.');
    return new Response(await synthesize(speech, env), {headers: {'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store'}});
  }
  if (url.pathname === '/api/chat') {
    await rateLimit(env, 'chat:' + account.id, 10, 60);
    const base = (env.AI_BASE_URL || 'https://tooken.club/v1').replace(/\/$/, '');
    if (body.baseUrl && body.baseUrl.replace(/\/$/, '') !== base) throw new ApiError('Адрес ИИ должен совпадать с настройкой сервера.');
    const model = body.model || env.AI_MODEL || 'gpt-5.6-terra';
    if (!(env.AI_ALLOWED_MODELS || env.AI_MODEL || 'gpt-5.6-terra').split(',').map(x => x.trim()).includes(model)) throw new ApiError('Эта модель не разрешена на сервере.');
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20 ||
        body.messages.some(m => !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 30000)) throw new ApiError('Неверный формат сообщений.');
    const key = body.apiKey || required(env, 'AI_API_KEY');
    const response = await fetch(base + '/chat/completions', {method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
      body: JSON.stringify({model, messages: body.messages, temperature: 0.3, max_tokens: 1500}), signal: AbortSignal.timeout(35000)});
    if (!response.ok) throw new ApiError(response.status === 401 ? 'Сервис ИИ отклонил ключ. Обновите подключение в настройках.' : 'Сервис ИИ временно недоступен. Повторите позже.', 502);
    const result = await response.json();
    return json(result);
  }
  return json({error: 'Не найдено.'}, 404);
}
export default {
  async fetch(request, env) {
    let response;
    const origin = request.headers.get('Origin') || '';
    const pages = origin === 'https://maga17mm-hub.github.io' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    try {
      if (request.method === 'OPTIONS') response = new Response(null, {status: pages ? 204 : 403});
      else response = await api(request, env);
    }
    catch (error) {
      if (!(error instanceof ApiError)) console.error('API failure', error.name, error.message);
      response = json({error: error instanceof ApiError ? error.message : 'Сервис временно недоступен. Повторите позже.'}, error.status || 502);
    }
    if (pages) {
      response = new Response(response.body, response);
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Vary', 'Origin');
      response.headers.delete('Set-Cookie');
    }
    return response;
  },
  async scheduled(event, env) { await cleanup(env); }
};
