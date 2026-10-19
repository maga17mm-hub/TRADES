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
const tabHomeView = document.getElementById('tabHomeView');
const tabRecordView = document.getElementById('tabRecordView');
const tabJournalView = document.getElementById('tabJournalView');
const tabSettingsView = document.getElementById('tabSettingsView');
const navBtnHome = document.getElementById('navBtnHome');
const navBtnRecord = document.getElementById('navBtnRecord');
const navBtnJournal = document.getElementById('navBtnJournal');
const navBtnSettings = document.getElementById('navBtnSettings');

// DOM Elements - Calendar
const calMonthTitleEl = document.getElementById('calMonthTitle');
const calMonthTradesSummaryEl = document.getElementById('calMonthTradesSummary');
const calDaysGridEl = document.getElementById('calDaysGrid');
const calDayDetailsEl = document.getElementById('calDayDetails');

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

// App Build Version for auto cache invalidation
const CURRENT_APP_BUILD = 'v35';

function checkAppBuildVersion() {
  try {
    const savedBuild = localStorage.getItem('tradelog_app_build');
    if (savedBuild !== CURRENT_APP_BUILD) {
      localStorage.setItem('tradelog_app_build', CURRENT_APP_BUILD);
      if ('caches' in window) {
        caches.keys().then((keys) => {
          return Promise.all(
            keys.map((k) => {
              if (k !== 'tradelog-' + CURRENT_APP_BUILD) {
                return caches.delete(k);
              }
            })
          );
        }).catch(() => {});
      }
    }
  } catch (_) {}
}

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  // Check build version
  checkAppBuildVersion();

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

  // Initialize App Theme
  initAppTheme();

  // Setup PWA install banner
  setupPwaInstall();

  // Load trades from DB
  await refreshTrades();

  // Restore active tab (default to 'home' or saved tab)
  const savedTab = localStorage.getItem('tradelog_active_tab');
  if (savedTab === 'journal') {
    switchTab('journal');
  } else if (savedTab === 'settings') {
    switchTab('settings');
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
      navigator.serviceWorker.register('./sw.js?v=25', { updateViaCache: 'none' })
        .then((reg) => {
          try { reg.update(); } catch (_) {}
        })
        .catch((err) => console.log('Service Worker failed:', err));
    });

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

/**
 * Tab Navigation (Домой <-> Дневник <-> Настройки)
 */
function switchTab(tabName) {
  // If a modal or lightbox is open, do not switch tabs in background
  if (
    document.body.classList.contains('modal-open') ||
    document.body.classList.contains('lightbox-open') ||
    document.documentElement.classList.contains('lightbox-open') ||
    (lightboxModalEl && lightboxModalEl.classList.contains('active'))
  ) {
    return;
  }

  const tabHomeView = document.getElementById('tabHomeView');
  const tabRecordView = document.getElementById('tabRecordView');
  const tabJournalView = document.getElementById('tabJournalView');
  const tabSettingsView = document.getElementById('tabSettingsView');

  const navBtnHome = document.getElementById('navBtnHome');
  const navBtnJournal = document.getElementById('navBtnJournal');
  const navBtnSettings = document.getElementById('navBtnSettings');

  if (tabName === 'journal') {
    if (tabHomeView) tabHomeView.style.display = 'none';
    if (tabRecordView) tabRecordView.style.display = 'none';
    if (tabJournalView) tabJournalView.style.display = 'block';
    if (tabSettingsView) tabSettingsView.style.display = 'none';

    if (navBtnHome) navBtnHome.classList.remove('active');
    if (navBtnJournal) navBtnJournal.classList.add('active');
    if (navBtnSettings) navBtnSettings.classList.remove('active');

    localStorage.setItem('tradelog_active_tab', 'journal');
    if (typeof renderJournalThoughtsFeed === 'function') {
      renderJournalThoughtsFeed();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } else if (tabName === 'settings') {
    if (tabHomeView) tabHomeView.style.display = 'none';
    if (tabRecordView) tabRecordView.style.display = 'none';
    if (tabJournalView) tabJournalView.style.display = 'none';
    if (tabSettingsView) tabSettingsView.style.display = 'block';

    if (navBtnHome) navBtnHome.classList.remove('active');
    if (navBtnJournal) navBtnJournal.classList.remove('active');
    if (navBtnSettings) navBtnSettings.classList.add('active');

    localStorage.setItem('tradelog_active_tab', 'settings');
    populateSettingsVoiceList();
    updateThemeCardsUI();
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } else {
    // 'home' tab
    if (tabHomeView) tabHomeView.style.display = 'block';
    if (tabRecordView) tabRecordView.style.display = 'none';
    if (tabJournalView) tabJournalView.style.display = 'none';
    if (tabSettingsView) tabSettingsView.style.display = 'none';

    if (navBtnHome) navBtnHome.classList.add('active');
    if (navBtnJournal) navBtnJournal.classList.remove('active');
    if (navBtnSettings) navBtnSettings.classList.remove('active');

    localStorage.setItem('tradelog_active_tab', 'home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    updateAnalytics();
    renderCalendar();
    renderMonthPills();
    renderSetupPills();
    renderTradesFeed();
  }
}
window.switchTab = switchTab;

/**
 * ============================================================================
 * TRADING CALENDAR ENGINE (Raycast Midnight Theme)
 * Shows calendar month view with indicators on days where trades were taken.
 * ============================================================================
 */
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-indexed
let calSelectedDate = null; // 'YYYY-MM-DD'

const MONTH_NAMES_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

function getTradesByDateKey() {
  const map = {};
  allTrades.forEach((t) => {
    if (!t.entryTime) return;
    const dateKey = t.entryTime.substring(0, 10); // 'YYYY-MM-DD'
    if (!map[dateKey]) map[dateKey] = [];
    map[dateKey].push(t);
  });
  return map;
}

function renderCalendar() {
  if (!calDaysGridEl) return;

  const currentYear = calCurrentYear;
  const currentMonth = calCurrentMonth;
  const monthKeyPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  // Update header month & year
  if (calMonthTitleEl) {
    calMonthTitleEl.textContent = `${MONTH_NAMES_RU[currentMonth]} ${currentYear}`;
  }

  // Count trades for this month
  const tradesByDate = getTradesByDateKey();
  let monthTradesCount = 0;
  let monthPnlR = 0;

  allTrades.forEach((t) => {
    if (t.entryTime && t.entryTime.startsWith(monthKeyPrefix)) {
      monthTradesCount++;
      monthPnlR += parseFloat(t.rMultiple || 0);
    }
  });

  if (calMonthTradesSummaryEl) {
    const pnlPrefix = monthPnlR > 0 ? '+' : '';
    const pnlSuffix = monthTradesCount > 0 ? ` · ${pnlPrefix}${monthPnlR.toFixed(1)}R` : '';
    calMonthTradesSummaryEl.textContent = `${monthTradesCount} ${getTradeCountWord(monthTradesCount)}${pnlSuffix}`;
  }

  // Calendar calculations
  // Days in current month
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  // First day index (Monday = 0, Sunday = 6)
  const firstDayIndex = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7;

  // Today key
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let html = '';

  // Leading empty cells
  for (let i = 0; i < firstDayIndex; i++) {
    html += '<div class="cal-day empty"></div>';
  }

  // Days of month
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTrades = tradesByDate[dateKey] || [];
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === calSelectedDate;

    let dayClasses = ['cal-day'];
    if (isToday) dayClasses.push('today');
    if (isSelected) dayClasses.push('selected');

    let badgeHtml = '';

    if (dayTrades.length > 0) {
      dayClasses.push('has-trades');

      let wins = 0;
      let losses = 0;
      let bes = 0;
      let dayR = 0;

      dayTrades.forEach((t) => {
        dayR += parseFloat(t.rMultiple || 0);
        if (t.outcome === 'WIN') wins++;
        else if (t.outcome === 'LOSS') losses++;
        else bes++;
      });

      let outcomeType = 'mixed';
      if (wins > 0 && losses === 0) outcomeType = 'win';
      else if (losses > 0 && wins === 0) outcomeType = 'loss';
      else if (bes > 0 && wins === 0 && losses === 0) outcomeType = 'be';

      dayClasses.push(`outcome-${outcomeType}`);

      const pnlPrefix = dayR > 0 ? '+' : '';
      const rText = `${pnlPrefix}${dayR.toFixed(1)}R`;

      badgeHtml = `
        <div class="cal-day-pill ${outcomeType}" title="${dayTrades.length} ${getTradeCountWord(dayTrades.length)} (${wins}W / ${losses}L / ${bes}BE)">
          <span class="cal-dot ${outcomeType}"></span>
          <span>${rText}</span>
        </div>
      `;
    }

    html += `
      <div class="${dayClasses.join(' ')}" onclick="selectCalDay('${dateKey}')">
        <div class="cal-day-header">
          <span class="cal-day-number">${day}</span>
        </div>
        ${badgeHtml}
      </div>
    `;
  }

  calDaysGridEl.innerHTML = html;

  // Render selected day details if any
  renderCalDayDetails(tradesByDate);
}

function selectCalDay(dateKey) {
  if (calSelectedDate === dateKey) {
    calSelectedDate = null; // toggle off
  } else {
    calSelectedDate = dateKey;
  }
  renderCalendar();
}
window.selectCalDay = selectCalDay;

function prevCalMonth() {
  calCurrentMonth--;
  if (calCurrentMonth < 0) {
    calCurrentMonth = 11;
    calCurrentYear--;
  }
  renderCalendar();
}
window.prevCalMonth = prevCalMonth;

function nextCalMonth() {
  calCurrentMonth++;
  if (calCurrentMonth > 11) {
    calCurrentMonth = 0;
    calCurrentYear++;
  }
  renderCalendar();
}
window.nextCalMonth = nextCalMonth;

function resetCalToday() {
  const now = new Date();
  calCurrentYear = now.getFullYear();
  calCurrentMonth = now.getMonth();
  calSelectedDate = `${calCurrentYear}-${String(calCurrentMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  renderCalendar();
}
window.resetCalToday = resetCalToday;

function renderCalDayDetails(tradesByDate) {
  if (!calDayDetailsEl) return;

  if (!calSelectedDate) {
    calDayDetailsEl.style.display = 'none';
    calDayDetailsEl.innerHTML = '';
    return;
  }

  const dayTrades = tradesByDate[calSelectedDate] || [];
  const dateParts = calSelectedDate.split('-');
  const formattedDate = `${parseInt(dateParts[2], 10)} ${MONTH_NAMES_RU[parseInt(dateParts[1], 10) - 1]} ${dateParts[0]}`;

  calDayDetailsEl.style.display = 'block';

  if (dayTrades.length === 0) {
    calDayDetailsEl.innerHTML = `
      <div class="cal-details-header">
        <div class="cal-details-title">
          <span style="display: inline-flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            ${formattedDate}
          </span>
          <span class="cal-details-badge" style="background: var(--color-ink); color: var(--color-smoke);">Нет сделок</span>
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="openNewTradeForDate('${calSelectedDate}')">
          + Записать трейд на этот день
        </button>
      </div>
      <p style="font-size: 0.8rem; color: var(--color-smoke); margin: 0;">В этот день сделок не зафиксировано.</p>
    `;
    return;
  }

  let totalR = 0;
  let wins = 0;
  let losses = 0;
  dayTrades.forEach((t) => {
    totalR += parseFloat(t.rMultiple || 0);
    if (t.outcome === 'WIN') wins++;
    else if (t.outcome === 'LOSS') losses++;
  });

  const pnlPrefix = totalR > 0 ? '+' : '';
  const pnlClass = totalR > 0 ? 'stat-win' : totalR < 0 ? 'stat-loss' : '';

  let tradesHtml = dayTrades.map((t) => {
    const outcomeBadge = t.outcome === 'WIN' 
      ? '<span class="pill-badge" style="background: rgba(89,212,153,0.15); color: var(--win);">WIN</span>'
      : t.outcome === 'LOSS'
      ? '<span class="pill-badge" style="background: rgba(255,99,99,0.15); color: var(--loss);">LOSS</span>'
      : '<span class="pill-badge" style="background: rgba(156,156,157,0.15); color: var(--be);">BE</span>';

    const dirBadge = t.direction === 'LONG'
      ? '<span style="color: var(--win); font-weight: 600;">LONG</span>'
      : '<span style="color: var(--loss); font-weight: 600;">SHORT</span>';

    const rVal = parseFloat(t.rMultiple || 0);
    const rPrefix = rVal > 0 ? '+' : '';
    const rClass = rVal > 0 ? 'stat-win' : rVal < 0 ? 'stat-loss' : '';

    return `
      <div class="cal-trade-item" onclick="openTradeDetailModal(${t.id})" style="cursor: pointer;">
        <div class="cal-trade-main">
          ${outcomeBadge}
          <span class="cal-trade-symbol">${escapeHtml(t.symbol)}</span>
          <span class="cal-trade-meta">${dirBadge} · ${escapeHtml(t.timeframe || '')} · ${escapeHtml(t.setup || 'Без сетапа')}</span>
        </div>
        <div class="cal-trade-pnl ${rClass}">
          ${rPrefix}${rVal.toFixed(1)} R
        </div>
      </div>
    `;
  }).join('');

  calDayDetailsEl.innerHTML = `
    <div class="cal-details-header">
      <div class="cal-details-title">
        <span style="display: inline-flex; align-items: center; gap: 6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          ${formattedDate}
        </span>
        <span class="cal-details-badge ${pnlClass}" style="background: var(--color-ink);">
          ${dayTrades.length} ${getTradeCountWord(dayTrades.length)} · ${pnlPrefix}${totalR.toFixed(1)} R
        </span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="openNewTradeForDate('${calSelectedDate}')">
        + Добавить сделку
      </button>
    </div>
    <div class="cal-trades-list">
      ${tradesHtml}
    </div>
  `;
}

function openNewTradeForDate(dateStr) {
  openTradeModal();
  const dateInput = document.getElementById('tradeEntryTime');
  const exitInput = document.getElementById('tradeExitTime');
  if (dateInput) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    dateInput.value = `${dateStr}T${timeStr}`;
    if (exitInput) exitInput.value = `${dateStr}T${timeStr}`;
  }
}
window.openNewTradeForDate = openNewTradeForDate;

function getTradeCountWord(n) {
  const abs = Math.abs(n) % 100;
  const num = abs % 10;
  if (abs > 10 && abs < 20) return 'сделок';
  if (num > 1 && num < 5) return 'сделки';
  if (num === 1) return 'сделка';
  return 'сделок';
}

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

const DEFAULT_PRESETS = {
  symbol: [
    'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XAU/USD', 'BNB/USDT',
    'XRP/USDT', 'TON/USDT', 'SUI/USDT', 'DOGE/USDT', 'AVAX/USDT',
    'LINK/USDT', 'NEAR/USDT', 'PEPE/USDT', 'EUR/USD', 'GBP/USD'
  ],
  direction: [
    'LONG', 'SHORT'
  ],
  setup: [
    'Breakout / Пробой',
    'Order Block (OB)',
    'FVG / Imbalance',
    'Liquidity Sweep',
    'CHoCH / Слом структуры',
    'Support & Resistance',
    'Trend Continuation',
    'SFP / Ложный пробой',
    'Range / Боковик'
  ],
  timeframe: [
    '1m', '3m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'
  ],
  criteria: [
    'Тренд старшего ТФ + Слом структуры',
    'Снятие ликвидности (Sweep)',
    'Тест Order Block (OB)',
    'Тест зоны FVG / Imbalance',
    'Дивергенция RSI / MACD',
    'Паттерн подтверждения (Пин-бар / Поглощение)',
    'Круглый уровень / Уровень поддержки/сопротивления',
    'Объёмный всплеск (Volume Spike)'
  ]
};

function getCustomPresets(type) {
  try {
    const raw = localStorage.getItem('tradelog_presets_' + type);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return [...(DEFAULT_PRESETS[type] || [])];
}
window.getCustomPresets = getCustomPresets;

function saveCustomPresets(type, list) {
  try {
    localStorage.setItem('tradelog_presets_' + type, JSON.stringify(list));
  } catch (e) {}
}
window.saveCustomPresets = saveCustomPresets;

function resetCustomPresets(type) {
  saveCustomPresets(type, DEFAULT_PRESETS[type]);
  renderPresetManager(type);
  populatePresetSelects(type);
  showToast('Список сброшен к исходным значениям', 'info');
}
window.resetCustomPresets = resetCustomPresets;

function deletePresetItem(type, itemToDelete) {
  const list = getCustomPresets(type).filter((item) => item !== itemToDelete);
  if (list.length === 0) {
    showToast('В списке должен оставаться хотя бы один пункт', 'warning');
    return;
  }
  saveCustomPresets(type, list);
  renderPresetManager(type);
  populatePresetSelects(type);
  showToast(`«${itemToDelete}» удален из списка`, 'info');
}
window.deletePresetItem = deletePresetItem;

function addPresetItem(type) {
  const inputEl = document.getElementById(`newPresetInput_${type}`);
  if (!inputEl) return;
  const val = inputEl.value.trim();
  if (!val) return;

  const list = getCustomPresets(type);
  if (list.includes(val)) {
    showToast('Такой пункт уже есть в списке', 'warning');
    return;
  }
  list.push(val);
  saveCustomPresets(type, list);
  inputEl.value = '';
  renderPresetManager(type);
  populatePresetSelects(type, val);
  showToast(`«${val}» добавлен в список!`, 'success');
}
window.addPresetItem = addPresetItem;

function togglePresetManager(type) {
  const panel = document.getElementById(`presetManager_${type}`);
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    renderPresetManager(type);
  }
}
window.togglePresetManager = togglePresetManager;

function renderPresetManager(type) {
  const panel = document.getElementById(`presetManager_${type}`);
  if (!panel) return;

  const list = getCustomPresets(type);
  const chipsHtml = list.map((item) => {
    const escapedItem = escapeHtml(item);
    const itemArg = item.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `
      <span class="preset-manage-chip">
        <span class="preset-chip-text">${escapedItem}</span>
        <button type="button" class="preset-chip-del" onclick="deletePresetItem('${type}', '${itemArg}')" title="Удалить из списка"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
      </span>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="preset-manager-header">
      <span class="preset-mgr-title">Настройка списка (нажмите на крестик для удаления):</span>
      <button type="button" class="preset-mgr-reset" onclick="resetCustomPresets('${type}')">Сброс</button>
    </div>
    <div class="preset-chips-cloud">
      ${chipsHtml}
    </div>
    <div class="preset-add-row">
      <input type="text" id="newPresetInput_${type}" class="form-input form-input-sm" placeholder="Добавить свой пункт..." onkeydown="if(event.key==='Enter'){event.preventDefault();addPresetItem('${type}');}">
      <button type="button" class="btn btn-secondary btn-sm" onclick="addPresetItem('${type}')">+ Добавить</button>
    </div>
  `;
}
window.renderPresetManager = renderPresetManager;

function populatePresetSelects(targetType, selectValueToKeep) {
  const typesToPopulate = targetType ? [targetType] : ['symbol', 'direction', 'setup', 'timeframe', 'criteria'];

  typesToPopulate.forEach((type) => {
    const list = getCustomPresets(type);

    if (type === 'symbol') {
      const select = document.getElementById('tradeSymbol');
      if (select) {
        const curVal = selectValueToKeep || select.value;
        let opts = list.map((sym) => `<option value="${escapeHtml(sym)}">${escapeHtml(sym)}</option>`).join('');
        opts += `<option value="__custom__">+ Ввести свой тикер...</option>`;
        select.innerHTML = opts;
        if (curVal && (list.includes(curVal) || curVal === '__custom__')) {
          select.value = curVal;
        } else if (list.length > 0) {
          select.value = list[0];
        }
      }
    } else if (type === 'direction') {
      const select = document.getElementById('tradeDirection');
      if (select) {
        const curVal = selectValueToKeep || select.value;
        const opts = list.map((dir) => {
          const arrow = dir.toUpperCase().includes('SHORT') ? '▼' : '▲';
          return `<option value="${escapeHtml(dir)}">${arrow} ${escapeHtml(dir)}</option>`;
        }).join('');
        select.innerHTML = opts;
        if (curVal && list.includes(curVal)) {
          select.value = curVal;
        } else if (list.length > 0) {
          select.value = list[0];
        }
      }
    } else if (type === 'setup') {
      const select = document.getElementById('tradeSetup');
      if (select) {
        const curVal = selectValueToKeep || select.value;
        let opts = list.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        opts += `<option value="__custom__">+ Ввести свой сетап...</option>`;
        select.innerHTML = opts;
        if (curVal && (list.includes(curVal) || curVal === '__custom__')) {
          select.value = curVal;
        } else if (list.length > 0) {
          select.value = list[0];
        }
      }
    } else if (type === 'timeframe') {
      const select = document.getElementById('tradeTimeframe');
      if (select) {
        const curVal = selectValueToKeep || select.value;
        const opts = list.map((tf) => `<option value="${escapeHtml(tf)}">${escapeHtml(tf)}</option>`).join('');
        select.innerHTML = opts;
        if (curVal && list.includes(curVal)) {
          select.value = curVal;
        } else if (list.includes('15m')) {
          select.value = '15m';
        } else if (list.length > 0) {
          select.value = list[0];
        }
      }
    } else if (type === 'criteria') {
      const select = document.getElementById('tradeCriteria');
      if (select) {
        const curVal = selectValueToKeep || select.value;
        let opts = list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        opts += `<option value="__custom__">+ Ввести свои критерии...</option>`;
        select.innerHTML = opts;
        if (curVal && (list.includes(curVal) || curVal === '__custom__')) {
          select.value = curVal;
        } else if (list.length > 0) {
          select.value = list[0];
        }
      }
    }
  });
}
window.populatePresetSelects = populatePresetSelects;

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
  populatePresetSelects();
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
        <span class="preset-chip-del" onclick="event.stopPropagation(); handleDeleteTicker('${escapeHtml(t)}')"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
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
        <span class="preset-chip-del" onclick="event.stopPropagation(); handleDeleteSetup('${escapeHtml(s)}')"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
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
        <span class="preset-chip-del" onclick="event.stopPropagation(); handleDeleteTimeframe('${escapeHtml(tf)}')"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span>
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
    renderCalendar();
    renderMonthPills();
    renderSetupPills();
    renderTradesFeed();
  } catch (err) {
    console.error('Failed to refresh trades:', err);
    showToast('Ошибка загрузки данных', 'error');
  }
}

function updateAnalytics() {
  const total = allTrades.length;

  if (total === 0) {
    if (statWinrateEl) {
      statWinrateEl.textContent = '0%';
      statWinrateEl.className = 'stat-value';
    }
    if (statPnlEl) {
      statPnlEl.textContent = '0.0 R';
      statPnlEl.className = 'stat-value';
    }
    if (statTotalEl) statTotalEl.textContent = '0';
    if (statBestSetupEl) statBestSetupEl.textContent = '—';
    return;
  }

  let wins = 0;
  let losses = 0;
  let be = 0;
  let totalR = 0;
  const setupStats = {};

  allTrades.forEach((t) => {
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

  if (statWinrateEl) {
    statWinrateEl.textContent = `${winrate}%`;
    statWinrateEl.className = `stat-value ${winrate >= 50 ? 'stat-win' : 'stat-loss'}`;
  }

  if (statPnlEl) {
    const pnlPrefix = totalR > 0 ? '+' : '';
    statPnlEl.textContent = `${pnlPrefix}${totalR.toFixed(1)} R`;
    statPnlEl.className = `stat-value ${totalR > 0 ? 'stat-win' : totalR < 0 ? 'stat-loss' : ''}`;
  }

  if (statTotalEl) {
    statTotalEl.innerHTML = `${total} <span class="stat-subtext" style="display:inline-flex;margin:0;">(<span class="stat-win">${wins}W</span> / <span class="stat-loss">${losses}L</span> / ${be}BE)</span>`;
  }

  if (statBestSetupEl) {
    statBestSetupEl.textContent = bestSetupName;
  }
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

let currentGroupBy = 'month';
let currentSortBy = 'date_desc';

function toggleTradesFilterPanel() {
  const panel = document.getElementById('tradesFilterPanel');
  const label = document.getElementById('filterToggleBtnLabel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'block' : 'none';
  if (label) {
    label.innerHTML = isHidden ? 'Скрыть фильтры ▴' : 'Фильтры и сортировка ▾';
  }
}
window.toggleTradesFilterPanel = toggleTradesFilterPanel;

function setTradesGrouping(groupBy) {
  currentGroupBy = groupBy;
  const btnGroup = document.getElementById('groupingBtnGroup');
  if (btnGroup) {
    btnGroup.querySelectorAll('.toolbar-seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.groupby === groupBy);
    });
  }
  renderTradesFeed();
}
window.setTradesGrouping = setTradesGrouping;

function setTradesSorting(sortBy) {
  currentSortBy = sortBy;
  renderTradesFeed();
}
window.setTradesSorting = setTradesSorting;

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
        <div class="empty-title">Здесь начинается история</div>
        <div class="empty-desc">Добавьте сделку, чтобы увидеть свой прогресс. Если вы уже ведёте журнал, проверьте выбранные фильтры.</div>
        <button class="btn btn-primary" onclick="openTradeModal()">+ Записать сделку</button>
      </div>
    `;
    return;
  }

  // Sort trades according to currentSortBy
  const sortedTrades = [...filtered].sort((a, b) => {
    if (currentSortBy === 'date_desc') {
      return new Date(b.entryTime || b.createdAt || 0) - new Date(a.entryTime || a.createdAt || 0);
    }
    if (currentSortBy === 'date_asc') {
      return new Date(a.entryTime || a.createdAt || 0) - new Date(b.entryTime || b.createdAt || 0);
    }
    if (currentSortBy === 'pnl_desc') {
      return (parseFloat(b.rMultiple) || 0) - (parseFloat(a.rMultiple) || 0);
    }
    if (currentSortBy === 'pnl_asc') {
      return (parseFloat(a.rMultiple) || 0) - (parseFloat(b.rMultiple) || 0);
    }
    if (currentSortBy === 'entry_price') {
      const pa = parseFloat(String(a.entryPrice || '0').replace(/[^0-9.]/g, '')) || 0;
      const pb = parseFloat(String(b.entryPrice || '0').replace(/[^0-9.]/g, '')) || 0;
      return pb - pa;
    }
    return 0;
  });

  // Group trades
  const groups = {};
  sortedTrades.forEach((t) => {
    let key = 'Все сделки';
    if (currentGroupBy === 'month') {
      key = t.month || 'Без месяца';
    } else if (currentGroupBy === 'setup') {
      key = t.setup || 'Без сетапа';
    } else if (currentGroupBy === 'timeframe') {
      key = t.timeframe || 'Без тайфрейма';
    } else if (currentGroupBy === 'all') {
      key = 'Все сделки';
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  let groupKeys = Object.keys(groups);
  if (currentGroupBy === 'month') {
    groupKeys.sort().reverse();
  }

  let fullHtml = '';
  groupKeys.forEach((key) => {
    const groupTrades = groups[key];
    let groupTitle = key;
    let groupIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>';

    if (currentGroupBy === 'month') {
      groupTitle = formatMonthName(key);
      groupIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
    } else if (currentGroupBy === 'setup') {
      groupTitle = `Сетап: ${key}`;
      groupIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="2" r="2"></circle></svg>';
    } else if (currentGroupBy === 'timeframe') {
      groupTitle = `Таймфрейм: ${key}`;
      groupIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    }

    let gWins = 0;
    let gLosses = 0;
    let gTotalR = 0;
    groupTrades.forEach((t) => {
      if (t.outcome === 'WIN') gWins++;
      if (t.outcome === 'LOSS') gLosses++;
      gTotalR += parseFloat(t.rMultiple || 0);
    });

    const gDecisive = gWins + gLosses;
    const gWinrate = gDecisive > 0 ? Math.round((gWins / gDecisive) * 100) : 0;
    const rPrefix = gTotalR > 0 ? '+' : '';

    fullHtml += `
      <div class="month-group">
        <div class="month-group-header">
          <div class="month-header-left">
            <span style="display: inline-flex; align-items: center; line-height: 1; color: var(--text-muted);">${groupIcon}</span>
            <span class="month-title">${escapeHtml(groupTitle)}</span>
            <span class="pill-badge">${groupTrades.length} сделок</span>
          </div>
          <div class="month-header-stats">
            <span>WR: <strong class="${gWinrate >= 50 ? 'stat-win' : 'stat-loss'}">${gWinrate}%</strong></span>
            <span>Итог: <strong class="${gTotalR > 0 ? 'stat-win' : gTotalR < 0 ? 'stat-loss' : ''}">${rPrefix}${gTotalR.toFixed(1)}R</strong></span>
          </div>
        </div>

        <div class="month-cards-container">
          ${groupTrades.map((trade) => renderTradeCard(trade)).join('')}
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

  return `
    <div class="trade-card ${outcomeClass} trade-card-compact-row" id="trade-card-${t.id}" onclick="openTradeDetailModal('${t.id}')" title="Нажмите, чтобы открыть подробности сделки">
      <div class="trade-compact-main">
        <span class="trade-symbol">${escapeHtml(t.symbol || 'ASSET')}</span>
        <span class="direction-badge ${dirClass}">${escapeHtml(t.direction || 'LONG')}</span>
        <span class="setup-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="2" r="2"></circle></svg>${escapeHtml(t.setup || 'Без сетапа')}</span>
        <span class="outcome-badge ${outcomeClass}">${outcomeLabel}</span>
      </div>

      <div class="trade-compact-btn-wrap" onclick="event.stopPropagation()">
        <button type="button" class="btn btn-secondary btn-sm btn-trade-detail-trigger" onclick="openTradeDetailModal('${t.id}')" title="Подробнее о сделке">
          <span>Подробнее</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>
    </div>
  `;
}

let savedTradeDetailScrollY = 0;
let savedTradeModalScrollY = 0;

function openTradeDetailModal(id) {
  const trade = allTrades.find((t) => String(t.id) === String(id));
  if (!trade) return;

  const modal = document.getElementById('tradeDetailModal');
  const body = document.getElementById('tradeDetailBody');
  if (!modal || !body) return;

  savedTradeDetailScrollY = window.scrollY || document.documentElement.scrollTop || 0;

  const outcomeClass = (trade.outcome || 'be').toLowerCase();
  const dirClass = (trade.direction || 'long').toLowerCase();
  const outcomeLabel = trade.outcome === 'WIN' ? 'Тейк-профит' : trade.outcome === 'LOSS' ? 'Стоп-лосс' : 'Безубыток';
  const entryFormatted = formatDateTimeDisplay(trade.entryTime);
  const exitFormatted = formatDateTimeDisplay(trade.exitTime);
  const durationText = calculateDuration(trade.entryTime, trade.exitTime);
  const pnlDisplay = escapeHtml(trade.pnl || '0R');
  const criteriaValue = (trade.criteria || trade.entryCriteria || trade.entry_criteria || '').trim();

  let imagesHtml = '';
  if (trade.images && trade.images.length > 0) {
    imagesHtml = `
      <div style="margin-top: 16px;">
        <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; margin-bottom: 8px;">
          Скриншоты сделки (${trade.images.length})
        </div>
        <div class="trade-thumbnails-grid">
          ${trade.images.map((img, idx) => `
            <div class="thumbnail-box" data-trade-id="${trade.id}" data-img-idx="${idx}" onclick="openLightbox('${img.dataUrl}', '${escapeHtml(trade.symbol || '')} (${escapeHtml(trade.timeframe || '')})')">
              <img src="${img.dataUrl}" alt="Скриншот сделки" loading="lazy">
              <span class="thumbnail-tag">#${idx + 1}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  let notesHtml = '';
  if (trade.notes && trade.notes.trim()) {
    notesHtml = `
      <div style="margin-top: 16px;">
        <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; margin-bottom: 6px;">
          Заметки по сделке
        </div>
        <div class="trade-detail-notes-box">
          ${escapeHtml(trade.notes)}
        </div>
      </div>
    `;
  }

  body.innerHTML = `
    <!-- Top Hero Banner -->
    <div class="trade-detail-hero ${outcomeClass}">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="trade-detail-symbol">${escapeHtml(trade.symbol || 'ASSET')}</span>
          <span class="direction-badge ${dirClass}">${escapeHtml(trade.direction || 'LONG')}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="outcome-badge ${outcomeClass}">${outcomeLabel}</span>
          <span class="trade-pnl-text ${outcomeClass}" style="font-size: 1.15rem; margin: 0;">${pnlDisplay}</span>
        </div>
      </div>
    </div>

    <!-- Metrics Grid -->
    <div class="trade-detail-grid">
      <div class="trade-detail-item">
        <span class="trade-detail-label">Сетап</span>
        <span class="trade-detail-val">${escapeHtml(trade.setup || '—')}</span>
      </div>
      <div class="trade-detail-item">
        <span class="trade-detail-label">Таймфрейм</span>
        <span class="trade-detail-val">${escapeHtml(trade.timeframe || '—')}</span>
      </div>
      <div class="trade-detail-item">
        <span class="trade-detail-label">Цена входа</span>
        <span class="trade-detail-val">${escapeHtml(trade.entryPrice || '—')}</span>
      </div>
      <div class="trade-detail-item">
        <span class="trade-detail-label">Тейк / Выход</span>
        <span class="trade-detail-val">${escapeHtml(trade.exitPrice || '—')}</span>
      </div>
      <div class="trade-detail-item">
        <span class="trade-detail-label">Вход в сделку</span>
        <span class="trade-detail-val">${entryFormatted || '—'}</span>
      </div>
      <div class="trade-detail-item">
        <span class="trade-detail-label">Выход из сделки</span>
        <span class="trade-detail-val">${exitFormatted || '—'}</span>
      </div>
      <div class="trade-detail-item">
        <span class="trade-detail-label">Длительность</span>
        <span class="trade-detail-val">${durationText || '—'}</span>
      </div>
      <div class="trade-detail-item trade-detail-item-full">
        <span class="trade-detail-label">Критерии входа</span>
        <div class="trade-detail-val trade-detail-criteria-val">
          ${criteriaValue ? `<span class="trade-criteria-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>${escapeHtml(criteriaValue)}</span>` : '<span class="trade-detail-empty">Не указаны</span>'}
        </div>
      </div>
    </div>

    ${notesHtml}
    ${imagesHtml}

    <!-- Modal Actions Footer (with Edit & Delete) -->
    <div class="trade-detail-footer">
      <button type="button" class="btn btn-secondary btn-sm" onclick="closeTradeDetailModal(); confirmDeleteTrade('${trade.id}')" style="color: var(--loss); border-color: rgba(244, 63, 94, 0.25);">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Удалить сделку</span>
      </button>

      <div style="display: inline-flex; align-items: center; gap: 8px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="closeTradeDetailModal()">
          Закрыть
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="closeTradeDetailModal(); editTrade('${trade.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          <span>Изменить сделку</span>
        </button>
      </div>
    </div>
  `;

  modal.classList.add('active');
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');
  if (window.innerWidth < 768) {
    document.body.style.top = `-${savedTradeDetailScrollY}px`;
  }
}
window.openTradeDetailModal = openTradeDetailModal;

function closeTradeDetailModal() {
  const modal = document.getElementById('tradeDetailModal');
  if (modal) {
    modal.classList.remove('active');
  }
  const otherActiveModal = document.querySelector('.modal-overlay.active:not(#tradeDetailModal), .ai-modal-overlay.active');
  if (!otherActiveModal) {
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    document.body.style.overflow = '';
    const restoreY = Math.abs(parseInt(document.body.style.top || '0', 10)) || savedTradeDetailScrollY;
    document.body.style.top = '';
    if (restoreY && window.innerWidth < 768) {
      window.scrollTo(0, restoreY);
    }
  }
}
window.closeTradeDetailModal = closeTradeDetailModal;

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
  const el = document.getElementById('recTradeDirection');
  if (el) el.value = dir;
  document.querySelectorAll('#recordTradeForm .seg-btn[data-dir]').forEach((b) => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}
window.setRecDirection = setRecDirection;

function setRecOutcome(outcome) {
  const el = document.getElementById('recTradeOutcome');
  if (el) el.value = outcome;
  document.querySelectorAll('#recordTradeForm .seg-btn[data-outcome]').forEach((b) => {
    b.classList.toggle('active', b.dataset.outcome === outcome);
  });

  const pnlInput = document.getElementById('recTradePnl');
  const rInput = document.getElementById('recTradeRMultiple');
  if (pnlInput && rInput) {
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
}
window.setRecOutcome = setRecOutcome;

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Journal Search & Filters (if present)
  if (searchInputEl) {
    searchInputEl.addEventListener('input', (e) => {
      currentFilter.searchQuery = e.target.value;
      updateAnalytics();
      renderTradesFeed();
    });
  }

  if (filterTfSelectEl) {
    filterTfSelectEl.addEventListener('change', (e) => {
      currentFilter.timeframe = e.target.value;
      updateAnalytics();
      renderTradesFeed();
    });
  }

  if (filterOutcomeSelectEl) {
    filterOutcomeSelectEl.addEventListener('change', (e) => {
      currentFilter.outcome = e.target.value;
      updateAnalytics();
      renderTradesFeed();
    });
  }

  if (filterDirectionSelectEl) {
    filterDirectionSelectEl.addEventListener('change', (e) => {
      currentFilter.direction = e.target.value;
      updateAnalytics();
      renderTradesFeed();
    });
  }

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
  const recTradePnlEl = document.getElementById('recTradePnl');
  if (recTradePnlEl) {
    recTradePnlEl.addEventListener('input', (e) => {
      const match = e.target.value.match(/([+-]?\d+(?:\.\d+)?)/);
      const recTradeRMultipleEl = document.getElementById('recTradeRMultiple');
      if (match && recTradeRMultipleEl) recTradeRMultipleEl.value = match[1];
    });
  }

  const tradePnlEl = document.getElementById('tradePnl');
  if (tradePnlEl) {
    tradePnlEl.addEventListener('input', (e) => {
      const match = e.target.value.match(/([+-]?\d+(?:\.\d+)?)/);
      const tradeRMultipleEl = document.getElementById('tradeRMultiple');
      if (match && tradeRMultipleEl) tradeRMultipleEl.value = match[1];
    });
  }

  // Images for Record Tab (if present)
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
  if (recordTradeFormEl) {
    recordTradeFormEl.addEventListener('submit', handleRecordTradeSubmit);
  }
  if (tradeFormEl) {
    tradeFormEl.addEventListener('submit', handleModalTradeSubmit);
  }

  // Close modals on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (lightboxModalEl && lightboxModalEl.classList.contains('active')) {
        closeLightbox();
        return;
      }
      closeTradeDetailModal();
      closeTradeModal();
      closeBackupModal();
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
    <div class="preview-item" data-preview-idx="${idx}" style="cursor: pointer;" title="Нажмите, чтобы открыть фото">
      <img src="${img.dataUrl}" alt="Превью ${idx + 1}" loading="lazy">
      <button type="button" class="preview-delete-btn" data-del-idx="${idx}" title="Удалить"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
    </div>
  `).join('');

  container.querySelectorAll('.preview-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.preview-delete-btn')) return;
      const idx = Number(item.dataset.previewIdx);
      if (images[idx] && images[idx].dataUrl) {
        openLightbox(images[idx].dataUrl, `Скриншот #${idx + 1}`);
      }
    });
  });

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
    const isModalActive = tradeModalEl && tradeModalEl.classList.contains('active');
    const isRecordTabActive = tabRecordView && tabRecordView.style && tabRecordView.style.display !== 'none';

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
    if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
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
/**
 * ============================================================================
 * MODAL TRADE ADD & EDIT (Select Dropdowns)
 * ============================================================================
 */
function openTradeModal(trade = null) {
  editingTradeId = trade ? trade.id : null;
  if (modalTitleEl) {
    modalTitleEl.textContent = trade ? `Редактирование сделки #${trade.id}` : 'Новая сделка';
  }

  // Populate newest presets into selects
  populatePresetSelects();

  // Hide preset managers by default
  ['symbol', 'direction', 'setup', 'timeframe', 'criteria'].forEach((type) => {
    const p = document.getElementById(`presetManager_${type}`);
    if (p) p.style.display = 'none';
  });

  const symbolSelect = document.getElementById('tradeSymbol');
  const symbolCustom = document.getElementById('tradeSymbolCustom');
  const setupSelect = document.getElementById('tradeSetup');
  const setupCustom = document.getElementById('tradeSetupCustom');
  const criteriaSelect = document.getElementById('tradeCriteria');
  const criteriaCustom = document.getElementById('tradeCriteriaCustom');
  const timeframeSelect = document.getElementById('tradeTimeframe');
  const directionSelect = document.getElementById('tradeDirection');
  const outcomeSelect = document.getElementById('tradeOutcome');

  const now = new Date();
  const currentIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (symbolCustom) { symbolCustom.style.display = 'none'; symbolCustom.value = ''; }
  if (setupCustom) { setupCustom.style.display = 'none'; setupCustom.value = ''; }
  if (criteriaCustom) { criteriaCustom.style.display = 'none'; criteriaCustom.value = ''; }

  if (trade) {
    // Populate existing trade
    if (symbolSelect) {
      const match = Array.from(symbolSelect.options).find(o => o.value === trade.symbol);
      if (match) {
        symbolSelect.value = trade.symbol;
      } else {
        symbolSelect.value = '__custom__';
        if (symbolCustom) {
          symbolCustom.style.display = 'block';
          symbolCustom.value = trade.symbol || '';
        }
      }
    }

    if (directionSelect) directionSelect.value = trade.direction || 'LONG';

    if (setupSelect) {
      const match = Array.from(setupSelect.options).find(o => o.value === trade.setup);
      if (match) {
        setupSelect.value = trade.setup;
      } else {
        setupSelect.value = '__custom__';
        if (setupCustom) {
          setupCustom.style.display = 'block';
          setupCustom.value = trade.setup || '';
        }
      }
    }

    if (criteriaSelect) {
      const critVal = (trade.criteria || trade.entryCriteria || trade.entry_criteria || '').trim();
      const match = Array.from(criteriaSelect.options).find(o => o.value === critVal);
      if (match) {
        criteriaSelect.value = critVal;
      } else if (critVal) {
        criteriaSelect.value = '__custom__';
        if (criteriaCustom) {
          criteriaCustom.style.display = 'block';
          criteriaCustom.value = critVal;
        }
      } else {
        const critList = getCustomPresets('criteria');
        criteriaSelect.value = critList[0] || '';
      }
    }

    if (timeframeSelect) timeframeSelect.value = trade.timeframe || '15m';
    if (outcomeSelect) outcomeSelect.value = trade.outcome || 'WIN';

    document.getElementById('tradeEntryTime').value = trade.entryTime || currentIso;
    document.getElementById('tradeExitTime').value = trade.exitTime || currentIso;
    document.getElementById('tradeEntryPrice').value = trade.entryPrice || '';
    document.getElementById('tradeExitPrice').value = trade.exitPrice || '';
    document.getElementById('tradePnl').value = trade.pnl || '';
    document.getElementById('tradeRMultiple').value = trade.rMultiple || '';
    document.getElementById('tradeNotes').value = trade.notes || '';
    modalTradeImages = [...(trade.images || [])];

  } else {
    // Fresh trade
    if (symbolSelect) {
      const symbols = getCustomPresets('symbol');
      symbolSelect.value = symbols.includes('BTC/USDT') ? 'BTC/USDT' : (symbols[0] || '');
    }
    if (directionSelect) directionSelect.value = 'LONG';
    if (setupSelect) {
      const setups = getCustomPresets('setup');
      setupSelect.value = setups.includes('Breakout / Пробой') ? 'Breakout / Пробой' : (setups[0] || '');
    }
    if (criteriaSelect) {
      const critList = getCustomPresets('criteria');
      criteriaSelect.value = critList[0] || '';
    }
    if (timeframeSelect) {
      const tfs = getCustomPresets('timeframe');
      timeframeSelect.value = tfs.includes('15m') ? '15m' : (tfs[0] || '');
    }
    if (outcomeSelect) outcomeSelect.value = 'WIN';

    document.getElementById('tradeEntryTime').value = currentIso;
    document.getElementById('tradeExitTime').value = currentIso;
    document.getElementById('tradeEntryPrice').value = '';
    document.getElementById('tradeExitPrice').value = '';
    document.getElementById('tradePnl').value = '+2.0R';
    document.getElementById('tradeRMultiple').value = '2.0';
    document.getElementById('tradeNotes').value = '';
    modalTradeImages = [];
  }

  renderImagePreviews('formImagePreviews', modalTradeImages, (idx) => {
    modalTradeImages.splice(idx, 1);
    renderImagePreviews('formImagePreviews', modalTradeImages, null);
  });

  savedTradeModalScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  tradeModalEl.classList.add('active');
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');
  if (window.innerWidth < 768) {
    document.body.style.top = `-${savedTradeModalScrollY}px`;
  }
}
window.openTradeModal = openTradeModal;

async function editTrade(id) {
  let trade = allTrades.find((t) => String(t.id) === String(id));
  if (!trade && typeof getTrade === 'function') {
    try {
      trade = await getTrade(id);
    } catch (_) {}
  }
  if (trade) {
    openTradeModal(trade);
  }
}
window.editTrade = editTrade;

function closeTradeModal() {
  tradeModalEl.classList.remove('active');
  const otherActiveModal = document.querySelector('.modal-overlay.active:not(#tradeModal), .ai-modal-overlay.active');
  if (!otherActiveModal) {
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    document.body.style.overflow = '';
    const restoreY = Math.abs(parseInt(document.body.style.top || '0', 10)) || savedTradeModalScrollY;
    document.body.style.top = '';
    if (restoreY && window.innerWidth < 768) {
      window.scrollTo(0, restoreY);
    }
  }

  ['symbol', 'direction', 'setup', 'timeframe', 'criteria'].forEach((type) => {
    const p = document.getElementById(`presetManager_${type}`);
    if (p) p.style.display = 'none';
  });

  const criteriaCustom = document.getElementById('tradeCriteriaCustom');
  if (criteriaCustom) { criteriaCustom.style.display = 'none'; criteriaCustom.value = ''; }
}
window.closeTradeModal = closeTradeModal;

function saveCriteria(criteria) {
  if (!criteria || criteria === '__custom__') return;
  const list = getCustomPresets('criteria');
  if (!list.includes(criteria)) {
    list.push(criteria);
    saveCustomPresets('criteria', list);
    populatePresetSelects('criteria', criteria);
  }
}
window.saveCriteria = saveCriteria;

function handleSelectCustomToggle(selectEl, customInputId) {
  const customEl = document.getElementById(customInputId);
  if (!customEl) return;
  if (selectEl.value === '__custom__') {
    customEl.style.display = 'block';
    customEl.focus();
  } else {
    customEl.style.display = 'none';
  }
}
window.handleSelectCustomToggle = handleSelectCustomToggle;

function handleOutcomeSelectChange(selectEl, pnlInputId, rHiddenId) {
  const pnlInput = document.getElementById(pnlInputId);
  const rHidden = document.getElementById(rHiddenId);
  if (selectEl.value === 'WIN') {
    if (pnlInput) pnlInput.value = '+2.0R';
    if (rHidden) rHidden.value = '2.0';
  } else if (selectEl.value === 'LOSS') {
    if (pnlInput) pnlInput.value = '-1.0R';
    if (rHidden) rHidden.value = '-1.0';
  } else {
    if (pnlInput) pnlInput.value = '0.0R';
    if (rHidden) rHidden.value = '0.0';
  }
}
window.handleOutcomeSelectChange = handleOutcomeSelectChange;

async function handleModalTradeSubmit(e) {
  e.preventDefault();

  const symbolSelect = document.getElementById('tradeSymbol');
  const symbolCustom = document.getElementById('tradeSymbolCustom');
  let symbol = symbolSelect.value;
  if (symbol === '__custom__') {
    symbol = symbolCustom ? symbolCustom.value.trim().toUpperCase() : '';
  }
  if (!symbol) {
    showToast('Выберите или введите тикер', 'error');
    return;
  }

  const setupSelect = document.getElementById('tradeSetup');
  const setupCustom = document.getElementById('tradeSetupCustom');
  let setup = setupSelect.value;
  if (setup === '__custom__') {
    setup = setupCustom ? setupCustom.value.trim() : 'Свой сетап';
  }

  const criteriaSelect = document.getElementById('tradeCriteria');
  const criteriaCustom = document.getElementById('tradeCriteriaCustom');
  let criteria = criteriaSelect ? criteriaSelect.value : '';
  if (criteria === '__custom__') {
    criteria = criteriaCustom ? criteriaCustom.value.trim() : '';
  }

  const direction = document.getElementById('tradeDirection').value;
  const timeframe = document.getElementById('tradeTimeframe').value;
  const outcome = document.getElementById('tradeOutcome').value;
  const entryTime = document.getElementById('tradeEntryTime').value;
  const exitTime = document.getElementById('tradeExitTime').value;
  const entryPrice = document.getElementById('tradeEntryPrice').value.trim();
  const exitPrice = document.getElementById('tradeExitPrice').value.trim();
  let pnl = document.getElementById('tradePnl').value.trim();
  let rMultiple = parseFloat(document.getElementById('tradeRMultiple').value || 0);

  if (!pnl) {
    pnl = outcome === 'WIN' ? '+2.0R' : outcome === 'LOSS' ? '-1.0R' : '0.0R';
    rMultiple = outcome === 'WIN' ? 2.0 : outcome === 'LOSS' ? -1.0 : 0.0;
  }

  const notes = document.getElementById('tradeNotes').value.trim();

  // Save presets
  saveTicker(symbol);
  if (setup) saveSetup(setup);
  if (criteria) saveCriteria(criteria);
  if (timeframe) saveTimeframe(timeframe);

  const tradeData = {
    symbol,
    direction,
    timeframe,
    setup: setup || 'Без сетапа',
    criteria: criteria || '',
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
    if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
  } catch (err) {
    console.error('Failed to save trade in modal:', err);
    showToast('Ошибка при сохранении сделки', 'error');
  }
}

/**
 * ============================================================================
 * THEME SYSTEM & SETTINGS ACTIONS
 * ============================================================================
 */
function applyAppTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('tradelog_theme', themeName);
  updateThemeCardsUI(themeName);
  syncThemeChrome();
  showToast(`Тема «${getThemeDisplayName(themeName)}» установлена`, 'info');
}
window.applyAppTheme = applyAppTheme;

function initAppTheme() {
  const saved = localStorage.getItem('tradelog_theme') || 'books';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeCardsUI(saved);
  syncThemeChrome();
}
window.initAppTheme = initAppTheme;

function syncThemeChrome() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim();
}

function updateThemeCardsUI(activeTheme = null) {
  const current = activeTheme || localStorage.getItem('tradelog_theme') || 'books';
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('active', card.dataset.themeName === current);
  });
}

function getThemeDisplayName(theme) {
  const names = {
    books: 'Paper · Светлая',
    midnight: 'Raycast Midnight',
    cyberpunk: 'Cyberpunk Neon',
    emerald: 'Emerald Forest',
    nordic: 'Nordic Slate',
    oled: 'OLED Pure Black',
    amber: 'Warm Amber'
  };
  return names[theme] || theme;
}

function populateSettingsVoiceList() {
  const select = document.getElementById('settingsVoiceSelect');
  if (!select) return;

  const voices = typeof getAvailableRussianVoices === 'function' ? getAvailableRussianVoices() : [];
  let selectedVoice = localStorage.getItem('tradelog_selected_voice') || '';
  if (selectedVoice.toLowerCase().includes('milena') || selectedVoice.toLowerCase().includes('милена')) {
    localStorage.removeItem('tradelog_selected_voice');
    selectedVoice = '';
  }

  select.innerHTML = '<option value="">Дмитрий — нейросетевой (Piper)</option><option value="edge-dmitry">Дмитрий Microsoft — через интернет</option>';
  if (selectedVoice === 'edge-dmitry') select.value = selectedVoice;

  voices.forEach(v => {
    const nameLower = (v.name || '').toLowerCase();
    if (nameLower.includes('milena') || nameLower.includes('милена')) return;

    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.name === selectedVoice) opt.selected = true;
    select.appendChild(opt);
  });
}
window.populateSettingsVoiceList = populateSettingsVoiceList;

function handleVoiceSelectChange(selectEl) {
  if (selectEl.value) {
    localStorage.setItem('tradelog_selected_voice', selectEl.value);
    showToast(`Выбран голос: ${selectEl.value}`, 'success');
  } else {
    localStorage.removeItem('tradelog_selected_voice');
    showToast('Выбран нейросетевой Дмитрий', 'info');
  }
}
window.handleVoiceSelectChange = handleVoiceSelectChange;

function testDmitryVoice() {
  if (typeof speakWithDmitry === 'function') {
    speakWithDmitry('Привет! Голос Дмитрия готов к работе. Я озвучиваю ответы и фиксирую сделки в вашем дневнике.', null, true);
  }
}
window.testDmitryVoice = testDmitryVoice;

let savedVoiceScrollY = 0;

function openVoiceSettingsModal() {
  const modal = document.getElementById('voiceSettingsModal');
  if (!modal) return;

  populateSettingsVoiceList();
  if (typeof updateVoiceToggleUI === 'function') {
    updateVoiceToggleUI();
  }

  savedVoiceScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.top = `-${savedVoiceScrollY}px`;
  modal.classList.add('active');
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
}
window.openVoiceSettingsModal = openVoiceSettingsModal;

function closeVoiceSettingsModal() {
  const modal = document.getElementById('voiceSettingsModal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.documentElement.classList.remove('modal-open');
  document.body.classList.remove('modal-open');
  const restoreY = Math.abs(parseInt(document.body.style.top || '0', 10)) || savedVoiceScrollY;
  document.body.style.top = '';
  if (restoreY) {
    window.scrollTo(0, restoreY);
  }
}
window.closeVoiceSettingsModal = closeVoiceSettingsModal;

async function forceAppCacheReset() {
  if (confirm('Сбросить весь кэш приложения и загрузить актуальную версию? Ваши сделки и мысли сохранятся в базе данных.')) {
    try {
      // 1. Send CLEAR_CACHE to active Service Worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ action: 'CLEAR_CACHE' });
      }

      // 2. Clear CacheStorage
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }

      // 3. Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      // 4. Clear temporary session cache and set build version
      sessionStorage.clear();
      localStorage.setItem('tradelog_app_build', CURRENT_APP_BUILD);

      showToast('Кэш очищен! Перезагрузка приложения...', 'success');
      setTimeout(() => {
        window.location.replace(window.location.origin + window.location.pathname);
      }, 350);

    } catch (e) {
      console.warn('Cache clear error:', e);
      window.location.reload();
    }
  }
}
window.forceAppCacheReset = forceAppCacheReset;

async function exportDataJson() {
  try {
    const trades = allTrades || [];
    const thoughts = typeof getAllJournalThoughts === 'function' ? await getAllJournalThoughts() : [];
    const exportObj = {
      app: 'TradeLog Raycast',
      version: '2.4.0',
      exportDate: new Date().toISOString(),
      trades: trades,
      thoughts: thoughts
    };

    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tradelog-backup-${new Date().toISOString().substring(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Резервная копия успешно экспортирована!', 'success');
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Ошибка при экспорте данных', 'error');
  }
}
window.exportDataJson = exportDataJson;

async function handleImportDataFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (data.trades && Array.isArray(data.trades)) {
        for (const t of data.trades) {
          delete t.id;
          await addTrade(t);
        }
      }
      if (data.thoughts && Array.isArray(data.thoughts)) {
        for (const th of data.thoughts) {
          delete th.id;
          await addJournalThought(th);
        }
      }

      showToast('Данные успешно импортированы!', 'success');
      await refreshTrades();
      if (typeof renderJournalThoughtsFeed === 'function') {
        await renderJournalThoughtsFeed();
      }
    } catch (err) {
      console.error('Import failed:', err);
      showToast('Ошибка чтения файла резервной копии', 'error');
    }
  };
  reader.readAsText(file);
}
window.handleImportDataFile = handleImportDataFile;

async function confirmDeleteTrade(id) {
  if (confirm(`Вы уверены, что хотите удалить сделку #${id}?`)) {
    try {
      await deleteTrade(id);
      showToast(`Сделка #${id} удалена`, 'info');
      await refreshTrades();
      if (typeof syncWithCloud === 'function' && typeof isUserLoggedIn === 'function' && isUserLoggedIn()) {
        syncWithCloud(true).catch(err => console.warn('Auto-sync error:', err));
      } else if (typeof scheduleAutoSync === 'function') {
        scheduleAutoSync();
      }
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
  if (!lightboxImgEl || !lightboxModalEl) return;
  lightboxImgEl.src = imgSrc;
  if (lightboxCaptionEl) {
    lightboxCaptionEl.textContent = caption || 'Скриншот';
  }
  lightboxModalEl.classList.add('active');
  document.body.classList.add('lightbox-open');
  document.documentElement.classList.add('lightbox-open');
  document.body.classList.add('modal-open');
}
window.openLightbox = openLightbox;

function closeLightbox() {
  if (!lightboxModalEl) return;
  lightboxModalEl.classList.remove('active');
  document.body.classList.remove('lightbox-open');
  document.documentElement.classList.remove('lightbox-open');

  // Only remove modal-open if no other modal is currently active
  const otherActiveModal = document.querySelector('.modal-overlay.active, .ai-modal-overlay.active');
  if (!otherActiveModal) {
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
    document.body.style.overflow = '';
  }
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
