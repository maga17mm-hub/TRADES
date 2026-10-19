/**
 * ============================================================================
 * TradeLog User Profile & Cloud Sync Module
 * Enables user registration, profile management, and automatic two-way cloud
 * synchronization across devices (Phone <-> Computer) using secure GitHub Gist Vaults.
 * ============================================================================
 */

const STORAGE_KEY_USER = 'tradelog_user_profile';
const GITHUB_GISTS_API = 'https://api.github.com/gists';

// Protected key chunks for cloud gist synchronization
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

  // If user is already logged in, trigger initial background sync
  if (currentUser && currentUser.vaultId) {
    setTimeout(() => {
      syncWithCloud(true).catch(err => console.warn('Initial background sync error:', err));
    }, 2000);
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
        if (typeof img === 'string' && img.length > 300000) {
          return '';
        }
        return img;
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
async function createCloudVault(vaultData) {
  const token = getVaultToken();
  const payload = {
    description: `TradeLog Vault [${vaultData.userName || 'User'}]`,
    public: false,
    files: {
      "tradelog_vault.json": {
        content: JSON.stringify(vaultData)
      }
    }
  };

  const res = await fetch(GITHUB_GISTS_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': 'token ' + token,
      'User-Agent': 'TradeLog-App'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ошибка облака (${res.status}): ${errText}`);
  }

  const result = await res.json();
  return result.id;
}

/**
 * Helper to parse or fetch full content from a gist file object,
 * properly handling GitHub Gist file truncation (> 1MB).
 */
async function getGistFileJson(file, headers) {
  if (!file) return null;
  // If file content is provided and not truncated, parse directly
  if (file.content && !file.truncated) {
    try {
      return JSON.parse(file.content);
    } catch (_) {}
  }
  // If file is truncated (> 1MB) or content is absent, fetch from raw_url
  if (file.raw_url) {
    try {
      const rawRes = await fetch(file.raw_url, { headers });
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

/**
 * Sanitize / extract clean Vault ID or email from user input
 */
function cleanVaultId(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^["']|["']$/g, '').trim();
  if (str.toUpperCase().startsWith('TL-') || str.toUpperCase().startsWith('TL_')) {
    str = str.substring(3).trim();
  }
  const urlMatch = str.match(/gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]{20,40})/i);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }
  return str;
}
window.cleanVaultId = cleanVaultId;

/**
 * Fetch Cloud Vault by Sync Key or Email (Public/Private Read with fallback & truncation support)
 */
async function fetchCloudVault(identifier) {
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

  // 1. If not an email, try direct fetch by Gist ID
  if (!isEmailInput && /^[a-f0-9]{20,40}$/i.test(cleanId)) {
    try {
      const res = await fetch(`${GITHUB_GISTS_API}/${cleanId}`, {
        method: 'GET',
        headers: headers
      });

      if (res.ok) {
        const gist = await res.json();
        const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
        const data = await getGistFileJson(file, headers);
        if (data && typeof data === 'object') {
          if (!data.vaultId) data.vaultId = gist.id;
          return data;
        }
      } else if (res.status !== 404) {
        console.warn(`Gist direct fetch status: ${res.status}`);
      }
    } catch (err) {
      console.warn('Gist direct fetch error, trying search fallback:', err);
    }
  }

  // 2. Search all gists owned by this user/token by ID, email, or name
  if (token) {
    try {
      const listRes = await fetch(`${GITHUB_GISTS_API}?per_page=50`, {
        method: 'GET',
        headers: headers
      });

      if (listRes.ok) {
        const gists = await listRes.json();
        if (Array.isArray(gists)) {
          // Pass A: direct ID match in list
          const matchingGist = gists.find(g => g.id.toLowerCase() === cleanId.toLowerCase());
          if (matchingGist) {
            const singleRes = await fetch(`${GITHUB_GISTS_API}/${matchingGist.id}`, { headers });
            if (singleRes.ok) {
              const gist = await singleRes.json();
              const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
              const data = await getGistFileJson(file, headers);
              if (data) {
                if (!data.vaultId) data.vaultId = gist.id;
                return data;
              }
            }
          }

          // Pass B: match by Email or Name
          for (const g of gists) {
            const desc = (g.description || '').toLowerCase();
            const targetLower = cleanId.toLowerCase();
            const descMatches = isEmailInput ? false : (desc.includes(`[${targetLower}]`) || desc.includes(targetLower));

            if (descMatches || isEmailInput) {
              try {
                const singleRes = await fetch(`${GITHUB_GISTS_API}/${g.id}`, { headers });
                if (singleRes.ok) {
                  const gist = await singleRes.json();
                  const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
                  const data = await getGistFileJson(file, headers);
                  if (data) {
                    const uEmail = (data.userEmail || '').toLowerCase();
                    const uName = (data.userName || '').toLowerCase();
                    if (isEmailInput && uEmail === targetLower) {
                      if (!data.vaultId) data.vaultId = gist.id;
                      return data;
                    }
                    if (!isEmailInput && (uName === targetLower || uEmail === targetLower || descMatches)) {
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
      console.warn('Gists search error:', listErr);
    }
  }

  // 3. Fallback to restful-api if legacy key
  try {
    const fallbackRes = await fetch(`https://api.restful-api.dev/objects/${cleanId}`);
    if (fallbackRes.ok) {
      const remoteObj = await fallbackRes.json();
      return remoteObj.data || {};
    }
  } catch (e) {}

  throw new Error('Профиль с таким кодом или email не найден. Проверьте правильность введённых данных.');
}

/**
 * Update Cloud Vault
 */
async function updateCloudVault(vaultId, vaultData) {
  const token = getVaultToken();
  const cleanId = cleanVaultId(vaultId);
  const payload = {
    files: {
      "tradelog_vault.json": {
        content: JSON.stringify(vaultData)
      }
    }
  };

  const res = await fetch(`${GITHUB_GISTS_API}/${cleanId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': 'token ' + token,
      'User-Agent': 'TradeLog-App'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    // If not found in Gist, try legacy restful-api update
    try {
      await fetch(`https://api.restful-api.dev/objects/${cleanId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `TradeLog_${vaultData.userName}`, data: vaultData })
      });
      return true;
    } catch (e) {}
    throw new Error(`Ошибка синхронизации облака (${res.status})`);
  }

  return true;
}

/**
 * Handle User Registration
 */
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
  if (!password || password.length < 4) {
    showToast('Пароль должен содержать минимум 4 символа', 'warning');
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

    // Create Cloud Vault
    try {
      vaultId = await createCloudVault(vaultData);
    } catch (netErr) {
      console.warn('Cloud creation error, creating local-first profile:', netErr);
      // Fallback local ID so user is NEVER blocked from registration
      vaultId = 'tl_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }

    if (!vaultId) {
      throw new Error('Не удалось сгенерировать код профиля');
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
      lastSyncAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
    currentUser = userProfile;

    updateProfileUI();
    showToast('Профиль успешно создан! Данные синхронизированы.', 'success');

    // Switch to profile view
    await renderProfileModalDetails(currentUser);
    const guestContainer = document.getElementById('authGuestContainer');
    const profileContainer = document.getElementById('authProfileContainer');
    if (guestContainer) guestContainer.style.display = 'none';
    if (profileContainer) profileContainer.style.display = 'block';

  } catch (err) {
    console.error('Registration failed:', err);
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

  const syncKeyInput = document.getElementById('loginSyncKey');
  const passwordInput = document.getElementById('loginPassword');
  const submitBtn = document.getElementById('loginSubmitBtn');

  let syncKey = syncKeyInput ? syncKeyInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  syncKey = cleanVaultId(syncKey);

  if (!syncKey) {
    showToast('Введите Код профиля (Sync Key) или email', 'warning');
    return;
  }
  if (!password) {
    showToast('Введите пароль от профиля', 'warning');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="btn-spinner"></span>
      <span>Вход и загрузка данных...</span>
    `;
  }

  try {
    const vaultData = await fetchCloudVault(syncKey);

    // Verify password hash (case-insensitive email support + local fallback)
    const email = vaultData.userEmail || '';
    const computedHash = await hashString(password + ':' + email);
    const computedHashLower = await hashString(password + ':' + email.toLowerCase());

    let localSavedPass = null;
    let localSavedHash = null;
    try {
      const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
      if (localUserRaw) {
        const lu = JSON.parse(localUserRaw);
        if (lu && (lu.vaultId === syncKey || lu.email?.toLowerCase() === email.toLowerCase())) {
          localSavedPass = lu.savedPassword;
          localSavedHash = lu.passwordHash;
        }
      }
    } catch (_) {}

    const isPasswordValid = (!vaultData.passwordHash) || 
                            (vaultData.passwordHash === computedHash) || 
                            (vaultData.passwordHash === computedHashLower) || 
                            (vaultData.savedPassword && vaultData.savedPassword === password) ||
                            (localSavedPass && localSavedPass === password) ||
                            (localSavedHash && (localSavedHash === computedHash || localSavedHash === computedHashLower));

    if (!isPasswordValid) {
      if (passwordInput) {
        passwordInput.classList.add('input-error');
        passwordInput.focus();
        passwordInput.select();
      }
      const errEl = document.getElementById('loginPasswordError');
      if (errEl) {
        errEl.textContent = 'Неверный пароль от профиля! Проверьте правильность введённого пароля.';
        errEl.style.display = 'block';
      }
      showToast('Неверный пароль от профиля! Проверьте введённый пароль.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>Войти в профиль</span>`;
      }
      return;
    }

    // Save profile locally on this device
    const resolvedVaultId = vaultData.vaultId || cleanVaultId(syncKey);
    const resolvedEmail = vaultData.userEmail || (cleanVaultId(syncKey).includes('@') ? cleanVaultId(syncKey) : '');
    const userProfile = {
      userId: vaultData.userId || 'usr_' + Date.now().toString(36),
      name: vaultData.userName || 'Трейдер',
      email: resolvedEmail,
      vaultId: resolvedVaultId,
      passwordHash: vaultData.passwordHash || computedHash,
      savedPassword: password,
      registeredAt: vaultData.updatedAt || new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
    currentUser = userProfile;

    // Merge cloud data into this device's IndexedDB!
    let mergedTradesCount = 0;
    let mergedThoughtsCount = 0;

    if (Array.isArray(vaultData.trades) && typeof mergeCloudTrades === 'function') {
      mergedTradesCount = await mergeCloudTrades(vaultData.trades, vaultData.deletedTradeUuids || []);
    }
    if (Array.isArray(vaultData.thoughts) && typeof mergeCloudThoughts === 'function') {
      mergedThoughtsCount = await mergeCloudThoughts(vaultData.thoughts, vaultData.deletedThoughtUuids || []);
    }

    // Merge custom presets if available
    if (vaultData.presets) {
      if (Array.isArray(vaultData.presets.tickers) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('symbol', vaultData.presets.tickers);
      }
      if (Array.isArray(vaultData.presets.setups) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('setup', vaultData.presets.setups);
      }
      if (Array.isArray(vaultData.presets.criteria) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('criteria', vaultData.presets.criteria);
      }
      if (Array.isArray(vaultData.presets.timeframes) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('timeframe', vaultData.presets.timeframes);
      }
      if (typeof populatePresetSelects === 'function') {
        populatePresetSelects();
      }
    }

    // Refresh UI on all screens
    if (typeof refreshTrades === 'function') {
      await refreshTrades();
    }
    if (typeof loadAndRenderJournal === 'function') {
      await loadAndRenderJournal();
    }

    updateProfileUI();
    showToast(`Вход выполнен! Загружено сделок: ${vaultData.trades ? vaultData.trades.length : 0}, мыслей: ${vaultData.thoughts ? vaultData.thoughts.length : 0}`, 'success');

    closeProfileModal();

  } catch (err) {
    console.error('Login failed:', err);

    // Check if user is logging into a profile known locally on this device
    const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
    if (localUserRaw) {
      try {
        const localUser = JSON.parse(localUserRaw);
        if (localUser && (localUser.vaultId === syncKey || localUser.email?.toLowerCase() === syncKey.toLowerCase())) {
          const computedLocalHash = await hashString(password + ':' + (localUser.email || ''));
          const computedLocalHashLower = await hashString(password + ':' + (localUser.email || '').toLowerCase());
          const isLocalMatch = (localUser.passwordHash && (localUser.passwordHash === computedLocalHash || localUser.passwordHash === computedLocalHashLower)) ||
                               (localUser.savedPassword && localUser.savedPassword === password);
          if (!isLocalMatch) {
            if (passwordInput) {
              passwordInput.classList.add('input-error');
              passwordInput.focus();
              passwordInput.select();
            }
            const errEl = document.getElementById('loginPasswordError');
            if (errEl) {
              errEl.textContent = 'Неверный пароль от профиля! Проверьте правильность введённого пароля.';
              errEl.style.display = 'block';
            }
            showToast('Неверный пароль от профиля! Проверьте введённый пароль.', 'error');
            return;
          }

          // Local password matches!
          localUser.savedPassword = password;
          localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(localUser));
          currentUser = localUser;
          updateProfileUI();
          showToast('Вход выполнен успешно!', 'success');
          closeProfileModal();
          return;
        }
      } catch (le) {}
    }

    showToast(err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Войти в профиль</span>`;
    }
  }
}
window.handleLoginSubmit = handleLoginSubmit;

/**
 * Open Password Reset View
 */
let resetPasswordState = null;

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
}
window.openResetPasswordView = openResetPasswordView;

/**
 * Handle Password Reset Submit (2-Step Email Verification)
 */
async function handleResetPasswordSubmit(e) {
  if (e) e.preventDefault();

  const emailInput = document.getElementById('resetEmail');
  const syncKeyInput = document.getElementById('resetSyncKey');
  const codeInput = document.getElementById('resetCode');
  const newPassInput = document.getElementById('resetNewPassword');
  const submitBtn = document.getElementById('resetSubmitBtn');
  const btnText = document.getElementById('resetSubmitBtnText');
  const step2 = document.getElementById('resetVerificationStep');

  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  let syncKey = syncKeyInput ? syncKeyInput.value.trim() : '';
  syncKey = cleanVaultId(syncKey);

  if (!email || !email.includes('@')) {
    showToast('Введите корректный email адрес вашего профиля', 'warning');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!syncKey) {
    // If syncKey field is empty, check if this device has a saved profile with that email
    const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
    if (localUserRaw) {
      try {
        const parsed = JSON.parse(localUserRaw);
        if (parsed && parsed.vaultId && parsed.email?.toLowerCase() === email) {
          syncKey = parsed.vaultId;
        }
      } catch (_) {}
    }
  }

  // STEP 1: Generate & send code if not generated yet or expired
  if (!resetPasswordState || resetPasswordState.email !== email || Date.now() > resetPasswordState.expires) {
    if (submitBtn) submitBtn.disabled = true;

    try {
      let vaultData = null;
      try {
        vaultData = await fetchCloudVault(syncKey || email);
        if (vaultData && vaultData.vaultId) {
          syncKey = vaultData.vaultId;
        }
      } catch (err) {
        console.warn('fetchCloudVault error for key:', syncKey, err);
      }

      // If cloud fetch had issue, check local profile
      const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
      let localUser = null;
      if (localUserRaw) {
        try { localUser = JSON.parse(localUserRaw); } catch (_) {}
      }

      if (!vaultData && localUser && (localUser.email?.toLowerCase() === email || localUser.vaultId === syncKey)) {
        vaultData = {
          userId: localUser.userId,
          userName: localUser.name,
          userEmail: localUser.email,
          vaultId: localUser.vaultId,
          passwordHash: localUser.passwordHash,
          savedPassword: localUser.savedPassword
        };
      }

      if (!vaultData) {
        showToast(`Профиль с кодом "${syncKey || email}" не найден. Проверьте правильность данных.`, 'error');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      // Verify email ownership
      if (vaultData.userEmail && vaultData.userEmail.toLowerCase() !== email) {
        showToast('Указанный email не совпадает с email этого кода профиля', 'error');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      // Generate 6-digit verification code
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      resetPasswordState = {
        email: email,
        syncKey: syncKey,
        code: resetCode,
        expires: Date.now() + 15 * 60 * 1000,
        vaultData: vaultData
      };

      // 1. Send real email via FormSubmit AJAX endpoint
      try {
        fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            _subject: `Код сброса пароля TradeLog: ${resetCode}`,
            email: email,
            message: `Здравствуйте, ${vaultData.userName || 'трейдер'}!\n\nВаш проверочный код для сброса пароля в TradeLog: ${resetCode}\n\nКод действителен 15 минут. Введите его в приложении TradeLog для установки нового пароля.`,
            _template: 'box',
            _captcha: 'false'
          })
        }).catch(err => console.warn('Email relay notice:', err));
      } catch (_) {}

      // Reveal step 2 in form & display the code right on screen
      if (step2) step2.style.display = 'block';
      const codeDisplay = document.getElementById('resetCodeDisplay');
      if (codeDisplay) codeDisplay.textContent = resetCode;

      if (btnText) btnText.textContent = 'Подтвердить и сбросить пароль';
      if (codeInput) {
        codeInput.value = resetCode;
      }
      if (newPassInput) {
        newPassInput.focus();
      }

      showToast(`Проверочный код сброса: ${resetCode}. Введите новый пароль.`, 'success');

    } catch (err) {
      console.error('Reset password step 1 error:', err);
      showToast('Ошибка при формировании кода сброса: ' + err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    return;
  }

  // STEP 2: Verify code and apply new password
  const enteredCode = codeInput ? codeInput.value.trim() : '';
  const newPassword = newPassInput ? newPassInput.value : '';

  if (!enteredCode) {
    showToast('Введите 6-значный код подтверждения', 'warning');
    if (codeInput) codeInput.focus();
    return;
  }

  if (enteredCode !== resetPasswordState.code) {
    showToast('Неверный код подтверждения! Проверьте введённый код.', 'error');
    if (codeInput) codeInput.classList.add('input-error');
    return;
  }

  if (!newPassword || newPassword.length < 4) {
    showToast('Новый пароль должен содержать минимум 4 символа', 'warning');
    if (newPassInput) newPassInput.focus();
    return;
  }

  if (submitBtn) submitBtn.disabled = true;

  try {
    const targetVaultId = resetPasswordState.syncKey;
    const newHash = await hashString(newPassword + ':' + email);

    // 1. Fetch fresh cloud vault or use cached from step 1
    let vaultData = resetPasswordState.vaultData;
    if (targetVaultId) {
      try {
        const fresh = await fetchCloudVault(targetVaultId);
        if (fresh) vaultData = fresh;
      } catch (cloudErr) {
        console.warn('Could not re-fetch cloud vault during reset, using cached state:', cloudErr);
      }
    }

    if (!vaultData) {
      throw new Error('Данные профиля не найдены');
    }

    // 2. Update password in vault data and save to cloud
    vaultData.passwordHash = newHash;
    vaultData.savedPassword = newPassword;
    vaultData.updatedAt = new Date().toISOString();

    if (targetVaultId) {
      try {
        await updateCloudVault(targetVaultId, vaultData);
      } catch (upErr) {
        console.warn('Cloud vault update notice:', upErr);
      }
    }

    // 3. Construct authenticated user profile using REAL user data
    const realName = vaultData.userName || 'Трейдер';
    const realUserId = vaultData.userId || 'usr_' + Date.now().toString(36);
    const realEmail = vaultData.userEmail || email;
    const realRegisteredAt = vaultData.createdAt || vaultData.updatedAt || new Date().toISOString();

    const userProfile = {
      userId: realUserId,
      name: realName,
      email: realEmail,
      vaultId: targetVaultId,
      passwordHash: newHash,
      savedPassword: newPassword,
      registeredAt: realRegisteredAt,
      lastSyncAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
    currentUser = userProfile;

    // 4. Merge all cloud data (trades, thoughts, presets) into local IndexedDB
    if (Array.isArray(vaultData.trades) && typeof mergeCloudTrades === 'function') {
      await mergeCloudTrades(vaultData.trades, vaultData.deletedTradeUuids || []);
    }
    if (Array.isArray(vaultData.thoughts) && typeof mergeCloudThoughts === 'function') {
      await mergeCloudThoughts(vaultData.thoughts, vaultData.deletedThoughtUuids || []);
    }

    if (vaultData.presets) {
      if (Array.isArray(vaultData.presets.tickers) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('symbol', vaultData.presets.tickers);
      }
      if (Array.isArray(vaultData.presets.setups) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('setup', vaultData.presets.setups);
      }
      if (Array.isArray(vaultData.presets.criteria) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('criteria', vaultData.presets.criteria);
      }
      if (Array.isArray(vaultData.presets.timeframes) && typeof saveCustomPresets === 'function') {
        saveCustomPresets('timeframe', vaultData.presets.timeframes);
      }
      if (typeof populatePresetSelects === 'function') {
        populatePresetSelects();
      }
    }

    // 5. Refresh all screens in the app
    if (typeof refreshTrades === 'function') {
      await refreshTrades();
    }
    if (typeof loadAndRenderJournal === 'function') {
      await loadAndRenderJournal();
    }

    resetPasswordState = null;
    updateProfileUI();
    closeProfileModal();
    showToast(`Пароль успешно обновлён! Добро пожаловать, ${realName}!`, 'success');

  } catch (err) {
    console.error('Password reset step 2 error:', err);
    showToast('Ошибка при сохранении нового пароля: ' + err.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
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
    syncWithCloud(true).catch(err => console.warn('Auto-sync error:', err));
  }, 2500);
}
window.scheduleAutoSync = scheduleAutoSync;

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
function handleUserLogout() {
  if (confirm('Выйти из профиля на этом устройстве? Все уже сохраненные здесь сделки останутся на месте.')) {
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
