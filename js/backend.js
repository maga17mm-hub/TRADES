/* GitHub Pages keeps the existing IndexedDB; only API calls go to Cloudflare. */
const TRADELOG_API_ORIGIN = location.hostname === 'maga17mm-hub.github.io'
  ? 'https://tradelog.maga17mm-trades.workers.dev' : '';
const TRADELOG_SESSION_KEY = 'tradelog_cloud_session';

function tradeLogApiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (TRADELOG_API_ORIGIN) {
    const token = sessionStorage.getItem(TRADELOG_SESSION_KEY);
    if (token) headers.set('Authorization', 'Bearer ' + token);
  }
  return fetch(TRADELOG_API_ORIGIN + path, {
    ...options, headers, credentials: TRADELOG_API_ORIGIN ? 'omit' : 'same-origin'
  });
}
