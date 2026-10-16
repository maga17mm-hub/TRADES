/**
 * TradeLog - Main Application Controller
 * Handles UI interactions, dual tabs, custom presets (tickers, setups, timeframes),
 * filtering, analytics, image handling, and PWA logic.
 */

// Global State
let allTrades = [];
let currentFilter = {
  month: 'all',
  setup: 'all',
  timeframe: 'all',
  outcome: 'all',
  direction: 'all',
  searchQuery: ''
};

// Form images states (separate for Record page and Edit modal)
let recordTradeImages = [];
let modalTradeImages = [];
let editingTradeId = null;
let deferredInstallPrompt = null;

// DOM Elements - Tabs & Nav
const tabRecordView = document.getElementById('tabRecordView');
const tabJournalView = document.getElementById('tabJournalView');
const navBtnHome = document.getElementById('navBtnHome');
const navBtnRecord = document.getElementById('navBtnRecord');
const navBtnJournal = document.getElementById('navBtnJournal');

// DOM Elements - Journal Feed & Analytics
const tradesFeedEl = document.getElementById('tradesFeed');
const monthPillsEl = document.getElementById('monthPills');
const setupPillsEl = document.getElementById('setupPills');
const statWinrateEl = document.getElementById('statWinrate');
const statPnlEl = document.getElementById('statPnl');
const statTotalEl = document.getElementById('statTotal');
const statBestSetupEl = document.getElementById('statBestSetup');
const searchInputEl = document.getElementById('searchInput');
const filterTfSelectEl = document.getElementById('filterTfSelect');
const filterOutcomeSelectEl = document.getElementById('filterOutcomeSelect');
const filterDirectionSelectEl = document.getElementById('filterDirectionSelect');

// DOM Elements - Modals
const tradeModalEl = document.getElementById('tradeModal');
const tradeFormEl = document.getElementById('tradeForm');
const modalTitleEl = document.getElementById('modalTitle');
const backupModalEl = document.getElementById('backupModal');
const lightboxModalEl = document.getElementById('lightboxModal');
const lightboxImgEl = document.getElementById('lightboxImg');
const lightboxCaptionEl = document.getElementById('lightboxCaption');

// DOM Elements - Record Tab Form
const recordTradeFormEl = document.getElementById('recordTradeForm');

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker for PWA
  registerServiceWorker();

  // Initialize presets (tickers, setups, timeframes)
  initPresets();

  // Setup form timestamps
  initFormTimestamps();

  // Setup Event Listeners
  setupEventListeners();

  // Setup Clipboard Paste for images (Ctrl+V)
  setupClipboardPaste();

  // Setup PWA install banner
  setupPwaInstall();

  // Load trades from DB
  await refreshTrades();

  // Restore active tab (default to 'home' or saved tab)
  const savedTab = localStorage.getItem('tradelog_active_tab');
  if (savedTab === 'record') {
    switchTab('record');
  } else if (savedTab === 'journal') {
    switchTab('journal');
  } else {
    switchTab('home');
  }
});

/**
 * Register Service Worker
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('Service Worker active:', reg.scope))
        .catch((err) => console.log('Service Worker failed:', err));
    });
  }
}

/**
 * Tab Navigation (Домой <-> Сделка <-> Дневник)
 */
function switchTab(tabName) {
  if (tabName === 'record') {
    tabRecordView.style.display = 'block';
    tabJournalView.style.display = 'none';
    if (navBtnHome) navBtnHome.classList.remove('active');
    if (navBtnRecord) navBtnRecord.classList.add('active');
    if (navBtnJournal) navBtnJournal.classList.remove('active');
    localStorage.setItem('tradelog_active_tab', 'record');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderAllPresetPills();
  } else if (tabName === 'journal') {
    tabRecordView.style.display = 'none';
    tabJournalView.style.display = 'block';
    if (navBtnHome) navBtnHome.classList.remove('active');
    if (navBtnRecord) navBtnRecord.classList.remove('active');
    if (navBtnJournal) navBtnJournal.classList.add('active');
    localStorage.setItem('tradelog_active_tab', 'journal');
    updateAnalytics();
    renderMonthPills();
    renderSetupPills();
    renderTradesFeed();
    const feed = document.getElementById('tradesFeed');
    if (feed) {
      feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else {
    // 'home' tab
    tabRecordView.style.display = 'none';
    tabJournalView.style.display = 'block';
    if (navBtnHome) navBtnHome.classList.add('active');
    if (navBtnRecord) navBtnRecord.classList.remove('active');
    if (navBtnJournal) navBtnJournal.classList.remove('active');
    localStorage.setItem('tradelog_active_tab', 'home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateAnalytics();
    renderMonthPills();
    renderSetupPills();
    renderTradesFeed();
  }
}

// Global exposure for onclick
window.switchTab = switchTab;

/**
 * ============================================================================
 * PRESETS MANAGEMENT: Tickers, Trade Setups, Timeframes
 * User can type new ones, they persist across sessions, and appear as tap buttons.
 * ============================================================================
 */

const DEFAULT_TICKERS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XAU/USD'];
const DEFAULT_SETUPS = [
  'Breakout / Пробой',
  'Order Block (OB)',
  'FVG / Imbalance',
  'Liquidity Sweep',
  'CHoCH / Слом структуры',
  'Support / Resistance',
  'Trend Continuation'
];
const DEFAULT_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];

function initPresets() {
  if (!localStorage.getItem('tradelog_saved_tickers')) {
    localStorage.setItem('tradelog_saved_tickers', JSON.stringify(DEFAULT_TICKERS));
  }
  if (!localStorage.getItem('tradelog_saved_setups')) {
    localStorage.setItem('tradelog_saved_setups', JSON.stringify(DEFAULT_SETUPS));
  }
  if (!localStorage.getItem('tradelog_saved_timeframes')) {
    localStorage.setItem('tradelog_saved_timeframes', JSON.stringify(DEFAULT_TIMEFRAMES));
  }
  renderAllPresetPills();
}

function getSavedTickers() {
  try {
    const raw = localStorage.getItem('tradelog_saved_tickers');
    return raw ? JSON.parse(raw) : DEFAULT_TICKERS;
  } catch {
    return DEFAULT_TICKERS;
  }
}

function saveTicker(ticker) {
  if (!ticker || !ticker.trim()) return;
  const clean = ticker.trim().toUpperCase();
  const list = getSavedTickers();
  if (!list.includes(clean)) {
    list.push(clean);
    localStorage.setItem('tradelog_saved_tickers', JSON.stringify(list));
    renderAllPresetPills();
  }
}

function removeTicker(ticker) {
  const list = getSavedTickers().filter((t) => t !== ticker);
  localStorage.setItem('tradelog_saved_tickers', JSON.stringify(list));
  renderAllPresetPills();
}

function getSavedSetups() {
  try {
    const raw = localStorage.getItem('tradelog_saved_setups');
    return raw ? JSON.parse(raw) : DEFAULT_SETUPS;
  } catch {
    return DEFAULT_SETUPS;
  }
}

function saveSetup(setup) {
  if (!setup || !setup.trim()) return;
  const clean = setup.trim();
  const list = getSavedSetups();
  if (!list.includes(clean)) {
    list.push(clean);
    localStorage.setItem('tradelog_saved_setups', JSON.stringify(list));
    renderAllPresetPills();
  }
}

function removeSetup(setup) {
  const list = getSavedSetups().filter((s) => s !== setup);
  localStorage.setItem('tradelog_saved_setups', JSON.stringify(list));
  renderAllPresetPills();
}

function getSavedTimeframes() {
  try {
    const raw = localStorage.getItem('tradelog_saved_timeframes');
    return raw ? JSON.parse(raw) : DEFAULT_TIMEFRAMES;
  } catch {
    return DEFAULT_TIMEFRAMES;
  }
}

function saveTimeframe(tf) {
  if (!tf || !tf.trim()) return;
  const clean = tf.trim();
  const list = getSavedTimeframes();
  if (!list.includes(clean)) {
    list.push(clean);
    localStorage.setItem('tradelog_saved_timeframes', JSON.stringify(list));
    renderAllPresetPills();
  }
}

function removeTimeframe(tf) {
  const list = getSavedTimeframes().filter((t) => t !== tf);
  localStorage.setItem('tradelog_saved_timeframes', JSON.stringify(list));
  renderAllPresetPills();
}

/**
 * Render all preset chips across Record tab & Modal
 */
function renderAllPresetPills() {
  // Record tab
  renderTickerPills('recSavedTickers', 'recTradeSymbol');
  renderSetupPillsForForm('recSavedSetups', 'recTradeSetup');
  renderTimeframePillsForForm('recSavedTimeframes', 'recTradeTimeframe');

  // Modal
  renderTickerPills('modalSavedTickers', 'tradeSymbol');
  renderSetupPillsForForm('modalSavedSetups', 'tradeSetup');
  renderTimeframePillsForForm('modalSavedTimeframes', 'tradeTimeframe');
}

function renderTickerPills(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  const tickers = getSavedTickers();
  const currentVal = (input.value || '').trim().toUpperCase();

  container.innerHTML = tickers.map((t) => {
    const isActive = currentVal === t;
    return `
      <span class="preset-chip ${isActive ? 'active' : ''}" data-ticker="${escapeHtml(t)}">
        <span onclick="selectTicker('${escapeHtml(t)}', '${inputId}', '${containerId}')">${escapeHtml(t)}</span>
        <span class="preset-chip-del" onclick="event.stopPropagation(); handleDeleteTicker('${escapeHtml(t)}')">✕</span>
      </span>
    `;
  }).join('');
}

function selectTicker(ticker, inputId, containerId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = ticker;
    renderTickerPills(containerId, inputId);
  }
}

function handleSaveCurrentTicker(inputId, containerId) {
  const input = document.getElementById(inputId);
  if (!input || !input.value.trim()) {
    showToast('Введите тикер для сохранения', 'info');
    return;
  }
  const t = input.value.trim().toUpperCase();
  saveTicker(t);
  selectTicker(t, inputId, containerId);
  showToast(`Тикер ${t} сохранен!`, 'success');
}

function handleDeleteTicker(ticker) {
  removeTicker(ticker);
  showToast(`Тикер ${ticker} удален`, 'info');
}

function renderSetupPillsForForm(containerId, inputId) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  const setups = getSavedSetups();
  const currentVal = (input.value || '').trim();

  container.innerHTML = setups.map((s) => {
    const isActive = currentVal === s;
    return `
      <span class="preset-chip ${isActive ? 'active' : ''}" data-setup="${escapeHtml(s)}">
        <span onclick="selectSetup('${escapeHtml(s)}', '${inputId}', '${containerId}')">${escapeHtml(s)}</span>
        <span class="preset-chip-del" onclick="event.stopPropagation(); handleDeleteSetup('${escapeHtml(s)}')">✕</span>
      </span>
    `;
  }).join('');
}

function selectSetup(setup, inputId, containerId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = setup;
    renderSetupPillsForForm(containerId, inputId);
  }
}

function handleSaveCurrentSetup(inputId, containerId) {
  const input = document.getElementById(inputId);
  if (!input || !input.value.trim()) {
    showToast('Введите название сетапа для сохранения', 'info');
    return;
  }
  const s = input.value.trim();
  saveSetup(s);
  selectSetup(s, inputId, containerId);
  showToast(`Сетап «${s}» сохранен!`, 'success');
}

function handleDeleteSetup(setup) {
  removeSetup(setup);
  showToast(`Сетап «${setup}» удален`, 'info');
}

function renderTimeframePillsForForm(containerId, hiddenInputId) {
  const container = document.getElementById(containerId);
  const hiddenInput = document.getElementById(hiddenInputId);
  if (!container || !hiddenInput) return;

  const tfs = getSavedTimeframes();
  const currentVal = hiddenInput.value || '15m';

  container.innerHTML = tfs.map((tf) => {
    const isActive = currentVal === tf;
    return `
      <span class="preset-chip ${isActive ? 'active' : ''}" data-tf="${escapeHtml(tf)}">
        <span onclick="selectTimeframe('${escapeHtml(tf)}', '${hiddenInputId}', '${containerId}')">${escapeHtml(tf)}</span>
        <span class="preset-chip-del" onclick="event.stopPropagation(); handleDeleteTimeframe('${escapeHtml(tf)}')">✕</span>
      </span>
    `;
  }).join('');
}

function selectTimeframe(tf, hiddenInputId, containerId) {
  const hiddenInput = document.getElementById(hiddenInputId);
  if (hiddenInput) {
    hiddenInput.value = tf;
    renderTimeframePillsForForm(containerId, hiddenInputId);
  }
}

function handleAddCustomTimeframe(containerId, hiddenInputId) {
  const customTf = prompt('Введите новый таймфрейм (например: 2m, 10m, 2h, 8h, 3D, 1M):');
  if (customTf && customTf.trim()) {
    const clean = customTf.trim();
    saveTimeframe(clean);
    selectTimeframe(clean, hiddenInputId, containerId);
    showToast(`Таймфрейм ${clean} добавлен!`, 'success');
  }
}

function handleDeleteTimeframe(tf) {
  removeTimeframe(tf);
  showToast(`Таймфрейм ${tf} удален`, 'info');
}

// Make handlers globally available
window.selectTicker = selectTicker;
window.handleSaveCurrentTicker = handleSaveCurrentTicker;
window.handleDeleteTicker = handleDeleteTicker;
window.selectSetup = selectSetup;
window.handleSaveCurrentSetup = handleSaveCurrentSetup;
window.handleDeleteSetup = handleDeleteSetup;
window.selectTimeframe = selectTimeframe;
window.handleAddCustomTimeframe = handleAddCustomTimeframe;
window.handleDeleteTimeframe = handleDeleteTimeframe;

/**
 * ============================================================================
 * REFRESH & ANALYTICS
 * ============================================================================
 */

async function refreshTrades() {
  try {
    allTrades = await getAllTrades();
    updateAnalytics();
    renderMonthPills();
    renderSetupPills();
    renderTradesFeed();
  } catch (err) {
    console.error('Failed to refresh trades:', err);
    showToast('Ошибка загрузки данных', 'error');
  }
}

function updateAnalytics() {
  const filtered = getFilteredTrades();
  const total = filtered.length;

  if (total === 0) {
    statWinrateEl.textContent = '0%';
    statWinrateEl.className = 'stat-value';
    statPnlEl.textContent = '0.0 R';
    statPnlEl.className = 'stat-value';
    statTotalEl.textContent = '0';
    statBestSetupEl.textContent = '—';
    return;
  }

  let wins = 0;
  let losses = 0;
  let be = 0;
  let totalR = 0;
  const setupStats = {};

  filtered.forEach((t) => {
    const rVal = parseFloat(t.rMultiple || 0);
    totalR += rVal;

    if (t.outcome === 'WIN') wins++;
    else if (t.outcome === 'LOSS') losses++;
    else if (t.outcome === 'BE') be++;

    const setupName = t.setup || 'Без сетапа';
    if (!setupStats[setupName]) {
      setupStats[setupName] = { total: 0, wins: 0, r: 0 };
    }
    setupStats[setupName].total++;
    if (t.outcome === 'WIN') setupStats[setupName].wins++;
    setupStats[setupName].r += rVal;
  });

  const decisiveTrades = wins + losses;
  const winrate = decisiveTrades > 0 ? Math.round((wins / decisiveTrades) * 100) : 0;

  let bestSetupName = '—';
  let bestSetupWinrate = -1;
  for (const [name, s] of Object.entries(setupStats)) {
    if (s.total >= 1) {
      const wr = (s.wins / s.total) * 100;
      if (wr > bestSetupWinrate || (wr === bestSetupWinrate && s.r > 0)) {
        bestSetupWinrate = wr;
        bestSetupName = `${name} (${Math.round(wr)}%)`;
      }
    }
  }

  statWinrateEl.textContent = `${winrate}%`;
  statWinrateEl.className = `stat-value ${winrate >= 50 ? 'stat-win' : 'stat-loss'}`;

  const pnlPrefix = totalR > 0 ? '+' : '';
  statPnlEl.textContent = `${pnlPrefix}${totalR.toFixed(1)} R`;
  statPnlEl.className = `stat-value ${totalR > 0 ? 'stat-win' : totalR < 0 ? 'stat-loss' : ''}`;

  statTotalEl.innerHTML = `${total} <span class="stat-subtext" style="display:inline-flex;margin:0;">(<span class="stat-win">${wins}W</span> / <span class="stat-loss">${losses}L</span> / ${be}BE)</span>`;
  statBestSetupEl.textContent = bestSetupName;
}

function getFilteredTrades() {
  return allTrades.filter((t) => {
    if (currentFilter.month !== 'all' && t.month !== currentFilter.month) {
      return false;
    }
    if (currentFilter.setup !== 'all' && t.setup !== currentFilter.setup) {
      return false;
    }
    if (currentFilter.timeframe !== 'all' && t.timeframe !== currentFilter.timeframe) {
      return false;
    }
    if (currentFilter.outcome !== 'all' && t.outcome !== currentFilter.outcome) {
      return false;
    }
    if (currentFilter.direction !== 'all' && t.direction !== currentFilter.direction) {
      return false;
    }
    if (currentFilter.searchQuery) {
      const q = currentFilter.searchQuery.toLowerCase();
      const symbolMatch = (t.symbol || '').toLowerCase().includes(q);
      const notesMatch = (t.notes || '').toLowerCase().includes(q);
      const setupMatch = (t.setup || '').toLowerCase().includes(q);
      if (!symbolMatch && !notesMatch && !setupMatch) return false;
    }
    return true;
  });
}

function renderMonthPills() {
  if (allTrades.length === 0) {
    monthPillsEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Нет сделок для группировки</span>';
    return;
  }

  const monthsMap = {};
  allTrades.forEach((t) => {
    const m = t.month || 'Без даты';
    monthsMap[m] = (monthsMap[m] || 0) + 1;
  });

  const sortedMonths = Object.keys(monthsMap).sort().reverse();

  let html = `
    <button class="pill-item ${currentFilter.month === 'all' ? 'active' : ''}" data-month="all">
      Все месяцы <span class="pill-badge">${allTrades.length}</span>
    </button>
  `;

  sortedMonths.forEach((m) => {
    const label = formatMonthName(m);
    const count = monthsMap[m];
    const isActive = currentFilter.month === m ? 'active' : '';
    html += `
      <button class="pill-item ${isActive}" data-month="${escapeHtml(m)}">
        ${escapeHtml(label)} <span class="pill-badge">${count}</span>
      </button>
    `;
  });

  monthPillsEl.innerHTML = html;

  monthPillsEl.querySelectorAll('.pill-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter.month = btn.dataset.month;
      monthPillsEl.querySelectorAll('.pill-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateAnalytics();
      renderTradesFeed();
    });
  });
}

function renderSetupPills() {
  if (allTrades.length === 0) {
    setupPillsEl.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Нет сделок для группировки</span>';
    return;
  }

  const setupsMap = {};
  allTrades.forEach((t) => {
    const s = t.setup || 'Без сетапа';
    setupsMap[s] = (setupsMap[s] || 0) + 1;
  });

  const sortedSetups = Object.keys(setupsMap).sort((a, b) => setupsMap[b] - setupsMap[a]);

  let html = `
    <button class="pill-item ${currentFilter.setup === 'all' ? 'active' : ''}" data-setup="all">
      Все сетапы <span class="pill-badge">${allTrades.length}</span>
    </button>
  `;

  sortedSetups.forEach((s) => {
    const count = setupsMap[s];
    const isActive = currentFilter.setup === s ? 'active' : '';
    html += `
      <button class="pill-item ${isActive}" data-setup="${escapeHtml(s)}">
        ${escapeHtml(s)} <span class="pill-badge">${count}</span>
      </button>
    `;
  });

  setupPillsEl.innerHTML = html;

  setupPillsEl.querySelectorAll('.pill-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter.setup = btn.dataset.setup;
      setupPillsEl.querySelectorAll('.pill-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateAnalytics();
      renderTradesFeed();
    });
  });
}

function renderTradesFeed() {
  const filtered = getFilteredTrades();

  if (filtered.length === 0) {
    tradesFeedEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
        </div>
        <div class="empty-title">Дневник пуст</div>
        <div class="empty-desc">Сделки по выбранным критериям отсутствуют. Перейдите во вкладку «Запись трейдов», чтобы внести сделку!</div>
        <button class="btn btn-primary" onclick="switchTab('record')">+ Записать трейд</button>
      </div>
    `;
    return;
  }

  // Group by month
  const groups = {};
  filtered.forEach((t) => {
    const m = t.month || 'Без даты';
    if (!groups[m]) groups[m] = [];
    groups[m].push(t);
  });

  const sortedMonthKeys = Object.keys(groups).sort().reverse();
  let fullHtml = '';

  sortedMonthKeys.forEach((m) => {
    const monthTrades = groups[m];
    const monthName = formatMonthName(m);

    let mWins = 0;
    let mLosses = 0;
    let mTotalR = 0;
    monthTrades.forEach((t) => {
      if (t.outcome === 'WIN') mWins++;
      if (t.outcome === 'LOSS') mLosses++;
      mTotalR += parseFloat(t.rMultiple || 0);
    });

    const mDecisive = mWins + mLosses;
    const mWinrate = mDecisive > 0 ? Math.round((mWins / mDecisive) * 100) : 0;
    const rPrefix = mTotalR > 0 ? '+' : '';

    fullHtml += `
      <div class="month-group">
        <div class="month-group-header">
          <div class="month-header-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span class="month-title">${escapeHtml(monthName)}</span>
            <span class="pill-badge">${monthTrades.length} сделок</span>
          </div>
          <div class="month-header-stats">
            <span>WR: <strong class="${mWinrate >= 50 ? 'stat-win' : 'stat-loss'}">${mWinrate}%</strong></span>
            <span>Итог: <strong class="${mTotalR > 0 ? 'stat-win' : mTotalR < 0 ? 'stat-loss' : ''}">${rPrefix}${mTotalR.toFixed(1)}R</strong></span>
          </div>
        </div>

        <div class="month-cards-container">
          ${monthTrades.map((trade) => renderTradeCard(trade)).join('')}
        </div>
      </div>
    `;
  });

  tradesFeedEl.innerHTML = fullHtml;
  attachCardActionListeners();
}

function renderTradeCard(t) {
  const outcomeClass = (t.outcome || 'be').toLowerCase();
  const dirClass = (t.direction || 'long').toLowerCase();
  const outcomeLabel = t.outcome === 'WIN' ? 'Тейк-профит' : t.outcome === 'LOSS' ? 'Стоп-лосс' : 'Безубыток';

  const entryFormatted = formatDateTimeDisplay(t.entryTime);
  const exitFormatted = formatDateTimeDisplay(t.exitTime);
  const durationText = calculateDuration(t.entryTime, t.exitTime);

  const images = t.images || [];
  let imagesHtml = '';
  if (images.length > 0) {
    imagesHtml = `
      <div class="trade-thumbnails-grid">
        ${images.map((img, idx) => `
          <div class="thumbnail-box" data-trade-id="${t.id}" data-img-idx="${idx}">
            <img src="${img.dataUrl}" alt="Скриншот сделки" loading="lazy">
            <span class="thumbnail-tag">#${idx + 1}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  let notesHtml = '';
  if (t.notes && t.notes.trim()) {
    notesHtml = `<div class="trade-notes-preview">${escapeHtml(t.notes)}</div>`;
  }

  let priceHtml = '';
  if (t.entryPrice || t.exitPrice) {
    priceHtml = `
      <div class="timing-item">
        <span class="timing-label">Цены входа / выхода</span>
        <span class="timing-val">${t.entryPrice || '—'} → ${t.exitPrice || '—'}</span>
      </div>
    `;
  }

  return `
    <div class="trade-card ${outcomeClass}" id="trade-card-${t.id}">
      <div class="trade-card-top">
        <div class="trade-asset-info">
          <span class="trade-symbol">${escapeHtml(t.symbol || 'ASSET')}</span>
          <span class="direction-badge ${dirClass}">${escapeHtml(t.direction || 'LONG')}</span>
          <span class="tf-badge">${escapeHtml(t.timeframe || '15m')}</span>
          <span class="setup-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            ${escapeHtml(t.setup || 'Без сетапа')}
          </span>
        </div>

        <div class="trade-outcome-wrapper">
          <span class="outcome-badge ${outcomeClass}">${outcomeLabel}</span>
          <span class="trade-pnl-text ${outcomeClass}">${escapeHtml(t.pnl || '0R')}</span>
        </div>
      </div>

      <div class="trade-timing-strip">
        <div class="timing-item">
          <span class="timing-label">Вход в сделку</span>
          <span class="timing-val">${entryFormatted}</span>
        </div>
        <div class="timing-item">
          <span class="timing-label">Выход из сделки</span>
          <span class="timing-val">${exitFormatted}</span>
        </div>
        <div class="timing-item">
          <span class="timing-label">Длительность</span>
          <span class="timing-val">${durationText}</span>
        </div>
        ${priceHtml}
      </div>

      ${imagesHtml}
      ${notesHtml}

      <div class="trade-card-footer">
        <div class="card-footer-info">
          ID: #${t.id}
        </div>
        <div class="card-footer-btns">
          <button class="btn btn-secondary btn-sm" onclick="editTrade(${t.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Изменить
          </button>
          <button class="btn btn-secondary btn-sm" onclick="confirmDeleteTrade(${t.id})" style="color: var(--loss); border-color: rgba(244,63,94,0.2);">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

function attachCardActionListeners() {
  document.querySelectorAll('.thumbnail-box').forEach((box) => {
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const tradeId = Number(box.dataset.tradeId);
      const imgIdx = Number(box.dataset.imgIdx);
      const trade = allTrades.find((t) => t.id === tradeId);
      if (trade && trade.images && trade.images[imgIdx]) {
        openLightbox(trade.images[imgIdx].dataUrl, `${trade.symbol} (${trade.timeframe}) — ${trade.setup}`);
      }
    });
  });
}

/**
 * ============================================================================
 * FORM TIMESTAMPS & CONTROLS
 * ============================================================================
 */

function initFormTimestamps() {
  setNowForInput('recTradeEntryTime');
  setNowForInput('recTradeExitTime');
}

function setNowForInput(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  el.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
window.setNowForInput = setNowForInput;

function setRecDirection(dir) {
  document.getElementById('recTradeDirection').value = dir;
  document.querySelectorAll('#recordTradeForm .seg-btn[data-dir]').forEach((b) => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}
window.setRecDirection = setRecDirection;

function setRecOutcome(outcome) {
  document.getElementById('recTradeOutcome').value = outcome;
  document.querySelectorAll('#recordTradeForm .seg-btn[data-outcome]').forEach((b) => {
    b.classList.toggle('active', b.dataset.outcome === outcome);
  });

  const pnlInput = document.getElementById('recTradePnl');
  const rInput = document.getElementById('recTradeRMultiple');
  if (outcome === 'WIN' && !pnlInput.value) {
    pnlInput.value = '+2.0R';
    rInput.value = '2.0';
  } else if (outcome === 'LOSS' && !pnlInput.value) {
    pnlInput.value = '-1.0R';
    rInput.value = '-1.0';
  } else if (outcome === 'BE' && !pnlInput.value) {
    pnlInput.value = '0.0R';
    rInput.value = '0.0';
  }
}
window.setRecOutcome = setRecOutcome;

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Journal Search & Filters
  searchInputEl.addEventListener('input', (e) => {
    currentFilter.searchQuery = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  filterTfSelectEl.addEventListener('change', (e) => {
    currentFilter.timeframe = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  filterOutcomeSelectEl.addEventListener('change', (e) => {
    currentFilter.outcome = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  filterDirectionSelectEl.addEventListener('change', (e) => {
    currentFilter.direction = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  // Modal Direction Buttons
  document.querySelectorAll('#tradeForm .seg-btn[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tradeForm .seg-btn[data-dir]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tradeDirection').value = btn.dataset.dir;
    });
  });

  // Modal Outcome Buttons
  document.querySelectorAll('#tradeForm .seg-btn[data-outcome]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tradeForm .seg-btn[data-outcome]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tradeOutcome').value = btn.dataset.outcome;

      const pnlInput = document.getElementById('tradePnl');
      const rInput = document.getElementById('tradeRMultiple');
      if (btn.dataset.outcome === 'WIN' && !pnlInput.value) {
        pnlInput.value = '+2.0R';
        rInput.value = '2.0';
      } else if (btn.dataset.outcome === 'LOSS' && !pnlInput.value) {
        pnlInput.value = '-1.0R';
        rInput.value = '-1.0';
      } else if (btn.dataset.outcome === 'BE' && !pnlInput.value) {
        pnlInput.value = '0.0R';
        rInput.value = '0.0';
      }
    });
  });

  // PnL Auto R parsing
  document.getElementById('recTradePnl').addEventListener('input', (e) => {
    const match = e.target.value.match(/([+-]?\d+(?:\.\d+)?)/);
    if (match) document.getElementById('recTradeRMultiple').value = match[1];
  });

  document.getElementById('tradePnl').addEventListener('input', (e) => {
    const match = e.target.value.match(/([+-]?\d+(?:\.\d+)?)/);
    if (match) document.getElementById('tradeRMultiple').value = match[1];
  });

  // Images for Record Tab
  setupImageUpload(
    'recTradeImageInput',
    'recImageUploadZone',
    'recFormImagePreviews',
    () => recordTradeImages,
    (imgs) => { recordTradeImages = imgs; }
  );

  // Images for Modal
  setupImageUpload(
    'tradeImageInput',
    'imageUploadZone',
    'formImagePreviews',
    () => modalTradeImages,
    (imgs) => { modalTradeImages = imgs; }
  );

  // Forms submit
  recordTradeFormEl.addEventListener('submit', handleRecordTradeSubmit);
  tradeFormEl.addEventListener('submit', handleModalTradeSubmit);

  // Close modals on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTradeModal();
      closeBackupModal();
      closeLightbox();
    }
  });
}

/**
 * Reusable image upload setup for Record Tab and Modal
 */
function setupImageUpload(inputId, zoneId, previewId, getImages, setImages) {
  const inputEl = document.getElementById(inputId);
  const zoneEl = document.getElementById(zoneId);

  if (!inputEl || !zoneEl) return;

  zoneEl.addEventListener('click', () => inputEl.click());

  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneEl.classList.add('dragover');
  });

  zoneEl.addEventListener('dragleave', () => {
    zoneEl.classList.remove('dragover');
  });

  zoneEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    zoneEl.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processImageFiles(e.dataTransfer.files, getImages, setImages, previewId);
    }
  });

  inputEl.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await processImageFiles(e.target.files, getImages, setImages, previewId);
      inputEl.value = '';
    }
  });
}

async function processImageFiles(files, getImages, setImages, previewId) {
  showToast('Сжатие скриншотов...', 'info');
  const current = [...getImages()];
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImage(file);
        current.push(compressed);
      } catch (err) {
        console.error('Failed to compress image:', err);
      }
    }
  }
  setImages(current);
  renderImagePreviews(previewId, current, (idx) => {
    current.splice(idx, 1);
    setImages(current);
    renderImagePreviews(previewId, current, null);
  });
  showToast(`Скриншотов добавлено: ${current.length}`, 'success');
}

function renderImagePreviews(previewContainerId, images, onDeleteCallback) {
  const container = document.getElementById(previewContainerId);
  if (!container) return;

  if (images.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = images.map((img, idx) => `
    <div class="preview-item">
      <img src="${img.dataUrl}" alt="Превью ${idx + 1}">
      <button type="button" class="preview-delete-btn" data-del-idx="${idx}" title="Удалить">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.preview-delete-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.delIdx);
      if (onDeleteCallback) onDeleteCallback(idx);
    });
  });
}

/**
 * Handle Clipboard Paste for Screenshots (Ctrl+V)
 */
function setupClipboardPaste() {
  window.addEventListener('paste', async (e) => {
    const isModalActive = tradeModalEl.classList.contains('active');
    const isRecordTabActive = tabRecordView.style.display !== 'none';

    if (!isModalActive && !isRecordTabActive) return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          showToast('Обработка скриншота из буфера...', 'info');
          try {
            const compressed = await compressImage(file);
            if (isModalActive) {
              modalTradeImages.push(compressed);
              renderImagePreviews('formImagePreviews', modalTradeImages, (idx) => {
                modalTradeImages.splice(idx, 1);
                renderImagePreviews('formImagePreviews', modalTradeImages, null);
              });
            } else {
              recordTradeImages.push(compressed);
              renderImagePreviews('recFormImagePreviews', recordTradeImages, (idx) => {
                recordTradeImages.splice(idx, 1);
                renderImagePreviews('recFormImagePreviews', recordTradeImages, null);
              });
            }
            showToast('Скриншот вставлен!', 'success');
          } catch (err) {
            console.error('Image paste compression failed:', err);
            showToast('Ошибка при вставке изображения', 'error');
          }
        }
      }
    }
  });
}

/**
 * ============================================================================
 * SUBMIT: TAB 1 (ЗАПИСЬ ТРЕЙДА)
 * ============================================================================
 */
async function handleRecordTradeSubmit(e) {
  e.preventDefault();

  const symbol = document.getElementById('recTradeSymbol').value.trim().toUpperCase();
  if (!symbol) {
    showToast('Введите тикер (например BTC/USDT)', 'error');
    return;
  }

  const setup = document.getElementById('recTradeSetup').value.trim();
  if (!setup) {
    showToast('Введите или выберите сетап', 'error');
    return;
  }

  const direction = document.getElementById('recTradeDirection').value;
  const timeframe = document.getElementById('recTradeTimeframe').value || '15m';
  const outcome = document.getElementById('recTradeOutcome').value;
  const entryTime = document.getElementById('recTradeEntryTime').value;
  const exitTime = document.getElementById('recTradeExitTime').value;
  const entryPrice = document.getElementById('recTradeEntryPrice').value.trim();
  const exitPrice = document.getElementById('recTradeExitPrice').value.trim();
  const pnl = document.getElementById('recTradePnl').value.trim() || (outcome === 'WIN' ? '+2.0R' : outcome === 'LOSS' ? '-1.0R' : '0.0R');
  const rMultiple = parseFloat(document.getElementById('recTradeRMultiple').value || 0);
  const notes = document.getElementById('recTradeNotes').value.trim();

  // Auto-save new presets so next time they appear as buttons!
  saveTicker(symbol);
  saveSetup(setup);
  saveTimeframe(timeframe);

  const tradeData = {
    symbol,
    direction,
    timeframe,
    setup,
    outcome,
    entryTime,
    exitTime,
    entryPrice,
    exitPrice,
    pnl,
    rMultiple,
    notes,
    images: [...recordTradeImages]
  };

  try {
    await addTrade(tradeData);
    showToast('Сделка успешно записана в дневник!', 'success');

    // Reset record form
    recordTradeFormEl.reset();
    recordTradeImages = [];
    renderImagePreviews('recFormImagePreviews', [], null);
    initFormTimestamps();
    setRecDirection('LONG');
    setRecOutcome('WIN');
    document.getElementById('recTradeTimeframe').value = '15m';
    renderAllPresetPills();

    // Refresh trades data and switch to journal to see the result
    await refreshTrades();
    switchTab('journal');
  } catch (err) {
    console.error('Failed to save trade:', err);
    showToast('Ошибка при сохранении сделки', 'error');
  }
}

/**
 * ============================================================================
 * MODAL EDIT & SUBMIT
 * ============================================================================
 */
async function editTrade(id) {
  const trade = allTrades.find((t) => t.id === Number(id));
  if (!trade) return;

  editingTradeId = trade.id;
  modalTitleEl.textContent = `Редактирование сделки #${trade.id}`;

  document.getElementById('tradeSymbol').value = trade.symbol || '';
  document.getElementById('tradeSetup').value = trade.setup || '';
  document.getElementById('tradeTimeframe').value = trade.timeframe || '15m';
  document.getElementById('tradeDirection').value = trade.direction || 'LONG';
  document.getElementById('tradeOutcome').value = trade.outcome || 'WIN';
  document.getElementById('tradeEntryTime').value = trade.entryTime || '';
  document.getElementById('tradeExitTime').value = trade.exitTime || '';
  document.getElementById('tradeEntryPrice').value = trade.entryPrice || '';
  document.getElementById('tradeExitPrice').value = trade.exitPrice || '';
  document.getElementById('tradePnl').value = trade.pnl || '';
  document.getElementById('tradeRMultiple').value = trade.rMultiple || '';
  document.getElementById('tradeNotes').value = trade.notes || '';

  // Update direction buttons
  document.querySelectorAll('#tradeForm .seg-btn[data-dir]').forEach((b) => {
    b.classList.toggle('active', b.dataset.dir === (trade.direction || 'LONG'));
  });

  // Update outcome buttons
  document.querySelectorAll('#tradeForm .seg-btn[data-outcome]').forEach((b) => {
    b.classList.toggle('active', b.dataset.outcome === (trade.outcome || 'WIN'));
  });

  // Images
  modalTradeImages = [...(trade.images || [])];
  renderImagePreviews('formImagePreviews', modalTradeImages, (idx) => {
    modalTradeImages.splice(idx, 1);
    renderImagePreviews('formImagePreviews', modalTradeImages, null);
  });

  // Render presets
  renderAllPresetPills();

  tradeModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}
window.editTrade = editTrade;

function closeTradeModal() {
  tradeModalEl.classList.remove('active');
  document.body.style.overflow = '';
}
window.closeTradeModal = closeTradeModal;

async function handleModalTradeSubmit(e) {
  e.preventDefault();

  const symbol = document.getElementById('tradeSymbol').value.trim().toUpperCase();
  if (!symbol) {
    showToast('Введите тикер (например BTC/USDT)', 'error');
    return;
  }

  const setup = document.getElementById('tradeSetup').value.trim();
  const direction = document.getElementById('tradeDirection').value;
  const timeframe = document.getElementById('tradeTimeframe').value;
  const outcome = document.getElementById('tradeOutcome').value;
  const entryTime = document.getElementById('tradeEntryTime').value;
  const exitTime = document.getElementById('tradeExitTime').value;
  const entryPrice = document.getElementById('tradeEntryPrice').value.trim();
  const exitPrice = document.getElementById('tradeExitPrice').value.trim();
  const pnl = document.getElementById('tradePnl').value.trim();
  const rMultiple = parseFloat(document.getElementById('tradeRMultiple').value || 0);
  const notes = document.getElementById('tradeNotes').value.trim();

  // Save presets
  saveTicker(symbol);
  if (setup) saveSetup(setup);
  if (timeframe) saveTimeframe(timeframe);

  const tradeData = {
    symbol,
    direction,
    timeframe,
    setup: setup || 'Без сетапа',
    outcome,
    entryTime,
    exitTime,
    entryPrice,
    exitPrice,
    pnl,
    rMultiple,
    notes,
    images: modalTradeImages
  };

  try {
    if (editingTradeId) {
      tradeData.id = editingTradeId;
      await updateTrade(tradeData);
      showToast('Сделка успешно обновлена!', 'success');
    } else {
      await addTrade(tradeData);
      showToast('Сделка сохранена!', 'success');
    }

    closeTradeModal();
    await refreshTrades();
  } catch (err) {
    console.error('Failed to save trade in modal:', err);
    showToast('Ошибка при сохранении сделки', 'error');
  }
}

async function confirmDeleteTrade(id) {
  if (confirm(`Вы уверены, что хотите удалить сделку #${id}?`)) {
    try {
      await deleteTrade(id);
      showToast(`Сделка #${id} удалена`, 'info');
      await refreshTrades();
    } catch (err) {
      console.error('Failed to delete trade:', err);
      showToast('Ошибка при удалении', 'error');
    }
  }
}
window.confirmDeleteTrade = confirmDeleteTrade;

/**
 * ============================================================================
 * LIGHTBOX VIEWER
 * ============================================================================
 */
function openLightbox(imgSrc, caption = '') {
  lightboxImgEl.src = imgSrc;
  lightboxCaptionEl.textContent = caption;
  lightboxModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}
window.openLightbox = openLightbox;

function closeLightbox() {
  lightboxModalEl.classList.remove('active');
  document.body.style.overflow = '';
}
window.closeLightbox = closeLightbox;

/**
 * ============================================================================
 * BACKUP & RESTORE
 * ============================================================================
 */
function openBackupModal() {
  backupModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}
window.openBackupModal = openBackupModal;

function closeBackupModal() {
  backupModalEl.classList.remove('active');
  document.body.style.overflow = '';
}
window.closeBackupModal = closeBackupModal;

async function handleExportData() {
  try {
    const jsonStr = await exportToJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().substring(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TradeLog_Backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Резервная копия скачана!', 'success');
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Ошибка при экспорте данных', 'error');
  }
}
window.handleExportData = handleExportData;

async function handleImportData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const count = await importFromJSON(e.target.result);
      showToast(`Успешно импортировано сделок: ${count}`, 'success');
      closeBackupModal();
      await refreshTrades();
    } catch (err) {
      console.error('Import failed:', err);
      showToast('Ошибка импорта: некорректный файл', 'error');
    }
  };
  reader.readAsText(file);
}
window.handleImportData = handleImportData;

async function handleResetData() {
  if (confirm('ВНИМАНИЕ! Это действие удалит ВСЕ сохраненные сделки и графики. Продолжить?')) {
    await clearAllTrades();
    showToast('Все данные очищены', 'info');
    closeBackupModal();
    await refreshTrades();
  }
}
window.handleResetData = handleResetData;

/**
 * ============================================================================
 * PWA INSTALLATION
 * ============================================================================
 */
function setupPwaInstall() {
  const installBanner = document.getElementById('pwaInstallBanner');
  const installBtn = document.getElementById('installPwaBtn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBanner) installBanner.style.display = 'flex';
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        showToast('Для установки на iPhone: нажмите «Поделиться» → «На экран Домой»', 'info');
        return;
      }
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        showToast('Приложение установлено!', 'success');
      }
      deferredInstallPrompt = null;
      if (installBanner) installBanner.style.display = 'none';
    });
  }
}

/**
 * ============================================================================
 * FORMATTING HELPERS
 * ============================================================================
 */
function formatMonthName(monthStr) {
  if (!monthStr || monthStr === 'Без даты') return 'Без даты';
  const parts = monthStr.split('-');
  if (parts.length < 2) return monthStr;
  const year = parts[0];
  const monthNum = parseInt(parts[1], 10);
  const monthNamesRu = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const name = monthNamesRu[monthNum - 1] || parts[1];
  return `${name} ${year}`;
}

function formatDateTimeDisplay(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const month = monthNames[d.getMonth()];
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month}, ${hours}:${mins}`;
  } catch {
    return isoStr;
  }
}

function calculateDuration(startIso, endIso) {
  if (!startIso || !endIso) return '—';
  try {
    const t1 = new Date(startIso).getTime();
    const t2 = new Date(endIso).getTime();
    if (isNaN(t1) || isNaN(t2) || t2 < t1) return '—';
    const diffMins = Math.round((t2 - t1) / (1000 * 60));
    if (diffMins < 60) {
      return `${diffMins} мин`;
    }
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}ч ${mins}м` : `${hours}ч`;
  } catch {
    return '—';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  } else {
    iconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  }

  toast.innerHTML = `${iconSvg} <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}
window.showToast = showToast;
