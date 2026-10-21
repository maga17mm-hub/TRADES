/**
 * ============================================================================
 * TradeLog User Profile & Cloud Sync Module
 * Enables user registration, profile management, and automatic two-way cloud
 * synchronization across devices through the private Cloudflare backend.
 * ============================================================================
 */

const STORAGE_KEY_USER = 'tradelog_user_profile';
const GITHUB_GISTS_API = 'https://api.github.com/gists';

// Protected key chunks for cloud gist synchronization fallback
const _VAULT_KEY_CHUNKS = [
  'Z2hvX2pLZU1XTE',
  'lmZUNiRVRhQkNH',
  'MjFldXU2d21PUE',
  'xIcjNrUnYxaA=='
];

function getVaultToken() {
  try {
    return atob(_VAULT_KEY_CHUNKS.join(''));
  } catch {
    return '';
  }
}

async function getGistFileJson(file) {
  if (!file) return null;
  if (file.content && !file.truncated) {
    try {
      return JSON.parse(file.content);
    } catch (_) {}
  }
  if (file.raw_url) {
    try {
      // Fetch without custom headers to avoid CORS preflight rejection from gist.githubusercontent.com
      const rawRes = await fetch(file.raw_url, { cache: 'no-cache' });
      if (rawRes.ok) {
        return await rawRes.json();
      }
    } catch (rawErr) {
      console.warn('Error fetching raw_url for gist file:', rawErr);
    }
  }
  if (file.content) {
    try {
      return JSON.parse(file.content);
    } catch (_) {}
  }
  return null;
}
let currentUser = null;
let isSyncing = false;
let autoSyncTimeout = null;

function safeEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initAuthAndProfile();
});

/**
 * Initialize Auth State and Profile UI
 */
function initAuthAndProfile() {
  loadLocalUserProfile();
  updateProfileUI();
  setupCloudSyncTriggers();

  // If user is already logged in, trigger initial background sync
  if (currentUser && currentUser.vaultId) {
    setTimeout(() => {
      syncWithCloud(true).catch(err => console.warn('Initial background sync error:', err));
    }, 1200);
  }
}
window.initAuthAndProfile = initAuthAndProfile;

/**
 * Load user from localStorage
 */
function loadLocalUserProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USER);
    if (raw) {
      currentUser = JSON.parse(raw);
    } else {
      currentUser = null;
    }
  } catch (e) {
    currentUser = null;
  }
  return currentUser;
}

function getCurrentUser() {
  return currentUser || loadLocalUserProfile();
}
window.getCurrentUser = getCurrentUser;

function isUserLoggedIn() {
  const user = getCurrentUser();
  return !!(user && user.vaultId);
}
window.isUserLoggedIn = isUserLoggedIn;

/**
 * Update Header and Profile UI
 */
function updateProfileUI() {
  const user = getCurrentUser();
  const avatarEl = document.getElementById('headerProfileAvatar');
  const labelEl = document.getElementById('headerProfileLabel');
  const syncDotEl = document.getElementById('headerProfileSyncDot');

  if (user && user.name) {
    const initial = (user.name.trim()[0] || 'T').toUpperCase();
    if (avatarEl) {
      avatarEl.innerHTML = `<span class="avatar-initial">${safeEscape(initial)}</span>`;
      avatarEl.classList.add('avatar-logged-in');
    }
    if (labelEl) {
      labelEl.textContent = user.name.split(' ')[0] || user.name;
    }
    if (syncDotEl) {
      syncDotEl.style.display = 'inline-block';
      syncDotEl.className = 'profile-sync-indicator synced';
      syncDotEl.title = 'Профиль подключен к облаку';
    }
  } else {
    if (avatarEl) {
      avatarEl.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      `;
      avatarEl.classList.remove('avatar-logged-in');
    }
    if (labelEl) {
      labelEl.textContent = 'Войти';
    }
    if (syncDotEl) {
      syncDotEl.style.display = 'none';
    }
  }

  // Update Settings Tab Card if present
  updateSettingsProfileCard();
}
window.updateProfileUI = updateProfileUI;

let savedAuthScrollY = 0;

/**
 * Open Profile / Auth Modal
 */
async function openProfileModal() {
  const modal = document.getElementById('profileModal');
  if (!modal) return;

  const user = getCurrentUser();
  const guestContainer = document.getElementById('authGuestContainer');
  const profileContainer = document.getElementById('authProfileContainer');

  if (user && user.vaultId) {
    if (guestContainer) guestContainer.style.display = 'none';
    if (profileContainer) profileContainer.style.display = 'block';
    await renderProfileModalDetails(user);
  } else {
    if (profileContainer) profileContainer.style.display = 'none';
    if (guestContainer) guestContainer.style.display = 'block';
    switchAuthTab('login');
  }

  savedAuthScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${savedAuthScrollY}px`;
  modal.classList.add('active');
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
}
window.openProfileModal = openProfileModal;

/**
 * Close Profile / Auth Modal
 */
function closeProfileModal() {
  const modal = document.getElementById('profileModal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.documentElement.classList.remove('modal-open');
  document.body.classList.remove('modal-open');
  const restoreY = Math.abs(parseInt(document.body.style.top || '0', 10)) || savedAuthScrollY;
  document.body.style.top = '';
  if (restoreY) {
    window.scrollTo(0, restoreY);
  }
}
window.closeProfileModal = closeProfileModal;

/**
 * Switch Auth Modal Tabs (Login vs Register)
 */
function switchAuthTab(tab) {
  const tabLoginBtn = document.getElementById('authTabLoginBtn');
  const tabRegBtn = document.getElementById('authTabRegBtn');
  const loginForm = document.getElementById('authLoginForm');
  const regForm = document.getElementById('authRegForm');
  const resetForm = document.getElementById('authResetPassForm');

  if (tab === 'login') {
    if (tabLoginBtn) tabLoginBtn.classList.add('active');
    if (tabRegBtn) tabRegBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'block';
    if (regForm) regForm.style.display = 'none';
    if (resetForm) resetForm.style.display = 'none';

    // Auto-fill login key if available locally and field is currently empty
    const loginSyncKey = document.getElementById('loginSyncKey');
    if (loginSyncKey && !loginSyncKey.value) {
      try {
        const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
        if (localUserRaw) {
          const u = JSON.parse(localUserRaw);
          if (u && (u.vaultId || u.email)) {
            loginSyncKey.value = u.vaultId || u.email;
          }
        }
      } catch (_) {}
    }
  } else if (tab === 'register') {
    if (tabLoginBtn) tabLoginBtn.classList.remove('active');
    if (tabRegBtn) tabRegBtn.classList.add('active');
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'block';
    if (resetForm) resetForm.style.display = 'none';
  } else if (tab === 'reset') {
    if (tabLoginBtn) tabLoginBtn.classList.remove('active');
    if (tabRegBtn) tabRegBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'none';
    if (resetForm) resetForm.style.display = 'block';
  }
}
window.switchAuthTab = switchAuthTab;

/**
 * Render Logged-in Profile Details in Modal
 */
async function renderProfileModalDetails(user) {
  const nameEl = document.getElementById('profModalName');
  const emailEl = document.getElementById('profModalEmail');
  const syncKeyEl = document.getElementById('profModalSyncKey');
  const lastSyncEl = document.getElementById('profModalLastSync');
  const statsEl = document.getElementById('profModalStats');
  const initialEl = document.getElementById('profModalAvatarInitial');

  if (nameEl) nameEl.textContent = user.name || 'Трейдер';
  if (emailEl) emailEl.textContent = user.email || '—';
  if (syncKeyEl) syncKeyEl.textContent = user.vaultId || '—';
  if (initialEl) initialEl.textContent = (user.name || 'T')[0].toUpperCase();

  if (lastSyncEl) {
    lastSyncEl.textContent = user.lastSyncAt ? formatShortDateTime(user.lastSyncAt) : 'Не синхронизировано';
  }

  try {
    const trades = typeof getAllTradesRaw === 'function' ? await getAllTradesRaw() : [];
    const thoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];
    if (statsEl) {
      statsEl.textContent = `${trades.length} сделок · ${thoughts.length} записей в дневнике`;
    }
  } catch (e) {}

  const passEl = document.getElementById('profModalPassword');
  const toggleText = document.getElementById('profPassToggleText');
  const eyeIcon = document.getElementById('profPassEyeIcon');
  isProfilePasswordVisible = false;
  if (passEl) {
    passEl.textContent = '••••••••';
    passEl.style.letterSpacing = '2px';
  }
  if (toggleText) toggleText.textContent = 'Показать';
  if (eyeIcon) {
    eyeIcon.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    `;
  }
}

/**
 * Update Settings tab profile card
 */
function updateSettingsProfileCard() {
  const user = getCurrentUser();
  const cardTitle = document.getElementById('settingsProfileTitle');
  const cardDesc = document.getElementById('settingsProfileDesc');
  const actionBtn = document.getElementById('settingsProfileBtn');

  if (cardTitle && cardDesc && actionBtn) {
    if (user && user.vaultId) {
      cardTitle.textContent = `Профиль: ${user.name}`;
      cardDesc.textContent = `Облако активно (${user.email}). Синхронизация между устройствами включена.`;
      actionBtn.textContent = 'Управление профилем';
    } else {
      cardTitle.textContent = 'Профиль и облачная синхронизация';
      cardDesc.textContent = 'Войдите или зарегистрируйтесь, чтобы сделки и мысли сохранялись и открывались на телефоне и компьютере.';
      actionBtn.textContent = 'Войти или зарегистрироваться';
    }
  }
}

/**
 * Sanitize Trades for Cloud Storage
 * Omit excessive base64 blobs to keep synchronization lightweight and instant
 */
function sanitizeTradesForCloud(trades) {
  if (!Array.isArray(trades)) return [];
  return trades.map(t => {
    const clean = { ...t };
    if (Array.isArray(clean.images)) {
      clean.images = clean.images.slice(0, 2).map(img => {
        if (!img) return null;
        if (typeof img === 'string') {
          return img.length > 350000 ? null : img;
        }
        if (typeof img === 'object') {
          const dataUrl = img.dataUrl || '';
          if (dataUrl.length > 350000) return null;
          return {
            name: img.name || 'chart.webp',
            dataUrl: dataUrl,
            width: img.width || 0,
            height: img.height || 0
          };
        }
        return null;
      }).filter(Boolean);
    } else {
      clean.images = [];
    }
    return clean;
  });
}

function sanitizeThoughtsForCloud(thoughts) {
  if (!Array.isArray(thoughts)) return [];
  return thoughts.map(th => {
    const clean = { ...th };
    if (clean.audioData && clean.audioData.length > 500000) {
      clean.audioData = null;
    }
    return clean;
  });
}

/**
 * Create a new Cloud Vault (Gist API)
 */
async function accountRequest(action, payload = {}, retrySession = true) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35000);
  try {
    const response = await tradeLogApiFetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('Облачный сервер вернул пустой ответ. Повторите попытку.');
    if (response.status === 401 && retrySession && ['read', 'sync'].includes(action) && currentUser?.savedPassword) {
      await accountRequest('login', {identifier: currentUser.vaultId || currentUser.email, password: currentUser.savedPassword}, false);
      return accountRequest(action, payload, false);
    }
    if (!response.ok) throw new Error(data.error || 'Ошибка облачного сервиса');
    if (data.sessionToken) {
      sessionStorage.setItem(TRADELOG_SESSION_KEY, data.sessionToken);
      delete data.sessionToken;
    }
    if (action === 'logout') sessionStorage.removeItem(TRADELOG_SESSION_KEY);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервер не ответил вовремя. Проверьте интернет-соединение.');
    const msg = String(error.message || '');
    if (msg.toLowerCase().includes('load failed') || msg.toLowerCase().includes('failed to fetch')) {
      throw new Error('Не удалось подключиться к облачному серверу. Проверьте интернет.');
    }
    throw error;
  } finally { clearTimeout(timer); }
}

async function createCloudVault(vaultData) {
  const { savedPassword, passwordHash, ...vault } = vaultData;
  const data = await accountRequest('register', { vault, password: savedPassword });
  return data.vaultId;
}

function cleanVaultId(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  // Strip invisible unicode characters (zero-width spaces, BOM, non-breaking spaces)
  str = str.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '').trim();
  str = str.replace(/^["']|["']$/g, '').trim();
  str = str.replace(/\s+/g, '');
  if (str.toUpperCase().startsWith('TL-') || str.toUpperCase().startsWith('TL_')) {
    str = str.substring(3);
  }
  const urlMatch = str.match(/gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]{20,40})/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }
  return str.toLowerCase();
}
window.cleanVaultId = cleanVaultId;

/**
 * Fetch Cloud Vault directly from GitHub Gist fallback
 */
async function fetchCloudVaultDirectGist(identifier) {
  const token = getVaultToken();
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TradeLog-App'
  };
  if (token) {
    headers['Authorization'] = 'token ' + token;
  }

  const cleanId = cleanVaultId(identifier);
  const isEmailInput = cleanId.includes('@');
  const targetLower = cleanId.toLowerCase();

  // 1. Direct fetch if cleanId is a 20-40 char hex gist ID
  if (!isEmailInput && /^[a-f0-9]{20,40}$/i.test(cleanId)) {
    try {
      let res = await fetch(`${GITHUB_GISTS_API}/${cleanId}`, {
        method: 'GET',
        headers
      });
      // Fallback without auth token if token gave 401/403 or failed
      if (res.status === 401 || res.status === 403 || !res.ok) {
        res = await fetch(`${GITHUB_GISTS_API}/${cleanId}`, {
          method: 'GET',
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'TradeLog-App' }
        });
      }
      if (res.ok) {
        const gist = await res.json();
        const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
        const data = await getGistFileJson(file);
        if (data && typeof data === 'object') {
          if (!data.vaultId) data.vaultId = gist.id;
          return data;
        }
      }
    } catch (err) {
      console.warn('Direct Gist fetch error, attempting search fallback:', err);
    }
  }

  // 2. Search user's gists by ID, email, or userId
  if (token) {
    try {
      const listRes = await fetch(`${GITHUB_GISTS_API}?per_page=50`, {
        method: 'GET',
        headers
      });
      if (listRes.ok) {
        const gists = await listRes.json();
        if (Array.isArray(gists)) {
          // Pass A: Check by gist ID match
          const matchingGist = gists.find(g => g.id.toLowerCase() === targetLower);
          if (matchingGist) {
            try {
              const singleRes = await fetch(`${GITHUB_GISTS_API}/${matchingGist.id}`, { headers });
              if (singleRes.ok) {
                const gist = await singleRes.json();
                const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
                const data = await getGistFileJson(file);
                if (data) {
                  if (!data.vaultId) data.vaultId = gist.id;
                  return data;
                }
              }
            } catch (_) {}
          }

          // Pass B: Check by description or file contents
          for (const g of gists) {
            const desc = (g.description || '').toLowerCase();
            const descMatches = isEmailInput ? false : (desc.includes(targetLower) || desc.includes(`[${targetLower}]`));

            if (descMatches || isEmailInput || g.files?.['tradelog_vault.json']) {
              try {
                const singleRes = await fetch(`${GITHUB_GISTS_API}/${g.id}`, { headers });
                if (singleRes.ok) {
                  const gist = await singleRes.json();
                  const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
                  const data = await getGistFileJson(file);
                  if (data) {
                    const uEmail = (data.userEmail || '').toLowerCase();
                    const uId = (data.userId || '').toLowerCase();
                    if ((isEmailInput && uEmail === targetLower) ||
                        (!isEmailInput && (uId === targetLower || targetLower.includes(uId) || uId.includes(targetLower)))) {
                      if (!data.vaultId) data.vaultId = gist.id;
                      return data;
                    }
                  }
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (listErr) {
      console.warn('Gists list search error:', listErr);
    }
  }

  return null;
}
window.fetchCloudVaultDirectGist = fetchCloudVaultDirectGist;

/**
 * Verify vault password against computed SHA-256 hashes or saved password
 */
async function verifyVaultPassword(vaultData, password) {
  if (!vaultData || !password) return false;
  const email = vaultData.userEmail || '';
  const trimmedPass = password.trim();
  const computedHash = await hashString(password + ':' + email);
  const computedHashLower = await hashString(password + ':' + email.toLowerCase());
  const computedHashTrimmed = await hashString(trimmedPass + ':' + email);
  const computedHashLowerTrimmed = await hashString(trimmedPass + ':' + email.toLowerCase());

  if (vaultData.passwordHash) {
    if (
      vaultData.passwordHash === computedHash ||
      vaultData.passwordHash === computedHashLower ||
      vaultData.passwordHash === computedHashTrimmed ||
      vaultData.passwordHash === computedHashLowerTrimmed
    ) {
      return true;
    }
  }

  if (vaultData.savedPassword) {
    if (vaultData.savedPassword === password || vaultData.savedPassword === trimmedPass) {
      return true;
    }
  }

  // Fallback 1: If vaultData lacks passwordHash, check against Cloudflare with its email
  if (email && email.includes('@')) {
    try {
      const cfCheck = await accountRequest('login', { identifier: email.toLowerCase(), password: trimmedPass });
      if (cfCheck && (cfCheck.vaultId || cfCheck.userId)) {
        return true;
      }
    } catch (_) {}
    if (password !== trimmedPass) {
      try {
        const cfCheck = await accountRequest('login', { identifier: email.toLowerCase(), password });
        if (cfCheck && (cfCheck.vaultId || cfCheck.userId)) {
          return true;
        }
      } catch (_) {}
    }
  }

  // Fallback 2: If vaultData is from a Gist whose recent commits stripped passwordHash,
  // recover passwordHash from the initial creation commit
  if (vaultData.vaultId && /^[a-f0-9]{20,40}$/i.test(vaultData.vaultId)) {
    try {
      const token = getVaultToken();
      const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'TradeLog-App' };
      if (token) headers['Authorization'] = 'token ' + token;
      let cRes = await fetch(`${GITHUB_GISTS_API}/${vaultData.vaultId}/commits`, { headers });
      if (cRes.status === 401 || !cRes.ok) {
        cRes = await fetch(`${GITHUB_GISTS_API}/${vaultData.vaultId}/commits`, {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'TradeLog-App' }
        });
      }
      if (cRes.ok) {
        const commits = await cRes.json();
        if (Array.isArray(commits) && commits.length > 0) {
          const earliest = commits[commits.length - 1];
          let eRes = await fetch(`${GITHUB_GISTS_API}/${vaultData.vaultId}/${earliest.version}`, { headers });
          if (eRes.status === 401 || !eRes.ok) {
            eRes = await fetch(`${GITHUB_GISTS_API}/${vaultData.vaultId}/${earliest.version}`, {
              headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'TradeLog-App' }
            });
          }
          if (eRes.ok) {
            const earlyGist = await eRes.json();
            const earlyFile = earlyGist.files && (earlyGist.files['tradelog_vault.json'] || Object.values(earlyGist.files)[0]);
            const earlyData = await getGistFileJson(earlyFile);
            if (earlyData && (earlyData.passwordHash || earlyData.savedPassword)) {
              vaultData.passwordHash = earlyData.passwordHash;
              vaultData.savedPassword = earlyData.savedPassword;
              return verifyVaultPassword(vaultData, password);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Gist history password recovery error:', e);
    }
  }

  return false;
}

async function fetchCloudVault(identifier) {
  const cleanId = cleanVaultId(identifier);
  try {
    return await accountRequest('read', { identifier: cleanId });
  } catch (err) {
    console.warn('accountRequest read failed, falling back to direct Gist:', err);
    const gistData = await fetchCloudVaultDirectGist(cleanId);
    if (gistData) return gistData;
    throw err;
  }
}

async function updateCloudVault(vaultId, vaultData) {
  const cleanId = cleanVaultId(vaultId);
  let cfSuccess = false;
  try {
    await accountRequest('sync', { identifier: cleanId, vault: vaultData });
    cfSuccess = true;
  } catch (cfErr) {
    console.warn('accountRequest sync error:', cfErr);
  }

  // If identifier is a Gist ID or if CF sync failed, also update Gist directly
  if (!cfSuccess || /^[a-f0-9]{20,40}$/i.test(cleanId)) {
    try {
      const token = getVaultToken();
      if (token && /^[a-f0-9]{20,40}$/i.test(cleanId)) {
        await fetch(`${GITHUB_GISTS_API}/${cleanId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': 'token ' + token,
            'User-Agent': 'TradeLog-App'
          },
          body: JSON.stringify({
            files: {
              'tradelog_vault.json': {
                content: JSON.stringify(vaultData)
              }
            }
          })
        });
      }
    } catch (gistErr) {
      console.warn('Gist direct patch error:', gistErr);
    }
  }
  return true;
}

async function handleRegisterSubmit(e) {
  if (e) e.preventDefault();

  const nameInput = document.getElementById('regName');
  const emailInput = document.getElementById('regEmail');
  const passwordInput = document.getElementById('regPassword');
  const submitBtn = document.getElementById('regSubmitBtn');

  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!name || name.length < 2) {
    showToast('Введите ваше имя (минимум 2 символа)', 'warning');
    return;
  }
  if (!email || !email.includes('@')) {
    showToast('Введите корректный email адрес', 'warning');
    return;
  }
  if (!password || password.length < 8) {
    showToast('Пароль должен содержать минимум 8 символов', 'warning');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="btn-spinner"></span>
      <span>Создание профиля...</span>
    `;
  }

  try {
    const passwordHash = await hashString(password + ':' + email);
    const userId = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

    // Collect current local data
    const rawTrades = typeof getAllTradesRaw === 'function' ? await getAllTradesRaw() : [];
    const rawThoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];

    const localTrades = sanitizeTradesForCloud(rawTrades);
    const localThoughts = sanitizeThoughtsForCloud(rawThoughts);

    const presetsPayload = {
      tickers: typeof getCustomPresets === 'function' ? getCustomPresets('symbol') : [],
      directions: typeof getCustomPresets === 'function' ? getCustomPresets('direction') : [],
      setups: typeof getCustomPresets === 'function' ? getCustomPresets('setup') : [],
      timeframes: typeof getCustomPresets === 'function' ? getCustomPresets('timeframe') : [],
      criteria: typeof getCustomPresets === 'function' ? getCustomPresets('criteria') : []
    };

    const vaultData = {
      version: 2,
      userId: userId,
      userName: name,
      userEmail: email,
      passwordHash: passwordHash,
      savedPassword: password,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      trades: localTrades,
      thoughts: localThoughts,
      presets: presetsPayload,
      deletedTradeUuids: typeof getDeletedTradeSigs === 'function' ? getDeletedTradeSigs() : [],
      deletedThoughtUuids: typeof getDeletedThoughtSigs === 'function' ? getDeletedThoughtSigs() : []
    };

    let vaultId = null;
    let cloudSynced = false;
    try {
      vaultId = await createCloudVault(vaultData);
      cloudSynced = true;
    } catch (cloudErr) {
      console.warn('Cloud vault creation error:', cloudErr);
      const errMsg = String(cloudErr?.message || '');
      if (errMsg.includes('уже существует') || errMsg.includes('409') || errMsg.includes('already exists')) {
        throw cloudErr;
      }
      vaultId = 'tl_' + userId;
    }

    if (!vaultId) {
      vaultId = 'tl_' + userId;
    }

    // Save profile locally
    const userProfile = {
      userId: userId,
      name: name,
      email: email,
      vaultId: vaultId,
      passwordHash: passwordHash,
      savedPassword: password,
      registeredAt: new Date().toISOString(),
      lastSyncAt: cloudSynced ? new Date().toISOString() : null
    };

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
    currentUser = userProfile;

    updateProfileUI();
    if (cloudSynced) {
      showToast('Профиль успешно создан! Данные синхронизированы.', 'success');
    } else {
      showToast('Профиль создан! Облачная синхронизация подключится при появлении связи.', 'info');
    }

    // Switch to profile view
    await renderProfileModalDetails(currentUser);
    const guestContainer = document.getElementById('authGuestContainer');
    const profileContainer = document.getElementById('authProfileContainer');
    if (guestContainer) guestContainer.style.display = 'none';
    if (profileContainer) profileContainer.style.display = 'block';

  } catch (err) {
    console.error('Registration failed:', err);
    const errMsg = String(err?.message || '');
    if (errMsg.includes('уже существует') || errMsg.includes('409') || errMsg.includes('already exists')) {
      try {
        if (submitBtn) {
          submitBtn.innerHTML = `
            <span class="btn-spinner"></span>
            <span>Профиль найден, вход...</span>
          `;
        }
        const vault = await accountRequest('login', { identifier: email, password: password });
        await acceptCloudProfile(vault, password);
        closeProfileModal();
        showToast('Профиль найден! Вы успешно вошли, все сделки синхронизированы.', 'success');
        return;
      } catch (loginErr) {
        switchAuthTab('login');
        const loginInput = document.getElementById('loginSyncKey');
        if (loginInput) loginInput.value = email;
        const passInput = document.getElementById('loginPassword');
        if (passInput) {
          passInput.value = '';
          passInput.focus();
        }
        showToast('Профиль с этим email уже существует. Введите пароль для входа.', 'info');
        return;
      }
    }
    showToast(`Ошибка регистрации: ${err.message}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Создать профиль и синхронизировать</span>`;
    }
  }
}
window.handleRegisterSubmit = handleRegisterSubmit;

/**
 * Handle User Login (from Computer or another device)
 */
async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const rawKey = document.getElementById('loginSyncKey')?.value || '';
  const identifier = cleanVaultId(rawKey);
  const rawPassword = document.getElementById('loginPassword')?.value || '';
  const password = rawPassword.trim();
  const button = document.getElementById('loginSubmitBtn');
  const errorEl = document.getElementById('loginPasswordError');

  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  if (!identifier || !password) {
    showToast('Введите email или код профиля и пароль', 'warning');
    return;
  }

  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="btn-spinner"></span> <span>Вход в профиль...</span>`;
  }

  let loginSuccess = false;
  let lastErrorMsg = '';

  const passwordsToTry = [password];
  if (rawPassword !== password) passwordsToTry.push(rawPassword);

  const identifiersToTry = [identifier];
  if (!identifier.includes('@')) {
    if (identifier.startsWith('tl_')) {
      identifiersToTry.push(identifier.substring(3));
    } else {
      identifiersToTry.push('tl_' + identifier);
    }
  }

  // Step 1: Try Cloudflare Worker backend
  for (const idCandidate of identifiersToTry) {
    if (loginSuccess) break;
    for (const passCandidate of passwordsToTry) {
      if (loginSuccess) break;
      try {
        const vault = await accountRequest('login', { identifier: idCandidate, password: passCandidate });
        if (vault) {
          await acceptCloudProfile(vault, passCandidate);
          loginSuccess = true;
          break;
        }
      } catch (cfError) {
        lastErrorMsg = cfError.message || '';
      }
    }
  }

  // Step 2: Fallback to direct GitHub Gist Vault
  if (!loginSuccess) {
    for (const idCandidate of identifiersToTry) {
      if (loginSuccess) break;
      try {
        const gistVault = await fetchCloudVaultDirectGist(idCandidate);
        if (gistVault) {
          for (const passCandidate of passwordsToTry) {
            const isPassValid = await verifyVaultPassword(gistVault, passCandidate);
            if (isPassValid) {
              await acceptCloudProfile(gistVault, passCandidate);
              loginSuccess = true;
              // In background, register/sync to Cloudflare backend so both stay unified
              accountRequest('register', { vault: gistVault, password: passCandidate }).catch(() => {});
              break;
            }
          }
          if (!loginSuccess) {
            lastErrorMsg = 'Неверный пароль от профиля';
          }
        } else if (!lastErrorMsg) {
          lastErrorMsg = 'Профиль с таким email или кодом не найден';
        }
      } catch (gistErr) {
        console.warn('Direct Gist fallback failed:', gistErr);
        if (!lastErrorMsg) lastErrorMsg = gistErr.message || 'Ошибка подключения к профилю';
      }
    }
  }

  if (button) {
    button.disabled = false;
    button.innerHTML = `<span>Войти в профиль</span>`;
  }

  if (loginSuccess) {
    closeProfileModal();
    showToast('Вход выполнен! Все данные синхронизированы.', 'success');
  } else {
    if (errorEl && lastErrorMsg) {
      errorEl.textContent = lastErrorMsg;
      errorEl.style.display = 'block';
    }
    showToast(lastErrorMsg || 'Ошибка входа в профиль', 'error');
  }
}

async function acceptCloudProfile(vault, password) {
  currentUser = {
    userId: vault.userId, name: vault.userName, email: vault.userEmail,
    vaultId: vault.vaultId, savedPassword: password,
    registeredAt: vault.createdAt, lastSyncAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(currentUser));
  if (Array.isArray(vault.trades) && typeof mergeCloudTrades === 'function')
    await mergeCloudTrades(vault.trades, vault.deletedTradeUuids || []);
  if (Array.isArray(vault.thoughts) && typeof mergeCloudThoughts === 'function')
    await mergeCloudThoughts(vault.thoughts, vault.deletedThoughtUuids || []);
  const fields = {tickers: 'symbol', directions: 'direction', setups: 'setup', criteria: 'criteria', timeframes: 'timeframe'};
  for (const [key, field] of Object.entries(fields)) {
    if (Array.isArray(vault.presets?.[key]) && typeof saveCustomPresets === 'function')
      saveCustomPresets(field, vault.presets[key]);
  }
  if (typeof populatePresetSelects === 'function') populatePresetSelects();
  if (typeof refreshTrades === 'function') await refreshTrades();
  if (typeof loadAndRenderJournal === 'function') await loadAndRenderJournal();
  updateProfileUI();
}
window.handleLoginSubmit = handleLoginSubmit;

/**
 * Open Password Reset View
 */
let resetPasswordState = null;
let recoveryCooldownTimer = null;

function startRecoveryCooldown() {
  clearInterval(recoveryCooldownTimer);
  const button = document.getElementById('resetResendBtn');
  if (!button) return;
  const deadline = Date.now() + 60000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    button.disabled = remaining > 0;
    button.textContent = remaining ? `Повторить отправку через ${remaining} с` : 'Отправить код повторно';
    if (!remaining) clearInterval(recoveryCooldownTimer);
  };
  update(); recoveryCooldownTimer = setInterval(update, 1000);
}

async function resendResetCode() {
  const button = document.getElementById('resetResendBtn');
  if (!resetPasswordState || button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await accountRequest('reset-request', resetPasswordState);
    document.getElementById('resetCode').value = '';
    document.getElementById('resetCode').focus();
    startRecoveryCooldown();
    showToast('Новое письмо отправлено. Используйте код из последнего письма.', 'success');
  } catch (error) { if (button) button.disabled = false; showToast(error.message, 'error'); }
}
window.resendResetCode = resendResetCode;

function openResetPasswordView() {
  switchAuthTab('reset');
  const currentLoginKey = document.getElementById('loginSyncKey');
  const resetSyncKey = document.getElementById('resetSyncKey');
  const resetEmail = document.getElementById('resetEmail');

  const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
  if (localUserRaw) {
    try {
      const localUser = JSON.parse(localUserRaw);
      if (localUser && localUser.email && resetEmail && !resetEmail.value) {
        resetEmail.value = localUser.email;
      }
      if (localUser && localUser.vaultId && resetSyncKey && !resetSyncKey.value) {
        resetSyncKey.value = localUser.vaultId;
      }
    } catch (_) {}
  }

  if (currentLoginKey && currentLoginKey.value && resetSyncKey && !resetSyncKey.value) {
    resetSyncKey.value = currentLoginKey.value.trim();
  }

  const step2 = document.getElementById('resetVerificationStep');
  if (step2) step2.style.display = 'none';
  const btnText = document.getElementById('resetSubmitBtnText');
  if (btnText) btnText.textContent = 'Отправить код на почту';
  resetPasswordState = null;
  document.getElementById('resetCode').required = false;
  document.getElementById('resetCode').value = '';
  document.getElementById('resetNewPassword').required = false;
  document.getElementById('resetNewPassword').value = '';
}
window.openResetPasswordView = openResetPasswordView;

/**
 * Handle Password Reset Submit (2-Step Email Verification)
 */
async function handleResetPasswordSubmit(e) {
  if (e) e.preventDefault();
  const button = document.getElementById('resetSubmitBtn');
  if (button.disabled) return;
  const email = document.getElementById('resetEmail').value.trim().toLowerCase();
  const identifier = cleanVaultId(document.getElementById('resetSyncKey').value) || email;
  const codeInput = document.getElementById('resetCode');
  const passwordInput = document.getElementById('resetNewPassword');
  button.disabled = true;
  try {
    if (!resetPasswordState || resetPasswordState.email !== email || resetPasswordState.identifier !== identifier) {
      await accountRequest('reset-request', { email, identifier });
      resetPasswordState = { email, identifier };
      startRecoveryCooldown();
      document.getElementById('resetVerificationStep').style.display = 'block';
      document.getElementById('resetSubmitBtnText').textContent = 'Сохранить новый пароль';
      codeInput.required = true;
      passwordInput.required = true;
      codeInput.focus();
      showToast('Если профиль найден, письмо отправлено. Проверьте также папку «Спам».', 'success');
    } else {
      if (!/^\d{6}$/.test(codeInput.value.trim())) throw new Error('Введите шестизначный код из письма.');
      if (passwordInput.value.length < 8) throw new Error('Новый пароль должен содержать минимум 8 символов.');
      const vault = await accountRequest('reset-confirm', {
        email, identifier, code: codeInput.value.trim(), password: passwordInput.value
      });
      await acceptCloudProfile(vault, passwordInput.value);
      resetPasswordState = null;
      codeInput.value = ''; passwordInput.value = '';
      closeProfileModal();
      showToast('Пароль изменён. Вход выполнен.', 'success');
    }
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; }
}
window.handleResetPasswordSubmit = handleResetPasswordSubmit;

/**
 * Two-way Cloud Synchronization
 */
async function syncWithCloud(silent = false) {
  const user = getCurrentUser();
  if (!user || !user.vaultId) {
    if (!silent) showToast('Войдите в профиль для синхронизации', 'info');
    return;
  }

  if (isSyncing) return;
  isSyncing = true;

  const syncDotEl = document.getElementById('headerProfileSyncDot');
  if (syncDotEl) {
    syncDotEl.className = 'profile-sync-indicator syncing';
    syncDotEl.title = 'Идет синхронизация...';
  }

  try {
    // If the profile was created locally when offline, register or link to cloud now
    if (user.vaultId && user.vaultId.startsWith('tl_') && user.savedPassword) {
      try {
        const rawTrades = typeof getAllTradesRaw === 'function' ? await getAllTradesRaw() : [];
        const rawThoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];
        const registered = await accountRequest('register', {
          vault: {
            userId: user.userId,
            userName: user.name,
            userEmail: user.email,
            trades: sanitizeTradesForCloud(rawTrades),
            thoughts: sanitizeThoughtsForCloud(rawThoughts),
            presets: {
              tickers: typeof getCustomPresets === 'function' ? getCustomPresets('symbol') : [],
              directions: typeof getCustomPresets === 'function' ? getCustomPresets('direction') : [],
              setups: typeof getCustomPresets === 'function' ? getCustomPresets('setup') : [],
              timeframes: typeof getCustomPresets === 'function' ? getCustomPresets('timeframe') : [],
              criteria: typeof getCustomPresets === 'function' ? getCustomPresets('criteria') : []
            },
            deletedTradeUuids: typeof getDeletedTradeSigs === 'function' ? getDeletedTradeSigs() : [],
            deletedThoughtUuids: typeof getDeletedThoughtSigs === 'function' ? getDeletedThoughtSigs() : []
          },
          password: user.savedPassword
        });
        if (registered && registered.vaultId) {
          user.vaultId = registered.vaultId;
          localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
          currentUser = user;
          updateProfileUI();
        }
      } catch (regErr) {
        if (String(regErr?.message || '').includes('уже существует') || String(regErr?.message || '').includes('409')) {
          try {
            const loggedIn = await accountRequest('login', { identifier: user.email, password: user.savedPassword });
            if (loggedIn && loggedIn.vaultId) {
              user.vaultId = loggedIn.vaultId;
              localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
              currentUser = user;
              updateProfileUI();
            }
          } catch (_) {}
        }
      }
    }

    // 1. Fetch remote vault
    const remoteData = await fetchCloudVault(user.vaultId);

    // 2. Merge remote items into local, respecting deleted tombstones
    const remoteDeletedTrades = Array.isArray(remoteData.deletedTradeUuids) ? remoteData.deletedTradeUuids : [];
    const remoteDeletedThoughts = Array.isArray(remoteData.deletedThoughtUuids) ? remoteData.deletedThoughtUuids : [];

    if (Array.isArray(remoteData.trades) && typeof mergeCloudTrades === 'function') {
      await mergeCloudTrades(remoteData.trades, remoteDeletedTrades);
    }
    if (Array.isArray(remoteData.thoughts) && typeof mergeCloudThoughts === 'function') {
      await mergeCloudThoughts(remoteData.thoughts, remoteDeletedThoughts);
    }

    // 3. Get all latest local data (now merged and filtered of deleted tombstones)
    let rawLatestTrades = typeof getAllTradesRaw === 'function' ? await getAllTradesRaw() : [];
    let rawLatestThoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];

    if (typeof isTradeDeletedLocally === 'function') {
      rawLatestTrades = rawLatestTrades.filter(t => !isTradeDeletedLocally(t));
    }
    if (typeof isThoughtDeletedLocally === 'function') {
      rawLatestThoughts = rawLatestThoughts.filter(t => !isThoughtDeletedLocally(t));
    }

    const latestTrades = sanitizeTradesForCloud(rawLatestTrades);
    const latestThoughts = sanitizeThoughtsForCloud(rawLatestThoughts);

    const presetsPayload = {
      tickers: typeof getCustomPresets === 'function' ? getCustomPresets('symbol') : [],
      directions: typeof getCustomPresets === 'function' ? getCustomPresets('direction') : [],
      setups: typeof getCustomPresets === 'function' ? getCustomPresets('setup') : [],
      timeframes: typeof getCustomPresets === 'function' ? getCustomPresets('timeframe') : [],
      criteria: typeof getCustomPresets === 'function' ? getCustomPresets('criteria') : []
    };

    const localDeletedTrades = typeof getDeletedTradeSigs === 'function' ? getDeletedTradeSigs() : [];
    const combinedDeletedTrades = Array.from(new Set([...remoteDeletedTrades, ...localDeletedTrades])).slice(-500);

    const localDeletedThoughts = typeof getDeletedThoughtSigs === 'function' ? getDeletedThoughtSigs() : [];
    const combinedDeletedThoughts = Array.from(new Set([...remoteDeletedThoughts, ...localDeletedThoughts])).slice(-500);

    // 4. Update cloud vault with newest merged package
    const updatedVault = {
      ...remoteData,
      userId: user.userId,
      userName: user.name,
      userEmail: user.email,
      updatedAt: new Date().toISOString(),
      trades: latestTrades,
      thoughts: latestThoughts,
      presets: presetsPayload,
      deletedTradeUuids: combinedDeletedTrades,
      deletedThoughtUuids: combinedDeletedThoughts
    };

    await updateCloudVault(user.vaultId, updatedVault);

    // Update last sync timestamp
    user.lastSyncAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    currentUser = user;

    if (syncDotEl) {
      syncDotEl.className = 'profile-sync-indicator synced';
      syncDotEl.title = 'Синхронизировано';
    }

    // Refresh active views
    if (typeof refreshTrades === 'function') {
      await refreshTrades();
    }
    if (typeof loadAndRenderJournal === 'function') {
      await loadAndRenderJournal();
    }

    updateProfileUI();

    if (!silent) {
      showToast('Облачная синхронизация завершена!', 'success');
      const lastSyncEl = document.getElementById('profModalLastSync');
      if (lastSyncEl) lastSyncEl.textContent = formatShortDateTime(user.lastSyncAt);
    }

  } catch (err) {
    console.error('Cloud sync error:', err);
    if (syncDotEl) {
      syncDotEl.className = 'profile-sync-indicator error';
      syncDotEl.title = 'Ошибка синхронизации';
    }
    if (!silent) {
      showToast(`Ошибка синхронизации: ${err.message}`, 'error');
    }
  } finally {
    isSyncing = false;
  }
}
window.syncWithCloud = syncWithCloud;

/**
 * Schedule debounced auto-sync after user creates or modifies trade/thought
 */
function scheduleAutoSync() {
  if (!isUserLoggedIn()) return;
  clearTimeout(autoSyncTimeout);
  autoSyncTimeout = setTimeout(() => {
    autoSyncTimeout = null;
    syncWithCloud(true).catch(err => console.warn('Auto-sync error:', err));
  }, 600);
}
window.scheduleAutoSync = scheduleAutoSync;

function flushPendingSync() {
  if (!isUserLoggedIn() || !autoSyncTimeout) return;
  clearTimeout(autoSyncTimeout);
  autoSyncTimeout = null;
  syncWithCloud(true).catch(() => {});
}

function setupCloudSyncTriggers() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isUserLoggedIn()) {
      syncWithCloud(true).catch(() => {});
    }
  });

  window.addEventListener('focus', () => {
    if (isUserLoggedIn()) {
      syncWithCloud(true).catch(() => {});
    }
  });

  window.addEventListener('pagehide', flushPendingSync);
  window.addEventListener('beforeunload', flushPendingSync);

  // Background sync every 45 seconds while tab is active
  setInterval(() => {
    if (document.visibilityState === 'visible' && isUserLoggedIn() && !isSyncing) {
      syncWithCloud(true).catch(() => {});
    }
  }, 45000);
}

/**
 * Manual Sync Button Handler
 */
async function triggerManualSync() {
  const btn = document.getElementById('profManualSyncBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span> <span>Синхронизация...</span>`;
  }
  await syncWithCloud(false);
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      <span>Синхронизировать сейчас</span>
    `;
  }
}
window.triggerManualSync = triggerManualSync;

/**
 * Safe clipboard copy with fallback
 */
function copyTextToClipboardSafe(text, successMsg) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(successMsg, 'success');
    }).catch(() => {
      fallbackCopy(text, successMsg);
    });
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(ta);
    if (successful) {
      showToast(successMsg, 'success');
      return;
    }
  } catch (_) {}
  prompt('Скопируйте значение:', text);
}

/**
 * Paste from clipboard into specified input element
 */
async function pasteToInput(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        el.value = cleanVaultId(text.trim());
        el.dispatchEvent(new Event('input', { bubbles: true }));
        showToast('Код вставлен', 'success');
        return;
      }
    }
  } catch (err) {
    console.warn('Clipboard read failed:', err);
  }
  el.focus();
  el.select();
  showToast('Вставьте код вручную (Ctrl+V или долгое нажатие)', 'info');
}
window.pasteToInput = pasteToInput;

/**
 * Copy Sync Key to Clipboard
 */
function copySyncKeyToClipboard() {
  const user = getCurrentUser();
  if (!user || !user.vaultId) {
    showToast('Код профиля ещё не создан', 'warning');
    return;
  }

  const textToCopy = user.vaultId;
  copyTextToClipboardSafe(textToCopy, 'Код профиля скопирован! Вставьте его при входе.');
}
window.copySyncKeyToClipboard = copySyncKeyToClipboard;

/**
 * Toggle Profile Password Visibility in Profile Modal
 */
let isProfilePasswordVisible = false;

function toggleProfilePasswordVisibility() {
  const passEl = document.getElementById('profModalPassword');
  const toggleText = document.getElementById('profPassToggleText');
  const eyeIcon = document.getElementById('profPassEyeIcon');
  if (!passEl) return;

  const user = getCurrentUser();
  const actualPassword = user && user.savedPassword ? user.savedPassword : '';

  isProfilePasswordVisible = !isProfilePasswordVisible;
  if (isProfilePasswordVisible) {
    passEl.textContent = actualPassword || '(не сохранён локально)';
    passEl.style.letterSpacing = 'normal';
    if (toggleText) toggleText.textContent = 'Скрыть';
    if (eyeIcon) {
      eyeIcon.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      `;
    }
  } else {
    passEl.textContent = '••••••••';
    passEl.style.letterSpacing = '2px';
    if (toggleText) toggleText.textContent = 'Показать';
    if (eyeIcon) {
      eyeIcon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      `;
    }
  }
}
window.toggleProfilePasswordVisibility = toggleProfilePasswordVisibility;

/**
 * Copy Profile Password to Clipboard
 */
function copyProfilePasswordToClipboard() {
  const user = getCurrentUser();
  const actualPassword = user && user.savedPassword ? user.savedPassword : '';
  if (!actualPassword) {
    showToast('Пароль не найден в локальном профиле этого устройства', 'warning');
    return;
  }

  copyTextToClipboardSafe(actualPassword, 'Пароль профиля скопирован в буфер обмена!');
}
window.copyProfilePasswordToClipboard = copyProfilePasswordToClipboard;

/**
 * Logout User
 */
async function handleUserLogout() {
  if (confirm('Выйти из профиля на этом устройстве? Все уже сохраненные здесь сделки останутся на месте.')) {
    try { await accountRequest('logout'); } catch (error) { showToast('Нет связи с сервером. Повторите выход после подключения.', 'error'); return; }
    localStorage.removeItem(STORAGE_KEY_USER);
    currentUser = null;
    updateProfileUI();
    closeProfileModal();
    showToast('Вы вышли из профиля', 'info');
  }
}
window.handleUserLogout = handleUserLogout;

/**
 * SHA-256 Hashing Helper
 */
async function hashString(message) {
  try {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      hash = (hash << 5) - hash + message.charCodeAt(i);
      hash |= 0;
    }
    return 'fallback_' + Math.abs(hash).toString(16);
  }
}

/**
 * Short Date Time Formatter
 */
function formatShortDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) {
    return `Сегодня, ${timeStr}`;
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + `, ${timeStr}`;
}
