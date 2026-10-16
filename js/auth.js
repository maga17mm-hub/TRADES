/**
 * ============================================================================
 * TradeLog User Profile & Cloud Sync Module
 * Enables user registration, profile management, and automatic two-way cloud
 * synchronization across devices (Phone <-> Computer).
 * ============================================================================
 */

const STORAGE_KEY_USER = 'tradelog_user_profile';
const CLOUD_VAULT_API = 'https://api.restful-api.dev/objects';

let currentUser = null;
let isSyncing = false;
let autoSyncTimeout = null;

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
      avatarEl.innerHTML = `<span class="avatar-initial">${escapeHtml(initial)}</span>`;
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

  modal.classList.add('active');
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
  document.body.classList.remove('modal-open');
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

  if (tab === 'login') {
    if (tabLoginBtn) tabLoginBtn.classList.add('active');
    if (tabRegBtn) tabRegBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'block';
    if (regForm) regForm.style.display = 'none';
  } else {
    if (tabLoginBtn) tabLoginBtn.classList.remove('active');
    if (tabRegBtn) tabRegBtn.classList.add('active');
    if (loginForm) loginForm.style.display = 'none';
    if (regForm) regForm.style.display = 'block';
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
    const localTrades = typeof getAllTradesRaw === 'function' ? await getAllTradesRaw() : [];
    const localThoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];

    const presetsPayload = {
      tickers: typeof getCustomPresets === 'function' ? getCustomPresets('symbol') : [],
      directions: typeof getCustomPresets === 'function' ? getCustomPresets('direction') : [],
      setups: typeof getCustomPresets === 'function' ? getCustomPresets('setup') : [],
      timeframes: typeof getCustomPresets === 'function' ? getCustomPresets('timeframe') : [],
      criteria: typeof getCustomPresets === 'function' ? getCustomPresets('criteria') : []
    };

    const vaultPayload = {
      name: `TradeLog_${name}`,
      data: {
        version: 2,
        userId: userId,
        userName: name,
        userEmail: email,
        passwordHash: passwordHash,
        updatedAt: new Date().toISOString(),
        trades: localTrades || [],
        thoughts: localThoughts || [],
        presets: presetsPayload
      }
    };

    // Create cloud vault
    const res = await fetch(CLOUD_VAULT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vaultPayload)
    });

    if (!res.ok) {
      throw new Error(`Ошибка облачного сервера: ${res.status}`);
    }

    const created = await res.json();
    const vaultId = created.id;

    if (!vaultId) {
      throw new Error('Сервер не вернул ID хранилища');
    }

    // Save profile locally
    const userProfile = {
      userId: userId,
      name: name,
      email: email,
      vaultId: vaultId,
      passwordHash: passwordHash,
      registeredAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
    currentUser = userProfile;

    updateProfileUI();
    showToast('Профиль успешно создан! Данные сохранены в облаке.', 'success');

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

  // Clean code if prefixed with TL-
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
    const res = await fetch(`${CLOUD_VAULT_API}/${syncKey}`);
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error('Профиль с таким кодом не найден. Проверьте правильность кода.');
      }
      throw new Error(`Ошибка подключения: ${res.status}`);
    }

    const vaultObj = await res.json();
    const vaultData = vaultObj.data || {};

    // Verify password hash
    const email = vaultData.userEmail || '';
    const computedHash = await hashString(password + ':' + email);

    if (vaultData.passwordHash && vaultData.passwordHash !== computedHash) {
      showToast('Неверный пароль от профиля', 'error');
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
      passwordHash: vaultData.passwordHash,
      registeredAt: vaultData.updatedAt || new Date().toISOString(),
      lastSyncAt: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userProfile));
    currentUser = userProfile;

    // Merge cloud data into this device's IndexedDB!
    let mergedTradesCount = 0;
    let mergedThoughtsCount = 0;

    if (Array.isArray(vaultData.trades) && typeof mergeCloudTrades === 'function') {
      mergedTradesCount = await mergeCloudTrades(vaultData.trades);
    }
    if (Array.isArray(vaultData.thoughts) && typeof mergeCloudThoughts === 'function') {
      mergedThoughtsCount = await mergeCloudThoughts(vaultData.thoughts);
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
    const res = await fetch(`${CLOUD_VAULT_API}/${user.vaultId}`);
    if (!res.ok) {
      throw new Error(`Ошибка связи с облаком (${res.status})`);
    }

    const remoteObj = await res.json();
    const remoteData = remoteObj.data || {};

    // 2. Merge remote items into local
    if (Array.isArray(remoteData.trades) && typeof mergeCloudTrades === 'function') {
      await mergeCloudTrades(remoteData.trades);
    }
    if (Array.isArray(remoteData.thoughts) && typeof mergeCloudThoughts === 'function') {
      await mergeCloudThoughts(remoteData.thoughts);
    }

    // 3. Get all latest local data (now merged)
    const latestTrades = typeof getAllTradesRaw === 'function' ? await getAllTradesRaw() : [];
    const latestThoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];

    const presetsPayload = {
      tickers: typeof getCustomPresets === 'function' ? getCustomPresets('symbol') : [],
      directions: typeof getCustomPresets === 'function' ? getCustomPresets('direction') : [],
      setups: typeof getCustomPresets === 'function' ? getCustomPresets('setup') : [],
      timeframes: typeof getCustomPresets === 'function' ? getCustomPresets('timeframe') : [],
      criteria: typeof getCustomPresets === 'function' ? getCustomPresets('criteria') : []
    };

    // 4. Update cloud vault with newest merged package
    const updatedVault = {
      name: `TradeLog_${user.name}`,
      data: {
        ...remoteData,
        userId: user.userId,
        userName: user.name,
        userEmail: user.email,
        updatedAt: new Date().toISOString(),
        trades: latestTrades,
        thoughts: latestThoughts,
        presets: presetsPayload
      }
    };

    const putRes = await fetch(`${CLOUD_VAULT_API}/${user.vaultId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedVault)
    });

    if (!putRes.ok) {
      throw new Error(`Ошибка обновления облака (${putRes.status})`);
    }

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
    // Fallback prompt
    prompt('Ваш код профиля для входа на компьютере:', textToCopy);
  });
}
window.copySyncKeyToClipboard = copySyncKeyToClipboard;

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
    // Basic fallback hash
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
