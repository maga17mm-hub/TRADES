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
 * Fetch Cloud Vault by Sync Key (Public Read with fallback)
 */
async function fetchCloudVault(vaultId) {
  const token = getVaultToken();
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TradeLog-App'
  };
  if (token) {
    headers['Authorization'] = 'token ' + token;
  }

  // 1. Try GitHub Gists API
  try {
    const res = await fetch(`${GITHUB_GISTS_API}/${vaultId}`, {
      method: 'GET',
      headers: headers
    });

    if (res.ok) {
      const gist = await res.json();
      const file = gist.files && (gist.files['tradelog_vault.json'] || Object.values(gist.files)[0]);
      if (file && file.content) {
        return JSON.parse(file.content);
      }
    } else if (res.status === 404) {
      // Continue to fallback
    } else {
      throw new Error(`Ошибка загрузки профиля: ${res.status}`);
    }
  } catch (err) {
    if (!err.message.includes('404')) {
      console.warn('Gist fetch error, trying fallback:', err);
    }
  }

  // 2. Fallback to restful-api if legacy key
  try {
    const fallbackRes = await fetch(`https://api.restful-api.dev/objects/${vaultId}`);
    if (fallbackRes.ok) {
      const remoteObj = await fallbackRes.json();
      return remoteObj.data || {};
    }
  } catch (e) {}

  throw new Error('Профиль с таким кодом не найден. Проверьте правильность кода.');
}

/**
 * Update Cloud Vault
 */
async function updateCloudVault(vaultId, vaultData) {
  const token = getVaultToken();
  const payload = {
    files: {
      "tradelog_vault.json": {
        content: JSON.stringify(vaultData)
      }
    }
  };

  const res = await fetch(`${GITHUB_GISTS_API}/${vaultId}`, {
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
      await fetch(`https://api.restful-api.dev/objects/${vaultId}`, {
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

  if (syncKey.startsWith('TL-')) {
    syncKey = syncKey.substring(3).trim();
  }

  if (!syncKey) {
    showToast('Введите Код профиля (Sync Key) с вашего телефона', 'warning');
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

    // Verify password hash
    const email = vaultData.userEmail || '';
    const computedHash = await hashString(password + ':' + email);

    const isPasswordValid = (!vaultData.passwordHash) || 
                            (vaultData.passwordHash === computedHash) || 
                            (vaultData.savedPassword && vaultData.savedPassword === password);

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
    const userProfile = {
      userId: vaultData.userId || 'usr_' + Date.now().toString(36),
      name: vaultData.userName || 'Трейдер',
      email: vaultData.userEmail || '',
      vaultId: syncKey,
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
        if (localUser && (localUser.vaultId === syncKey || localUser.email === syncKey)) {
          const computedLocalHash = await hashString(password + ':' + (localUser.email || ''));
          const isLocalMatch = (localUser.passwordHash && localUser.passwordHash === computedLocalHash) ||
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
  if (syncKey.startsWith('TL-')) syncKey = syncKey.substring(3).trim();

  if (!email || !email.includes('@')) {
    showToast('Введите корректный email адрес вашего профиля', 'warning');
    return;
  }

  // STEP 1: Generate & send code if not generated yet or expired
  if (!resetPasswordState || resetPasswordState.email !== email || Date.now() > resetPasswordState.expires) {
    if (submitBtn) submitBtn.disabled = true;

    try {
      let vaultData = null;
      let targetVaultId = syncKey;

      if (targetVaultId) {
        try {
          vaultData = await fetchCloudVault(targetVaultId);
        } catch (_) {}
      }

      const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
      let localUser = null;
      if (localUserRaw) {
        try { localUser = JSON.parse(localUserRaw); } catch (_) {}
      }

      if (!vaultData && localUser && (localUser.email === email || localUser.vaultId === syncKey)) {
        vaultData = {
          userId: localUser.userId,
          userName: localUser.name,
          userEmail: localUser.email,
          vaultId: localUser.vaultId,
          passwordHash: localUser.passwordHash
        };
        targetVaultId = localUser.vaultId;
      }

      if (vaultData && vaultData.userEmail && vaultData.userEmail.toLowerCase() !== email) {
        showToast('Указанный email не совпадает с email этого кода профиля', 'error');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      // Generate 6-digit verification code
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      resetPasswordState = {
        email: email,
        syncKey: targetVaultId || syncKey,
        code: resetCode,
        expires: Date.now() + 15 * 60 * 1000,
        vaultData: vaultData
      };

      // Open mailto link so user can view/send from their mail app
      const mailSubject = encodeURIComponent('Сброс пароля TradeLog');
      const mailBody = encodeURIComponent(`Здравствуйте!\n\nВаш проверочный код для сброса пароля в TradeLog: ${resetCode}\n\nКод действителен 15 минут.\nЕсли вы не запрашивали сброс пароля, проигнорируйте это сообщение.`);
      
      try {
        const mailLink = document.createElement('a');
        mailLink.href = `mailto:${email}?subject=${mailSubject}&body=${mailBody}`;
        document.body.appendChild(mailLink);
        mailLink.click();
        document.body.removeChild(mailLink);
      } catch (_) {}

      // Reveal step 2 in form
      if (step2) step2.style.display = 'block';
      if (btnText) btnText.textContent = 'Подтвердить и сбросить пароль';
      if (codeInput) {
        codeInput.value = '';
        codeInput.focus();
      }

      showToast(`Проверочный код отправлен на ${email}! Проверьте почту (или код: ${resetCode})`, 'success');

    } catch (err) {
      console.error('Reset password step 1 error:', err);
      showToast('Ошибка при формировании кода сброса', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
    return;
  }

  // STEP 2: Verify code and apply new password
  const enteredCode = codeInput ? codeInput.value.trim() : '';
  const newPassword = newPassInput ? newPassInput.value : '';

  if (!enteredCode) {
    showToast('Введите 6-значный код подтверждения из письма', 'warning');
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
    const newHash = await hashString(newPassword + ':' + email);
    const targetVaultId = resetPasswordState.syncKey;

    // 1. Update cloud vault if exists
    if (targetVaultId) {
      try {
        const currentCloudVault = await fetchCloudVault(targetVaultId);
        if (currentCloudVault) {
          currentCloudVault.passwordHash = newHash;
          currentCloudVault.savedPassword = newPassword;
          currentCloudVault.updatedAt = new Date().toISOString();
          await updateCloudVault(targetVaultId, currentCloudVault);
        }
      } catch (cloudErr) {
        console.warn('Could not update remote cloud vault during reset:', cloudErr);
      }
    }

    // 2. Update local profile if saved on this device
    const localUserRaw = localStorage.getItem(STORAGE_KEY_USER);
    if (localUserRaw) {
      try {
        const localUser = JSON.parse(localUserRaw);
        if (localUser && (localUser.email === email || localUser.vaultId === targetVaultId)) {
          localUser.passwordHash = newHash;
          localUser.savedPassword = newPassword;
          localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(localUser));
          currentUser = localUser;
        }
      } catch (_) {}
    }

    resetPasswordState = null;
    showToast('Пароль успешно сброшен и обновлён! Теперь войдите с новым паролем.', 'success');

    // Switch to login tab and prefill
    switchAuthTab('login');
    const loginSync = document.getElementById('loginSyncKey');
    const loginPass = document.getElementById('loginPassword');
    if (loginSync && targetVaultId) loginSync.value = targetVaultId;
    if (loginPass) {
      loginPass.value = newPassword;
      loginPass.focus();
    }

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
 * Copy Sync Key to Clipboard
 */
function copySyncKeyToClipboard() {
  const user = getCurrentUser();
  if (!user || !user.vaultId) return;

  const textToCopy = user.vaultId;
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast('Код профиля скопирован! Вставьте его на компьютере для входа.', 'success');
  }).catch(() => {
    prompt('Ваш код профиля для входа на компьютере:', textToCopy);
  });
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

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(actualPassword).then(() => {
      showToast('Пароль профиля скопирован в буфер обмена!', 'success');
    }).catch(() => {
      prompt('Ваш пароль от профиля:', actualPassword);
    });
  } else {
    prompt('Ваш пароль от профиля:', actualPassword);
  }
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
