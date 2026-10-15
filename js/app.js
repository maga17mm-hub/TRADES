/**
 * TradeLog - Main Application Controller
 * Handles UI interactions, filtering, analytics, image handling, and PWA logic.
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
let currentTradeImages = [];
let editingTradeId = null;
let deferredInstallPrompt = null;

// DOM Elements
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

// Modals
const tradeModalEl = document.getElementById('tradeModal');
const tradeFormEl = document.getElementById('tradeForm');
const modalTitleEl = document.getElementById('modalTitle');
const backupModalEl = document.getElementById('backupModal');
const lightboxModalEl = document.getElementById('lightboxModal');
const lightboxImgEl = document.getElementById('lightboxImg');
const lightboxCaptionEl = document.getElementById('lightboxCaption');

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker for PWA
  registerServiceWorker();

  // Load demo trades if database is completely empty
  await loadDemoTradesIfEmpty();

  // Load trades from IndexedDB
  await refreshTrades();

  // Setup Event Listeners
  setupEventListeners();

  // Setup Clipboard Paste for images (Ctrl+V)
  setupClipboardPaste();

  // Check PWA Installability
  setupPwaInstall();
});

/**
 * Register Service Worker
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('Service Worker registered with scope:', reg.scope))
        .catch((err) => console.log('Service Worker registration failed:', err));
    });
  }
}

/**
 * Refresh trades from DB and update UI
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

/**
 * Update Top Analytics Cards (Polar.sh stats style)
 */
function updateAnalytics() {
  const filtered = getFilteredTrades();
  const total = filtered.length;

  if (total === 0) {
    statWinrateEl.textContent = '0%';
    statPnlEl.textContent = '0.0 R';
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
    // PnL / R
    const rVal = parseFloat(t.rMultiple || 0);
    totalR += rVal;

    // Outcome counts
    if (t.outcome === 'WIN') wins++;
    else if (t.outcome === 'LOSS') losses++;
    else if (t.outcome === 'BE') be++;

    // Setup stats
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

  // Best setup calculation
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

/**
 * Filter Trades based on current filter state
 */
function getFilteredTrades() {
  return allTrades.filter((t) => {
    // Month filter
    if (currentFilter.month !== 'all' && t.month !== currentFilter.month) {
      return false;
    }
    // Setup filter
    if (currentFilter.setup !== 'all' && t.setup !== currentFilter.setup) {
      return false;
    }
    // Timeframe filter
    if (currentFilter.timeframe !== 'all' && t.timeframe !== currentFilter.timeframe) {
      return false;
    }
    // Outcome filter
    if (currentFilter.outcome !== 'all' && t.outcome !== currentFilter.outcome) {
      return false;
    }
    // Direction filter
    if (currentFilter.direction !== 'all' && t.direction !== currentFilter.direction) {
      return false;
    }
    // Search query (symbol or notes)
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

/**
 * Render Structuring by Month (Pills)
 */
function renderMonthPills() {
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

  // Add click handlers
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

/**
 * Render Structuring by Setup (Pills)
 */
function renderSetupPills() {
  const setupsMap = {};
  allTrades.forEach((t) => {
    const s = t.setup || 'Другой';
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

  // Add click handlers
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

/**
 * Render Trades Feed (Grouped by Month with monthly metrics)
 */
function renderTradesFeed() {
  const filtered = getFilteredTrades();

  if (filtered.length === 0) {
    tradesFeedEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
        </div>
        <div class="empty-title">Сделок не найдено</div>
        <div class="empty-desc">Сделки по выбранным фильтрам отсутствуют. Нажмите кнопку «+ Сделка», чтобы записать новый трейд!</div>
        <button class="btn btn-primary" onclick="openTradeModal()">+ Записать первую сделку</button>
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

    // Compute month summary
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

/**
 * Generate HTML for an individual trade card (Polar.sh / Refero design)
 */
function renderTradeCard(t) {
  const outcomeClass = (t.outcome || 'be').toLowerCase();
  const dirClass = (t.direction || 'long').toLowerCase();
  const outcomeLabel = t.outcome === 'WIN' ? 'Тейк-профит' : t.outcome === 'LOSS' ? 'Стоп-лосс' : 'Безубыток';

  // Formatting dates & duration
  const entryFormatted = formatDateTimeDisplay(t.entryTime);
  const exitFormatted = formatDateTimeDisplay(t.exitTime);
  const durationText = calculateDuration(t.entryTime, t.exitTime);

  // Images thumbnails
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

  // Notes snippet
  let notesHtml = '';
  if (t.notes && t.notes.trim()) {
    notesHtml = `<div class="trade-notes-preview">${escapeHtml(t.notes)}</div>`;
  }

  // Price details
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
            ${escapeHtml(t.setup || 'Сетап')}
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

/**
 * Attach listeners to cards (e.g. click image to lightbox)
 */
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
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Search input
  searchInputEl.addEventListener('input', (e) => {
    currentFilter.searchQuery = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  // Timeframe filter select
  filterTfSelectEl.addEventListener('change', (e) => {
    currentFilter.timeframe = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  // Outcome filter select
  filterOutcomeSelectEl.addEventListener('change', (e) => {
    currentFilter.outcome = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  // Direction filter select
  filterDirectionSelectEl.addEventListener('change', (e) => {
    currentFilter.direction = e.target.value;
    updateAnalytics();
    renderTradesFeed();
  });

  // Quick Timeframe selector buttons in modal
  document.querySelectorAll('.tf-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.tf-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      document.getElementById('tradeTimeframe').value = pill.dataset.tf;
    });
  });

  // Direction toggle buttons in modal
  document.querySelectorAll('.seg-btn[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn[data-dir]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tradeDirection').value = btn.dataset.dir;
    });
  });

  // Outcome toggle buttons in modal
  document.querySelectorAll('.seg-btn[data-outcome]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn[data-outcome]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tradeOutcome').value = btn.dataset.outcome;

      // Auto-suggest PnL sign
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

  // Auto-fill R multiple when PnL input changes
  document.getElementById('tradePnl').addEventListener('input', (e) => {
    const val = e.target.value;
    const match = val.match(/([+-]?\d+(?:\.\d+)?)/);
    if (match) {
      document.getElementById('tradeRMultiple').value = match[1];
    }
  });

  // Image file input change
  const imageInputEl = document.getElementById('tradeImageInput');
  const uploadZoneEl = document.getElementById('imageUploadZone');

  uploadZoneEl.addEventListener('click', () => imageInputEl.click());

  uploadZoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZoneEl.classList.add('dragover');
  });

  uploadZoneEl.addEventListener('dragleave', () => {
    uploadZoneEl.classList.remove('dragover');
  });

  uploadZoneEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    uploadZoneEl.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processImageFiles(e.dataTransfer.files);
    }
  });

  imageInputEl.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await processImageFiles(e.target.files);
      imageInputEl.value = ''; // Reset input so same file can be re-added if desired
    }
  });

  // Trade form submit
  tradeFormEl.addEventListener('submit', handleTradeSubmit);

  // Setup selector change: if "custom", show custom input
  const setupSelect = document.getElementById('tradeSetup');
  const customSetupGroup = document.getElementById('customSetupGroup');
  setupSelect.addEventListener('change', () => {
    if (setupSelect.value === '__custom__') {
      customSetupGroup.style.display = 'block';
      document.getElementById('tradeCustomSetup').focus();
    } else {
      customSetupGroup.style.display = 'none';
    }
  });

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
 * Handle Clipboard Paste for Screenshots (Ctrl+V)
 */
function setupClipboardPaste() {
  window.addEventListener('paste', async (e) => {
    // Only capture paste if modal is active
    if (!tradeModalEl.classList.contains('active')) return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          showToast('Обработка скриншота из буфера...', 'info');
          try {
            const compressed = await compressImage(file);
            currentTradeImages.push(compressed);
            renderFormImagePreviews();
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
 * Process uploaded / dropped image files
 */
async function processImageFiles(files) {
  showToast('Сжатие и подготовка графиков...', 'info');
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImage(file);
        currentTradeImages.push(compressed);
      } catch (err) {
        console.error('Failed to compress image:', err);
      }
    }
  }
  renderFormImagePreviews();
  showToast(`Добавлено изображений: ${currentTradeImages.length}`, 'success');
}

/**
 * Render image thumbnails inside the modal form
 */
function renderFormImagePreviews() {
  const container = document.getElementById('formImagePreviews');
  if (currentTradeImages.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = currentTradeImages.map((img, idx) => `
    <div class="preview-item">
      <img src="${img.dataUrl}" alt="Превью ${idx + 1}">
      <button type="button" class="preview-delete-btn" onclick="removeFormImage(${idx})" title="Удалить">✕</button>
    </div>
  `).join('');
}

function removeFormImage(idx) {
  currentTradeImages.splice(idx, 1);
  renderFormImagePreviews();
}

/**
 * Open Modal to Add New Trade
 */
function openTradeModal() {
  editingTradeId = null;
  modalTitleEl.textContent = 'Новая сделка';
  tradeFormEl.reset();
  currentTradeImages = [];
  renderFormImagePreviews();

  // Set default timestamps
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const nowStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  document.getElementById('tradeEntryTime').value = nowStr;
  document.getElementById('tradeExitTime').value = nowStr;

  // Set defaults: LONG, 15m, WIN
  setDirectionState('LONG');
  setTimeframeState('15m');
  setOutcomeState('WIN');

  document.getElementById('tradePnl').value = '+2.0R';
  document.getElementById('tradeRMultiple').value = '2.0';
  document.getElementById('customSetupGroup').style.display = 'none';

  tradeModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/**
 * Open Modal to Edit Existing Trade
 */
async function editTrade(id) {
  const trade = allTrades.find((t) => t.id === Number(id));
  if (!trade) return;

  editingTradeId = trade.id;
  modalTitleEl.textContent = `Редактирование сделки #${trade.id}`;

  document.getElementById('tradeSymbol').value = trade.symbol || '';
  document.getElementById('tradeEntryTime').value = trade.entryTime || '';
  document.getElementById('tradeExitTime').value = trade.exitTime || '';
  document.getElementById('tradeEntryPrice').value = trade.entryPrice || '';
  document.getElementById('tradeExitPrice').value = trade.exitPrice || '';
  document.getElementById('tradePnl').value = trade.pnl || '';
  document.getElementById('tradeRMultiple').value = trade.rMultiple || '';
  document.getElementById('tradeNotes').value = trade.notes || '';

  // Setup
  const setupSelect = document.getElementById('tradeSetup');
  const setupOptions = Array.from(setupSelect.options).map((o) => o.value);
  if (setupOptions.includes(trade.setup)) {
    setupSelect.value = trade.setup;
    document.getElementById('customSetupGroup').style.display = 'none';
  } else {
    setupSelect.value = '__custom__';
    document.getElementById('customSetupGroup').style.display = 'block';
    document.getElementById('tradeCustomSetup').value = trade.setup || '';
  }

  // Direction, TF, Outcome
  setDirectionState(trade.direction || 'LONG');
  setTimeframeState(trade.timeframe || '15m');
  setOutcomeState(trade.outcome || 'WIN');

  // Images
  currentTradeImages = [...(trade.images || [])];
  renderFormImagePreviews();

  tradeModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function setDirectionState(dir) {
  document.getElementById('tradeDirection').value = dir;
  document.querySelectorAll('.seg-btn[data-dir]').forEach((b) => {
    b.classList.toggle('active', b.dataset.dir === dir);
  });
}

function setTimeframeState(tf) {
  document.getElementById('tradeTimeframe').value = tf;
  document.querySelectorAll('.tf-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.tf === tf);
  });
}

function setOutcomeState(outcome) {
  document.getElementById('tradeOutcome').value = outcome;
  document.querySelectorAll('.seg-btn[data-outcome]').forEach((b) => {
    b.classList.toggle('active', b.dataset.outcome === outcome);
  });
}

function setNowForInput(inputId) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  document.getElementById(inputId).value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function closeTradeModal() {
  tradeModalEl.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * Handle Trade Form Submit
 */
async function handleTradeSubmit(e) {
  e.preventDefault();

  const symbol = document.getElementById('tradeSymbol').value.trim().toUpperCase();
  if (!symbol) {
    showToast('Введите тикер или пару (например BTC/USDT)', 'error');
    return;
  }

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

  // Setup resolution
  let setup = document.getElementById('tradeSetup').value;
  if (setup === '__custom__') {
    setup = document.getElementById('tradeCustomSetup').value.trim() || 'Свой сетап';
  }

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
    images: currentTradeImages
  };

  try {
    if (editingTradeId) {
      tradeData.id = editingTradeId;
      await updateTrade(tradeData);
      showToast('Сделка успешно обновлена!', 'success');
    } else {
      await addTrade(tradeData);
      showToast('Сделка успешно сохранена в дневник!', 'success');
    }

    closeTradeModal();
    await refreshTrades();
  } catch (err) {
    console.error('Failed to save trade:', err);
    showToast('Ошибка при сохранении сделки', 'error');
  }
}

/**
 * Delete Trade Confirmation
 */
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

/**
 * Image Lightbox Viewer
 */
function openLightbox(imgSrc, caption = '') {
  lightboxImgEl.src = imgSrc;
  lightboxCaptionEl.textContent = caption;
  lightboxModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightboxModalEl.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * Backup & Export / Import Handlers
 */
function openBackupModal() {
  backupModalEl.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeBackupModal() {
  backupModalEl.classList.remove('active');
  document.body.style.overflow = '';
}

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

async function handleResetData() {
  if (confirm('ВНИМАНИЕ! Это действие удалит ВСЕ сохраненные сделки и графики. Продолжить?')) {
    await clearAllTrades();
    showToast('Все данные очищены', 'info');
    closeBackupModal();
    await refreshTrades();
  }
}

/**
 * PWA Installation Prompt Setup
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
 * Helper Utilities
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
