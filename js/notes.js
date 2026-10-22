/**
 * Clean corrupted question marks from Russian text in thoughts
 */
function cleanCorruptedRussianText(text) {
  if (!text || typeof text !== 'string') return text || '';
  let s = text;
  s = s.replace(/---\s*\n\?{5}:/g, '---\nСетап:');
  s = s.replace(/\?{5}:\s*/g, 'Сетап: ');
  s = s.replace(/\?{8}\s+\?{5}:\s*/g, 'Контекст рынка: ');
  s = s.replace(/\?{15}\s+\?{9}:\s*/g, 'Психологическое состояние: ');
  s = s.replace(/\?{7}\s+\?{5}:\s*/g, 'Главный вывод: ');
  s = s.replace(/^\?{6,9}\s*$/gm, 'Запись');
  s = s.replace(/^Сщсзазаза\s*\n*/g, '');
  // Clean question marks attached directly to or standing near Russian/Latin words
  s = s.replace(/([\u0400-\u04FFa-zA-Z0-9])\?{2,}/g, '$1');
  s = s.replace(/\?{2,}([\u0400-\u04FFa-zA-Z0-9])/g, '$1');
  s = s.replace(/([\u0400-\u04FFa-zA-Z0-9])\s+\?{2,}/g, '$1');
  s = s.replace(/\?{2,}\s+([\u0400-\u04FFa-zA-Z0-9])/g, '$1');
  return s;
}

function cleanThoughtContent(thought) {
  if (!thought || typeof thought !== 'object') return thought;
  if (thought.tag && /^\?+$/.test(thought.tag.trim())) {
    thought.tag = 'Запись';
  }
  if (thought.title && /^\?+$/.test(thought.title.trim())) {
    thought.title = '';
  }
  if (typeof thought.title === 'string' && thought.title.includes('?')) {
    thought.title = cleanCorruptedRussianText(thought.title);
  }
  if (typeof thought.text === 'string' && thought.text.includes('?')) {
    thought.text = cleanCorruptedRussianText(thought.text);
  }
  return thought;
}
window.cleanThoughtContent = cleanThoughtContent;
window.cleanCorruptedRussianText = cleanCorruptedRussianText;

/**
 * ============================================================================
 * TradeLog Journal Thoughts & Voice Memos Module (Apple Journal iOS Style)
 * Manages trader reflections, psychology, market analysis, and voice memos.
 * Stored offline in IndexedDB (journal_thoughts) with full cloud sync support.
 * ============================================================================
 */

let allJournalThoughts = [];
let currentOpenThoughtId = null;
let isEditingThought = false;
let filterOnlyBookmarked = false;

// Audio Recording State
let thoughtMediaRecorder = null;
let thoughtAudioChunks = [];
let thoughtRecordStartTime = 0;
let thoughtRecordTimerInterval = null;
let currentRecordedAudioDataUrl = null;
let currentRecordedAudioDuration = 0;
let isRecordingThoughtAudio = false;

// Search & Filter State
let journalSearchQuery = '';
let journalFilterTag = 'all';

document.addEventListener('DOMContentLoaded', () => {
  initJournalThoughts();
});

/**
 * Initialize Journal Module
 */
async function initJournalThoughts() {
  await loadAndRenderJournal();
}
window.initJournalThoughts = initJournalThoughts;

/**
 * Load thoughts from IndexedDB and render list
 */
async function loadAndRenderJournal() {
  try {
    if (typeof getAllJournalThoughts === 'function') {
      const thoughts = await getAllJournalThoughts();
      allJournalThoughts = Array.isArray(thoughts) ? thoughts.map(t => {
        const cleaned = cleanThoughtContent({ ...t });
        if (cleaned.text !== t.text || cleaned.tag !== t.tag || cleaned.title !== t.title) {
          if (typeof updateJournalThought === 'function') {
            updateJournalThought(cleaned).catch(() => {});
          }
        }
        return cleaned;
      }) : [];
    } else {
      allJournalThoughts = [];
    }
  } catch (err) {
    console.error('Failed to load journal thoughts:', err);
    allJournalThoughts = [];
  }

  renderJournalThoughtsList();
}
window.renderJournalThoughtsFeed = loadAndRenderJournal;
window.loadAndRenderJournal = loadAndRenderJournal;

/**
 * Group thoughts into Apple Journal timeline headers ("Сегодня", "Вчера", "Сентябрь 2025 г.")
 */
function groupThoughtsByDate(thoughts) {
  const groups = {};
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  for (const t of thoughts) {
    const d = new Date(t.createdAt || Date.now());
    let groupKey = '';
    if (d.toDateString() === todayStr) {
      groupKey = 'Сегодня';
    } else if (d.toDateString() === yesterdayStr) {
      groupKey = 'Вчера';
    } else {
      const monthName = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
      groupKey = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    }
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(t);
  }
  return groups;
}

/**
 * Extract Title and Body from thought
 */
function getThoughtTitleAndBody(thought) {
  const cleanT = cleanThoughtContent(thought);
  if (cleanT.title && cleanT.title.trim()) {
    return {
      title: cleanT.title.trim(),
      body: (cleanT.text || '').trim()
    };
  }

  const text = (thought.text || '').trim();
  if (!text) {
    return {
      title: 'Голосовая мысль',
      body: thought.audioDuration ? `Голосовая запись (${thought.audioDuration} сек)` : 'Голосовая запись'
    };
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  if (firstLine.length <= 40) {
    const remaining = text.substring(firstLine.length).trim();
    return {
      title: firstLine,
      body: remaining || firstLine
    };
  }

  const words = firstLine.split(/\s+/);
  return {
    title: words.slice(0, 5).join(' ') + '...',
    body: text
  };
}

/**
 * Format Full Date for Apple Journal Card Footer ("Вторник, 16 сент. 2025 г.")
 */
function formatAppleJournalCardDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const str = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format Sub-date for Apple Journal Header ("16.09, 18:42")
 */
function formatAppleJournalSubDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month}, ${hours}:${mins}`;
}

/**
 * Render Apple Journal Feed
 */
function renderJournalThoughtsList() {
  const container = document.getElementById('journalThoughtsFeed');
  if (!container) return;

  // Filter thoughts
  let filtered = [...allJournalThoughts];

  if (filterOnlyBookmarked) {
    filtered = filtered.filter(t => !!t.isBookmarked);
  }

  if (journalFilterTag && journalFilterTag !== 'all') {
    filtered = filtered.filter(t => {
      const tag = t.tag || 'Запись';
      if (journalFilterTag === 'Запись' || journalFilterTag === 'Мысли') {
        return tag === 'Запись' || tag === 'Мысли';
      }
      return tag === journalFilterTag;
    });
  }

  if (journalSearchQuery && journalSearchQuery.trim()) {
    const q = journalSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(t => {
      const titleMatch = (t.title || '').toLowerCase().includes(q);
      const textMatch = (t.text || '').toLowerCase().includes(q);
      const tagMatch = (t.tag || '').toLowerCase().includes(q);
      return titleMatch || textMatch || tagMatch;
    });
  }

  // Empty state
  if (filtered.length === 0) {
    if (filterOnlyBookmarked) {
      container.innerHTML = `
        <div class="ios-notes-empty-state">
          <div class="ios-notes-empty-icon">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h3 class="ios-notes-empty-title">Нет избранных записей</h3>
          <p class="ios-notes-empty-desc">
            Нажмите на значок закладки в любой записи, чтобы добавить её в избранное.
          </p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="toggleFilterOnlyBookmarked()" style="margin-top: 14px;">
            Показать все записи
          </button>
        </div>
      `;
    } else if (allJournalThoughts.length === 0) {
      container.innerHTML = `
        <div class="ios-notes-empty-state">
          <div class="ios-notes-empty-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          </div>
          <h3 class="ios-notes-empty-title">Ваш дневник пуст</h3>
          <p class="ios-notes-empty-desc">
            Сохраните идею, разберите сетап или запишите голосовую мысль. Нажмите на плюс в правом нижнем углу.
          </p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="ios-notes-empty-state">
          <div class="ios-notes-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <h3 class="ios-notes-empty-title">Ничего не найдено</h3>
          <p class="ios-notes-empty-desc">
            По запросу «${safeEscape(journalSearchQuery)}» записей не найдено.
          </p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="clearJournalSearch()" style="margin-top: 14px;">
            Сбросить поиск
          </button>
        </div>
      `;
    }
    return;
  }

  // Group by date headers
  const grouped = groupThoughtsByDate(filtered);
  let html = '';

  for (const [groupName, thoughtsList] of Object.entries(grouped)) {
    html += `<h2 class="apple-group-header">${safeEscape(groupName)}</h2>`;

    for (const thought of thoughtsList) {
      const { title, body } = getThoughtTitleAndBody(thought);
      const subdate = formatAppleJournalSubDate(thought.createdAt);
      const fullDate = formatAppleJournalCardDate(thought.createdAt);
      const isBookmarked = !!thought.isBookmarked;
      const hasAudio = !!thought.audioData;
      const audioDurationText = thought.audioDuration ? `${thought.audioDuration} сек` : 'Голос';

      html += `
        <div class="apple-journal-card" onclick="openThoughtDetail('${thought.id}')">
          <div class="apple-card-title">${safeEscape(title)}</div>
          <div class="apple-card-subdate">${subdate}</div>
          <div class="apple-card-body">${safeEscape(body)}</div>

          ${hasAudio ? `
            <div style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.76rem; color: var(--brand, var(--accent, #ff6363)); background: var(--brand-soft, rgba(255, 99, 99, 0.12)); border-radius: 12px; padding: 3px 10px; margin-bottom: 10px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
              <span>Голосовая запись (${audioDurationText})</span>
            </div>
          ` : ''}

          <div class="apple-card-footer">
            <span class="apple-card-date">${fullDate}</span>
            <div class="apple-card-actions">
              <button type="button" class="apple-card-menu-btn ${isBookmarked ? 'active' : ''}" onclick="toggleThoughtBookmark(event, '${thought.id}')" title="${isBookmarked ? 'В избранном' : 'Добавить в избранное'}" aria-label="Закладка">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${isBookmarked ? '#ff453a' : 'none'}" stroke="${isBookmarked ? '#ff453a' : 'currentColor'}" stroke-width="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                </svg>
              </button>
              <button type="button" class="apple-card-menu-btn" onclick="openThoughtCardMenu(event, '${thought.id}')" title="Меню действий" aria-label="Меню">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="1.5"></circle>
                  <circle cx="6" cy="12" r="1.5"></circle>
                  <circle cx="18" cy="12" r="1.5"></circle>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

/**
 * Filter by tag pill
 */
function setJournalTagFilter(tag, el) {
  journalFilterTag = tag || 'all';
  const pills = document.querySelectorAll('.apple-tag-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (el) {
    el.classList.add('active');
  }
  renderJournalThoughtsList();
}
window.setJournalTagFilter = setJournalTagFilter;

/**
 * Toggle Search Bar
 */
function toggleJournalSearchUI() {
  const wrap = document.getElementById('appleJournalSearchWrap');
  if (!wrap) return;
  const isHidden = (wrap.style.display === 'none' || !wrap.style.display);
  wrap.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    const input = document.getElementById('appleJournalSearchInput');
    if (input) input.focus();
  }
}
window.toggleJournalSearchUI = toggleJournalSearchUI;

/**
 * Search Input Handler
 */
function handleJournalSearch(val) {
  journalSearchQuery = val || '';
  renderJournalThoughtsList();
}
window.handleJournalSearch = handleJournalSearch;

/**
 * Clear Search Input
 */
function clearJournalSearch() {
  journalSearchQuery = '';
  const input = document.getElementById('appleJournalSearchInput');
  if (input) input.value = '';
  renderJournalThoughtsList();
}
window.clearJournalSearch = clearJournalSearch;

/**
 * Bookmark toggle for a note card
 */
async function toggleThoughtBookmark(event, id) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const thought = allJournalThoughts.find(t => String(t.id) === String(id));
  if (!thought) return;

  thought.isBookmarked = !thought.isBookmarked;

  try {
    if (typeof updateJournalThought === 'function') {
      await updateJournalThought(thought);
    }
    renderJournalThoughtsList();
    showToast(thought.isBookmarked ? 'Добавлено в избранное' : 'Удалено из избранного', 'info');
    if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
  } catch (err) {
    console.error('Failed to toggle bookmark:', err);
  }
}
window.toggleThoughtBookmark = toggleThoughtBookmark;

/**
 * Filter only bookmarked toggle
 */
function toggleFilterOnlyBookmarked() {
  filterOnlyBookmarked = !filterOnlyBookmarked;
  closeAppleJournalMenu();
  renderJournalThoughtsList();
  showToast(filterOnlyBookmarked ? 'Показаны только избранные записи' : 'Показаны все записи', 'info');
}
window.toggleFilterOnlyBookmarked = toggleFilterOnlyBookmarked;

/**
 * Context Menu: Card Menu
 */
function openThoughtCardMenu(event, id) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const thought = allJournalThoughts.find(t => String(t.id) === String(id));
  if (!thought) return;

  const overlay = document.getElementById('appleJournalMenuOverlay');
  const popup = document.getElementById('appleJournalMenuPopup');
  if (!overlay || !popup) return;

  const isBookmarked = !!thought.isBookmarked;

  popup.innerHTML = `
    <button type="button" class="apple-menu-item" onclick="closeAppleJournalMenu(); toggleThoughtBookmark(null, '${thought.id}')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="${isBookmarked ? '#ff453a' : 'none'}" stroke="${isBookmarked ? '#ff453a' : 'currentColor'}" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
      </svg>
      <span>${isBookmarked ? 'Удалить из избранного' : 'Добавить в избранное'}</span>
    </button>
    <button type="button" class="apple-menu-item" onclick="closeAppleJournalMenu(); editThoughtFromCard('${thought.id}')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      <span>Править запись</span>
    </button>
    <div class="apple-menu-divider"></div>
    <button type="button" class="apple-menu-item danger" onclick="closeAppleJournalMenu(); deleteThoughtDirect('${thought.id}')">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Удалить запись</span>
    </button>
  `;

  overlay.style.display = 'flex';
}
window.openThoughtCardMenu = openThoughtCardMenu;

/**
 * Context Menu: Top Bar Menu
 */
function openJournalTopMenu(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const overlay = document.getElementById('appleJournalMenuOverlay');
  const popup = document.getElementById('appleJournalMenuPopup');
  if (!overlay || !popup) return;

  popup.innerHTML = `
    <button type="button" class="apple-menu-item" onclick="closeAppleJournalMenu(); openNewThoughtComposer();">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      <span>Новая запись</span>
    </button>
    <button type="button" class="apple-menu-item" onclick="toggleFilterOnlyBookmarked()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="${filterOnlyBookmarked ? '#ff453a' : 'none'}" stroke="${filterOnlyBookmarked ? '#ff453a' : 'currentColor'}" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
      </svg>
      <span>${filterOnlyBookmarked ? 'Показать все записи' : 'Только избранные'}</span>
    </button>
    <div class="apple-menu-divider"></div>
    <button type="button" class="apple-menu-item" onclick="closeAppleJournalMenu(); exportJournalThoughtsJson();">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Экспорт записей дневника</span>
    </button>
  `;

  overlay.style.display = 'flex';
}
window.openJournalTopMenu = openJournalTopMenu;

/**
 * Close Context Menu
 */
function closeAppleJournalMenu() {
  const overlay = document.getElementById('appleJournalMenuOverlay');
  if (overlay) overlay.style.display = 'none';
}
window.closeAppleJournalMenu = closeAppleJournalMenu;

/**
 * Edit note directly from card context menu
 */
async function editThoughtFromCard(id) {
  await openThoughtDetail(id);
  toggleThoughtEditMode();
}
window.editThoughtFromCard = editThoughtFromCard;

/**
 * Delete note directly
 */
async function deleteThoughtDirect(id) {
  if (!confirm('Удалить эту запись из дневника?')) return;

  try {
    if (typeof deleteJournalThought === 'function') {
      await deleteJournalThought(id);
    }
    showToast('Запись удалена', 'info');
    await loadAndRenderJournal();
    if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
  } catch (err) {
    console.error('Failed to delete thought:', err);
    showToast('Не удалось удалить мысль', 'error');
  }
}
window.deleteThoughtDirect = deleteThoughtDirect;

/**
 * Export journal thoughts as JSON
 */
function exportJournalThoughtsJson() {
  try {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(allJournalThoughts, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `tradelog-journal-${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchorElem.click();
    showToast('Записи дневника экспортированы в JSON', 'success');
  } catch (e) {
    showToast('Не удалось экспортировать записи', 'error');
  }
}
window.exportJournalThoughtsJson = exportJournalThoughtsJson;

/**
 * Open Note Detail View
 */
async function openThoughtDetail(id) {
  let thought = allJournalThoughts.find(t => String(t.id) === String(id));
  if (!thought && typeof getJournalThought === 'function') {
    try {
      thought = await getJournalThought(id);
    } catch (e) {}
  }

  if (!thought) {
    showToast('Запись не найдена', 'error');
    return;
  }

  showThoughtDetailScreen(thought);
}
window.openThoughtDetail = openThoughtDetail;

/**
 * Show Note Detail Screen
 */
function showThoughtDetailScreen(thought) {
  currentOpenThoughtId = thought.id;
  isEditingThought = false;
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;

  const listView = document.getElementById('journalListView');
  const detailView = document.getElementById('journalDetailView');
  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Configure top action bar: actions menu + 'Править' pill
  const topActions = document.getElementById('appleDetailTopActions');
  if (topActions) {
    topActions.innerHTML = `
      <button type="button" class="apple-circle-btn" onclick="openThoughtCardMenu(event, '${thought.id}')" title="Действия" aria-label="Меню">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1.5"></circle>
          <circle cx="6" cy="12" r="1.5"></circle>
          <circle cx="18" cy="12" r="1.5"></circle>
        </svg>
      </button>
      <button type="button" class="apple-pill-btn" onclick="toggleThoughtEditMode()" title="Редактировать мысль" aria-label="Править">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Править</span>
      </button>
    `;
  }

  renderThoughtViewMode(thought);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Render View Mode (Clean reading mode like Apple Journal)
 */
function renderThoughtViewMode(thought) {
  const container = document.getElementById('journalDetailContent');
  if (!container) return;

  const { title, body } = getThoughtTitleAndBody(thought);
  const subdate = formatAppleJournalSubDate(thought.createdAt);
  const fullDate = formatAppleJournalCardDate(thought.createdAt);
  const tag = (thought.tag && thought.tag !== 'Мысли') ? thought.tag : 'Запись';

  const audioHtml = thought.audioData ? `
    <div style="margin-top: 24px; padding: 14px 16px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 18px; width: 100%;">
      <div style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span>Голосовая запись (${thought.audioDuration || 0} сек)</span>
      </div>
      <audio controls src="${thought.audioData}" class="thought-native-audio" style="width: 100% !important; min-width: 100% !important; height: 44px !important; outline: none; display: block;"></audio>
    </div>
  ` : '';

  container.innerHTML = `
    <div class="apple-view-card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span class="apple-tag-pill active" style="font-size: 0.75rem; padding: 3px 12px; pointer-events: none;">${safeEscape(tag)}</span>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${fullDate}</span>
      </div>
      <h1 class="apple-view-title">${safeEscape(title)}</h1>
      <div class="apple-view-subdate">${subdate}</div>
      <div class="apple-view-text">${safeEscape(body)}</div>
      ${audioHtml}
    </div>
  `;
}

/**
 * Open Composer to Create New Note (+)
 */
function openNewThoughtComposer() {
  currentOpenThoughtId = null;
  isEditingThought = true;
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;

  const listView = document.getElementById('journalListView');
  const detailView = document.getElementById('journalDetailView');
  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Configure topbar: three dots menu + checkmark save button
  const topActions = document.getElementById('appleDetailTopActions');
  if (topActions) {
    topActions.innerHTML = `
      <button type="button" class="apple-circle-btn" onclick="openComposerToolsMenu(event)" title="Меню действий" aria-label="Меню">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1.5"></circle>
          <circle cx="6" cy="12" r="1.5"></circle>
          <circle cx="18" cy="12" r="1.5"></circle>
        </svg>
      </button>
      <button type="button" class="apple-check-btn" onclick="saveCurrentThought()" title="Сохранить запись" aria-label="Сохранить">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
    `;
  }

  renderThoughtComposerMode(null);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    const textarea = document.getElementById('iosNoteEditText');
    if (textarea) textarea.focus();
  }, 100);
}
window.openNewThoughtComposer = openNewThoughtComposer;

/**
 * Render Composer / Edit Mode with Apple Capsule Bar
 */
function renderThoughtComposerMode(existingThought) {
  const container = document.getElementById('journalDetailContent');
  if (!container) return;

  const initialTitle = existingThought ? (existingThought.title || '') : '';
  const initialText = existingThought ? (existingThought.text || '') : '';
  const initialTag = existingThought ? (existingThought.tag || 'Запись') : 'Запись';
  const existingAudio = existingThought ? existingThought.audioData : null;
  const existingDuration = existingThought ? (existingThought.audioDuration || 0) : 0;

  currentRecordedAudioDataUrl = existingAudio || null;
  currentRecordedAudioDuration = existingDuration || 0;

  container.innerHTML = `
    <div class="apple-composer-wrap">
      
      <!-- Top meta row: Category Chip & Date -->
      <div class="apple-composer-meta-row">
        <button type="button" id="appleComposerTagBtn" class="apple-composer-tag-chip" onclick="cycleJournalTag()" title="Нажмите, чтобы сменить категорию">
          <span id="appleComposerTagText">${safeEscape(initialTag)}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <input type="hidden" id="iosNoteEditTag" value="${safeEscape(initialTag)}" />
        <span class="apple-composer-date-text">${formatAppleJournalSubDate(existingThought?.createdAt || new Date().toISOString())}</span>
      </div>

      <!-- Title Input -->
      <input type="text" id="iosNoteEditTitle" class="apple-edit-title" placeholder="Заголовок..." value="${safeEscape(initialTitle)}" />

      <!-- Main Textarea -->
      <textarea id="iosNoteEditText" class="apple-edit-textarea" placeholder="Начните писать свои мысли, анализ или наблюдения...">${safeEscape(initialText)}</textarea>

      <!-- Audio Preview Box -->
      <div id="thoughtAudioPreviewBox" style="margin-top: 10px; display: ${currentRecordedAudioDataUrl ? 'block' : 'none'};">
        ${renderAudioPreviewCardHtml(currentRecordedAudioDataUrl, currentRecordedAudioDuration)}
      </div>

      <!-- Floating Bottom Capsule Toolbar (activated via ... at top) -->
      <div id="appleFloatingCapsuleBar" class="apple-floating-capsule-bar">
        <button type="button" class="apple-capsule-btn" onclick="insertPromptHelper()" title="Шаблон разбора сделки" aria-label="Шаблон">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 4V2"></path>
            <path d="M15 16v-2"></path>
            <path d="M8 9h2"></path>
            <path d="M20 9h2"></path>
            <path d="M17.8 11.8L19 13"></path>
            <path d="M15 9h0"></path>
            <path d="M17.8 6.2L19 5"></path>
            <path d="M3 21l9-9"></path>
            <path d="M12.2 6.2L11 5"></path>
          </svg>
        </button>
        <button type="button" class="apple-capsule-btn" onclick="insertCurrentTimeSnippet()" title="Вставить отметку времени" aria-label="Время">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </button>
        <button type="button" id="appleCapsuleMicBtn" class="apple-capsule-btn ${isRecordingThoughtAudio ? 'recording' : ''}" onclick="toggleThoughtAudioRecording()" title="Записать голос" aria-label="Микрофон">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
        <button type="button" class="apple-capsule-btn" onclick="cycleJournalTag()" title="Сменить категорию" aria-label="Категория">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
        </button>
        <button type="button" class="apple-capsule-btn" onclick="insertTraderReflectionPrompt()" title="Урок и психология" aria-label="Урок">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
        <button type="button" class="apple-capsule-btn" onclick="toggleBottomCapsuleBar()" title="Скрыть панель" aria-label="Скрыть">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

    </div>
  `;
}

/**
 * Toggle Edit Mode ("Править" <-> Edit View)
 */
async function toggleThoughtEditMode() {
  if (isEditingThought) {
    await saveCurrentThought();
  } else {
    const thought = allJournalThoughts.find(t => String(t.id) === String(currentOpenThoughtId));
    if (!thought) return;

    isEditingThought = true;

    // Configure topbar for edit mode: three dots menu + checkmark save button
    const topActions = document.getElementById('appleDetailTopActions');
    if (topActions) {
      topActions.innerHTML = `
        <button type="button" class="apple-circle-btn" onclick="openComposerToolsMenu(event)" title="Меню действий" aria-label="Меню">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="1.5"></circle>
            <circle cx="6" cy="12" r="1.5"></circle>
            <circle cx="18" cy="12" r="1.5"></circle>
          </svg>
        </button>
        <button type="button" class="apple-check-btn" onclick="saveCurrentThought()" title="Сохранить запись" aria-label="Сохранить">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
      `;
    }

    renderThoughtComposerMode(thought);

    setTimeout(() => {
      const textarea = document.getElementById('iosNoteEditText');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }, 100);
  }
}
window.toggleThoughtEditMode = toggleThoughtEditMode;

/**
 * Return to Journal List
 */
function backToJournalList() {
  if (isRecordingThoughtAudio) {
    stopThoughtAudioRecording();
  }

  const capsuleBar = document.getElementById('appleFloatingCapsuleBar');
  if (capsuleBar) capsuleBar.classList.remove('visible');

  const listView = document.getElementById('journalListView');
  const detailView = document.getElementById('journalDetailView');
  if (detailView) detailView.style.display = 'none';
  if (listView) listView.style.display = 'block';

  currentOpenThoughtId = null;
  isEditingThought = false;
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;

  loadAndRenderJournal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.backToJournalList = backToJournalList;

/**
 * Save Current Thought (Title, Body, Tag, Audio)
 */
async function saveCurrentThought() {
  if (isRecordingThoughtAudio) {
    stopThoughtAudioRecording();
  }

  const titleInput = document.getElementById('iosNoteEditTitle');
  const textInput = document.getElementById('iosNoteEditText');
  const tagSelect = document.getElementById('iosNoteEditTag');

  const title = titleInput ? titleInput.value.trim() : '';
  const text = textInput ? textInput.value.trim() : '';
  const tag = tagSelect ? tagSelect.value : 'Запись';

  if (!title && !text && !currentRecordedAudioDataUrl) {
    showToast('Введите текст или запишите голосовую мысль', 'warning');
    return;
  }

  try {
    if (currentOpenThoughtId) {
      const existing = await getJournalThought(currentOpenThoughtId);
      if (!existing) {
        showToast('Ошибка: исходная мысль не найдена', 'error');
        return;
      }

      const updated = {
        ...existing,
        title: title,
        text: text,
        tag: tag,
        audioData: currentRecordedAudioDataUrl || null,
        audioDuration: currentRecordedAudioDuration || 0,
        updatedAt: new Date().toISOString()
      };

      await updateJournalThought(updated);
      showToast('Запись успешно обновлена', 'success');

      await loadAndRenderJournal();
      if (typeof scheduleAutoSync === 'function') scheduleAutoSync();

      const refreshed = allJournalThoughts.find(t => String(t.id) === String(currentOpenThoughtId)) || updated;
      showThoughtDetailScreen(refreshed);

    } else {
      const newThought = {
        title: title,
        text: text,
        tag: tag,
        audioData: currentRecordedAudioDataUrl || null,
        audioDuration: currentRecordedAudioDuration || 0,
        createdAt: new Date().toISOString()
      };

      await addJournalThought(newThought);
      showToast('Запись сохранена в дневник', 'success');

      backToJournalList();
      if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
    }

  } catch (err) {
    console.error('Failed to save thought:', err);
    showToast('Ошибка при сохранении записи', 'error');
  }
}
window.saveCurrentThought = saveCurrentThought;

/**
 * Delete Current Open Thought
 */
async function handleCurrentThoughtDelete() {
  if (!currentOpenThoughtId) return;

  if (confirm('Удалить эту мысль из дневника?')) {
    try {
      if (typeof deleteJournalThought === 'function') {
        await deleteJournalThought(currentOpenThoughtId);
      }
      showToast('Мысль удалена', 'info');
      backToJournalList();
      if (typeof syncWithCloud === 'function' && typeof isUserLoggedIn === 'function' && isUserLoggedIn()) {
        syncWithCloud(true).catch(err => console.warn('Auto-sync error:', err));
      } else if (typeof scheduleAutoSync === 'function') {
        scheduleAutoSync();
      }
    } catch (err) {
      console.error('Failed to delete thought:', err);
      showToast('Не удалось удалить мысль', 'error');
    }
  }
}
window.handleCurrentThoughtDelete = handleCurrentThoughtDelete;

/**
 * Audio Recording Implementation
 */
async function toggleThoughtAudioRecording() {
  if (isRecordingThoughtAudio) {
    stopThoughtAudioRecording();
  } else {
    await startThoughtAudioRecording();
  }
}
window.toggleThoughtAudioRecording = toggleThoughtAudioRecording;

async function startThoughtAudioRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Запись аудио не поддерживается данным браузером', 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    thoughtAudioChunks = [];

    let mimeType = 'audio/webm';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
      mimeType = 'audio/ogg;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
      mimeType = 'audio/mp4';
    }

    thoughtMediaRecorder = new MediaRecorder(stream, { mimeType });

    thoughtMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        thoughtAudioChunks.push(e.data);
      }
    };

    thoughtMediaRecorder.onstop = () => {
      const audioBlob = new Blob(thoughtAudioChunks, { type: mimeType });
      const reader = new FileReader();
      reader.onloadend = () => {
        currentRecordedAudioDataUrl = reader.result;
        renderAudioPreviewInEditor();
      };
      reader.readAsDataURL(audioBlob);

      stream.getTracks().forEach(track => track.stop());
    };

    thoughtMediaRecorder.start(250);
    isRecordingThoughtAudio = true;
    thoughtRecordStartTime = Date.now();

    updateThoughtRecordUI(true);
    thoughtRecordTimerInterval = setInterval(updateThoughtRecordTimer, 500);
    showToast('Запись голоса началась...', 'info');

  } catch (err) {
    console.error('Audio recording failed:', err);
    showToast('Не удалось получить доступ к микрофону', 'error');
    updateThoughtRecordUI(false);
  }
}

function stopThoughtAudioRecording() {
  if (thoughtMediaRecorder && isRecordingThoughtAudio) {
    try {
      thoughtMediaRecorder.stop();
    } catch (e) {}
  }
  isRecordingThoughtAudio = false;
  clearInterval(thoughtRecordTimerInterval);
  thoughtRecordTimerInterval = null;
  currentRecordedAudioDuration = Math.max(1, Math.round((Date.now() - thoughtRecordStartTime) / 1000));
  updateThoughtRecordUI(false);
  showToast('Голосовая запись готова', 'success');
}
window.stopThoughtAudioRecording = stopThoughtAudioRecording;

function updateThoughtRecordTimer() {
  const elapsedSec = Math.floor((Date.now() - thoughtRecordStartTime) / 1000);
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  const btnText = document.getElementById('thoughtRecordBtnText');
  if (btnText) {
    btnText.textContent = `Остановить (${mins}:${secs})`;
  }
}

function updateThoughtRecordUI(recording) {
  const micBtn = document.getElementById('appleCapsuleMicBtn');
  if (micBtn) {
    if (recording) {
      micBtn.classList.add('recording');
    } else {
      micBtn.classList.remove('recording');
    }
  }
}

function renderAudioPreviewCardHtml(dataUrl, duration) {
  if (!dataUrl) return '';
  return `
    <div class="audio-note-preview-card" style="width: 100%; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 16px; margin-top: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <span style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span>Голосовая мысль (${duration} сек)</span>
        </span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeCurrentThoughtAudio()" title="Удалить аудиозапись" style="height: 28px; min-height: 28px; padding: 0 10px; font-size: 0.72rem; border-radius: 14px; display: inline-flex; align-items: center; gap: 4px; color: var(--loss); border-color: rgba(244, 63, 94, 0.25);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          <span>Удалить</span>
        </button>
      </div>
      <audio controls src="${dataUrl}" class="thought-native-audio" style="width: 100% !important; min-width: 100% !important; height: 44px !important; outline: none; display: block;"></audio>
    </div>
  `;
}

function renderAudioPreviewInEditor() {
  const container = document.getElementById('thoughtAudioPreviewBox');
  if (!container) return;

  if (currentRecordedAudioDataUrl) {
    container.innerHTML = renderAudioPreviewCardHtml(currentRecordedAudioDataUrl, currentRecordedAudioDuration);
    container.style.display = 'block';
  } else {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

function removeCurrentThoughtAudio() {
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;
  renderAudioPreviewInEditor();
  showToast('Голосовая запись удалена из черновика', 'info');
}
window.removeCurrentThoughtAudio = removeCurrentThoughtAudio;

/**
 * Capsule bar helpers: prompts, time mark, tags
 */
function insertPromptHelper() {
  const textarea = document.getElementById('iosNoteEditText');
  if (!textarea) return;

  const template = `\n---\nСетап: \nКонтекст рынка: \nПсихологическое состояние: \nГлавный вывод: \n`;
  textarea.value = (textarea.value ? textarea.value.trim() + '\n' : '') + template;
  textarea.focus();
  showToast('Шаблон рефлексии вставлен', 'info');
}
window.insertPromptHelper = insertPromptHelper;

function insertCurrentTimeSnippet() {
  const textarea = document.getElementById('iosNoteEditText');
  if (!textarea) return;

  const nowStr = `\n[${formatAppleJournalSubDate(new Date().toISOString())}]\n`;
  textarea.value = (textarea.value ? textarea.value.trim() + '\n' : '') + nowStr;
  textarea.focus();
}
window.insertCurrentTimeSnippet = insertCurrentTimeSnippet;

function insertTraderReflectionPrompt() {
  const textarea = document.getElementById('iosNoteEditText');
  if (!textarea) return;

  const reflection = `\nУрок дня: Соблюдал ли я правила риска? Что помогло или помешало?\n`;
  textarea.value = (textarea.value ? textarea.value.trim() + '\n' : '') + reflection;
  textarea.focus();
}
window.insertTraderReflectionPrompt = insertTraderReflectionPrompt;

function cycleJournalTag() {
  const hiddenInput = document.getElementById('iosNoteEditTag');
  const chipText = document.getElementById('appleComposerTagText');
  const menuTagLabel = document.getElementById('menuCurrentTagLabel');

  const options = ['Запись', 'Психология', 'Анализ рынка', 'Торговый план', 'Ошибки'];
  const currentVal = hiddenInput ? hiddenInput.value : 'Запись';
  const currentIndex = options.indexOf(currentVal);
  const nextTag = options[(currentIndex + 1) % options.length];

  if (hiddenInput) hiddenInput.value = nextTag;
  if (chipText) chipText.textContent = nextTag;
  if (menuTagLabel) menuTagLabel.textContent = nextTag;

  showToast(`Категория: ${nextTag}`, 'info');
}
window.cycleJournalTag = cycleJournalTag;

/**
 * Toggle Emerging Capsule Toolbar in Composer
 */
function toggleBottomCapsuleBar() {
  const bar = document.getElementById('appleFloatingCapsuleBar');
  if (!bar) return;
  const isVisible = bar.classList.contains('visible');
  if (isVisible) {
    bar.classList.remove('visible');
  } else {
    bar.classList.add('visible');
  }
}
window.toggleBottomCapsuleBar = toggleBottomCapsuleBar;

/**
 * Context Menu: Composer Tools Menu (from topbar ...)
 */
function openComposerToolsMenu(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const overlay = document.getElementById('appleJournalMenuOverlay');
  const popup = document.getElementById('appleJournalMenuPopup');
  if (!overlay || !popup) return;

  const currentTagInput = document.getElementById('iosNoteEditTag');
  const currentTag = currentTagInput ? currentTagInput.value : 'Запись';

  popup.innerHTML = `
    <button type="button" class="apple-menu-item" onclick="closeAppleJournalMenu(); toggleThoughtAudioRecording();">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="23"></line>
        <line x1="8" y1="23" x2="16" y2="23"></line>
      </svg>
      <span>Записать голосовую мысль</span>
    </button>
    <div class="apple-menu-divider"></div>
    <button type="button" class="apple-menu-item" onclick="cycleJournalTag();">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
        <line x1="7" y1="7" x2="7.01" y2="7"></line>
      </svg>
      <span>Категория: <strong id="menuCurrentTagLabel">${safeEscape(currentTag)}</strong></span>
    </button>
    <div class="apple-menu-divider"></div>
    <button type="button" class="apple-menu-item danger" onclick="closeAppleJournalMenu(); ${currentOpenThoughtId ? `deleteThoughtDirect('${currentOpenThoughtId}')` : `backToJournalList()`};">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Удалить запись</span>
    </button>
  `;

  overlay.style.display = 'flex';
}
window.openComposerToolsMenu = openComposerToolsMenu;

/**
 * HTML Escape Helper
 */
function safeEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
