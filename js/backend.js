/* GitHub Pages keeps the existing IndexedDB; only API calls go to Cloudflare. */
const TRADELOG_API_ORIGIN = location.hostname === 'tradelog.maga17mm-trades.workers.dev'
  ? '' : 'https://tradelog.maga17mm-trades.workers.dev';
const TRADELOG_SESSION_KEY = 'tradelog_cloud_session';

function tradeLogApiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (TRADELOG_API_ORIGIN) {
    const token = sessionStorage.getItem(TRADELOG_SESSION_KEY);
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }
  const cleanOptions = { ...options };
  delete cleanOptions.headers;
  delete cleanOptions.cache;
  delete cleanOptions.credentials;
  return fetch(TRADELOG_API_ORIGIN + path, {
    ...cleanOptions,
    headers,
    credentials: TRADELOG_API_ORIGIN ? 'omit' : 'same-origin'
  });
}
