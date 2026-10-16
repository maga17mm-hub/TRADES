/**
 * ============================================================================
 * TradeLog Journal Thoughts & Voice Memos Module (Apple Notes iOS Style)
 * Manages personal trader reflections, emotions, market psychology, and audio recordings.
 * Stored completely offline in IndexedDB (journal_thoughts).
 * ============================================================================
 */

let allJournalThoughts = [];
let currentOpenThoughtId = null;
let isEditingThought = false;

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
      allJournalThoughts = Array.isArray(thoughts) ? thoughts : [];
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
 * Filter thoughts and render the iOS Notes list
 */
function renderJournalThoughtsList() {
  const container = document.getElementById('journalThoughtsFeed');
  const countBadge = document.getElementById('journalCountBadge');

  if (!container) return;

  // Filter by tag and search query
  let filtered = [...allJournalThoughts];

  if (journalFilterTag && journalFilterTag !== 'all') {
    filtered = filtered.filter(t => (t.tag || 'Мысли') === journalFilterTag);
  }

  if (journalSearchQuery && journalSearchQuery.trim()) {
    const q = journalSearchQuery.trim().toLowerCase();
    filtered = filtered.filter(t => {
      const textMatch = (t.text || '').toLowerCase().includes(q);
      const tagMatch = (t.tag || '').toLowerCase().includes(q);
      return textMatch || tagMatch;
    });
  }

  // Update count badge
  if (countBadge) {
    countBadge.textContent = formatThoughtCountRu(filtered.length);
  }

  // Empty State
  if (filtered.length === 0) {
    if (allJournalThoughts.length === 0) {
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
          <h3 class="ios-notes-empty-title">Ваш дневник мыслей пуст</h3>
          <p class="ios-notes-empty-desc">
            Сохраните идею, разберите сделку или запишите голосовую заметку. Ваша история начинается здесь.
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
            По запросу «${safeEscape(journalSearchQuery)}» мыслей не найдено. Попробуйте сбросить поиск или выбрать другую категорию.
          </p>
        </div>
      `;
    }
    return;
  }

  // Render Note Cards
  container.innerHTML = filtered.map(thought => {
    const { title, snippet } = getThoughtTitleAndSnippet(thought);
    const dateStr = formatThoughtShortDate(thought.createdAt);
    const tag = thought.tag || 'Мысли';
    const hasAudio = !!thought.audioData;
    const audioDurationText = thought.audioDuration ? `${thought.audioDuration} сек` : 'Голос';

    return `
      <div class="ios-note-card" onclick="openThoughtDetail(${thought.id})">
        <div class="ios-note-card-main">
          <div class="ios-note-card-title">${safeEscape(title)}</div>
          <div class="ios-note-card-subline">
            <span class="ios-note-card-date">${dateStr}</span>
            <span class="ios-note-card-snippet">${safeEscape(snippet)}</span>
          </div>
        </div>
        <div class="ios-note-card-aside">
          ${hasAudio ? `
            <span class="ios-note-audio-chip" title="Голосовая заметка">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
              <span>${audioDurationText}</span>
            </span>
          ` : ''}
          <span class="ios-note-tag-chip">${safeEscape(tag)}</span>
          <span class="ios-note-chevron">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Extract Title and Short Excerpt Snippet (couple of words) from thought
 */
function getThoughtTitleAndSnippet(thought) {
  const text = (thought.text || '').trim();
  if (!text) {
    return {
      title: 'Голосовая мысль',
      snippet: thought.audioDuration ? `Голосовая запись (${thought.audioDuration} сек)` : 'Голосовая запись'
    };
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  const words = firstLine.split(/\s+/);

  let title = '';
  let snippet = '';

  if (words.length <= 5 && firstLine.length <= 40) {
    title = firstLine;
    const remainingText = text.substring(firstLine.length).trim();
    if (remainingText) {
      snippet = remainingText.replace(/\r?\n/g, ' ').substring(0, 70);
    } else {
      snippet = 'Нет дополнительного текста';
    }
  } else {
    title = words.slice(0, 5).join(' ') + '...';
    snippet = words.slice(5).join(' ').substring(0, 70);
  }

  return { title, snippet };
}

/**
 * Open Note in Detail View (View Mode)
 */
async function openThoughtDetail(id) {
  const thought = allJournalThoughts.find(t => t.id === Number(id));
  if (!thought) {
    if (typeof getJournalThought === 'function') {
      try {
        const dbThought = await getJournalThought(id);
        if (dbThought) {
          showThoughtDetailScreen(dbThought);
          return;
        }
      } catch (e) {}
    }
    showToast('Мысль не найдена', 'error');
    return;
  }

  showThoughtDetailScreen(thought);
}
window.openThoughtDetail = openThoughtDetail;

/**
 * Display the detail screen for a note
 */
function showThoughtDetailScreen(thought) {
  currentOpenThoughtId = thought.id;
  isEditingThought = false;
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;

  // Toggle screens
  const listView = document.getElementById('journalListView');
  const detailView = document.getElementById('journalDetailView');
  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Configure topbar
  updateDetailTopbar(false, true);

  // Render content
  renderThoughtViewMode(thought);

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Open Composer to Add New Thought (+)
 */
function openNewThoughtComposer() {
  currentOpenThoughtId = null;
  isEditingThought = true;
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;

  // Toggle screens
  const listView = document.getElementById('journalListView');
  const detailView = document.getElementById('journalDetailView');
  if (listView) listView.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Configure topbar (In composer mode: Save button visible, Delete button hidden)
  updateDetailTopbar(true, false);

  // Render empty composer form
  renderThoughtComposerMode(null);

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Focus textarea
  setTimeout(() => {
    const textarea = document.getElementById('iosNoteEditText');
    if (textarea) textarea.focus();
  }, 100);
}
window.openNewThoughtComposer = openNewThoughtComposer;

/**
 * Back to Notes List Screen
 */
function backToJournalList() {
  if (isRecordingThoughtAudio) {
    stopThoughtAudioRecording();
  }

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
 * Toggle Edit Mode ("Править" <-> "Сохранить")
 */
async function toggleThoughtEditMode() {
  if (isEditingThought) {
    // If currently editing, save!
    await saveCurrentThought();
  } else {
    // Switch to edit mode for current note
    const thought = allJournalThoughts.find(t => t.id === Number(currentOpenThoughtId));
    if (!thought) return;

    isEditingThought = true;
    updateDetailTopbar(true, true);
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
 * Update the Topbar (Править / Сохранить button and Delete button)
 */
function updateDetailTopbar(editing, canDelete) {
  const toggleBtn = document.getElementById('journalEditToggleBtn');
  const toggleLabel = document.getElementById('journalEditToggleLabel');
  const deleteBtn = document.getElementById('journalDeleteBtn');

  if (toggleBtn && toggleLabel) {
    if (editing) {
      toggleBtn.classList.remove('btn-secondary');
      toggleBtn.classList.add('btn-primary');
      toggleBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span id="journalEditToggleLabel">Сохранить</span>
      `;
    } else {
      toggleBtn.classList.remove('btn-primary');
      toggleBtn.classList.add('btn-secondary');
      toggleBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span id="journalEditToggleLabel">Править</span>
      `;
    }
  }

  if (deleteBtn) {
    deleteBtn.style.display = canDelete ? 'inline-flex' : 'none';
  }
}

/**
 * Render View Mode (Clean reading layout)
 */
function renderThoughtViewMode(thought) {
  const container = document.getElementById('journalDetailContent');
  if (!container) return;

  const dateCreated = formatThoughtFullDate(thought.createdAt);
  const dateUpdated = thought.updatedAt && thought.updatedAt !== thought.createdAt 
    ? `· Изменено ${formatThoughtFullDate(thought.updatedAt)}` 
    : '';
  const tag = thought.tag || 'Мысли';

  const audioHtml = thought.audioData ? `
    <div class="ios-note-audio-box">
      <div class="ios-note-audio-header">
        <span style="display: inline-flex; align-items: center; gap: 6px; color: var(--brand); font-weight: 500;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          Голосовая заметка
        </span>
        <span>${thought.audioDuration ? thought.audioDuration + ' сек' : ''}</span>
      </div>
      <audio controls src="${thought.audioData}" class="thought-native-audio" style="width: 100%; margin-top: 6px;"></audio>
    </div>
  ` : '';

  const textHtml = thought.text 
    ? `<div class="ios-note-view-text">${safeEscape(thought.text)}</div>` 
    : `<div class="ios-note-view-text" style="color: var(--text-muted); font-style: italic;">Текстовая запись отсутствует (только голосовая заметка)</div>`;

  container.innerHTML = `
    <div class="ios-note-view-card">
      <div class="ios-note-view-meta">
        <span class="ios-note-tag-chip" style="font-size: 0.78rem; padding: 4px 10px;">${safeEscape(tag)}</span>
        <span class="ios-note-view-date">${dateCreated} ${dateUpdated}</span>
      </div>

      ${textHtml}
      ${audioHtml}

      <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.05); display: flex; justify-content: flex-end; gap: 10px;">
        <button type="button" class="btn btn-secondary btn-sm" onclick="toggleThoughtEditMode()" style="display: inline-flex; align-items: center; gap: 6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          <span>Редактировать запись</span>
        </button>
      </div>
    </div>
  `;
}

/**
 * Render Composer / Edit Mode (Input textarea, category picker, voice memo recorder)
 */
function renderThoughtComposerMode(existingThought) {
  const container = document.getElementById('journalDetailContent');
  if (!container) return;

  const initialText = existingThought ? (existingThought.text || '') : '';
  const initialTag = existingThought ? (existingThought.tag || 'Мысли') : 'Мысли';
  const existingAudio = existingThought ? existingThought.audioData : null;
  const existingDuration = existingThought ? (existingThought.audioDuration || 0) : 0;

  // Set initial audio state
  currentRecordedAudioDataUrl = existingAudio || null;
  currentRecordedAudioDuration = existingDuration || 0;

  container.innerHTML = `
    <div class="ios-note-edit-card">
      
      <!-- Category Tag Row (Compact, Right-aligned) -->
      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-bottom: 12px;">
        <div style="display: inline-flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 0.74rem;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
            <line x1="7" y1="7" x2="7.01" y2="7"></line>
          </svg>
        </div>
        <select id="iosNoteEditTag" class="form-select form-select-sm" style="width: auto; min-width: 140px; max-width: 170px; height: 30px; min-height: 30px; padding: 2px 24px 2px 10px; font-size: 0.76rem; border-radius: 15px;">
          <option value="Мысли" ${initialTag === 'Мысли' ? 'selected' : ''}>Мысли и выводы</option>
          <option value="Психология" ${initialTag === 'Психология' ? 'selected' : ''}>Психология</option>
          <option value="Анализ рынка" ${initialTag === 'Анализ рынка' ? 'selected' : ''}>Анализ рынка</option>
          <option value="Торговый план" ${initialTag === 'Торговый план' ? 'selected' : ''}>Торговый план</option>
          <option value="Ошибки" ${initialTag === 'Ошибки' ? 'selected' : ''}>Ошибки</option>
        </select>
      </div>

      <!-- Main Textarea -->
      <div style="margin-bottom: 16px;">
        <textarea id="iosNoteEditText" class="ios-note-textarea" placeholder="Напишите свои мысли по рынку...">${safeEscape(initialText)}</textarea>
      </div>

      <!-- Voice Memo Section -->
      <div class="thought-record-box" style="margin-bottom: 20px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px;">
          <span style="font-size: 0.84rem; font-weight: 500; color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            Голосовая запись
          </span>
          <span style="font-size: 0.74rem; color: var(--text-muted);">Без ограничений по времени</span>
        </div>

        <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <button type="button" id="thoughtRecordBtn" class="btn btn-secondary thought-mic-btn" onclick="toggleThoughtAudioRecording()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <span id="thoughtRecordBtnText">Записать голосовую мысль</span>
          </button>

          <!-- Animated Recording Waves -->
          <div id="thoughtRecordWave" class="record-wave-container" style="display: none;">
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
            <div class="wave-bar"></div>
          </div>
        </div>

        <!-- Audio Preview Box -->
        <div id="thoughtAudioPreviewBox" style="margin-top: 12px; display: ${currentRecordedAudioDataUrl ? 'block' : 'none'};">
          ${renderAudioPreviewCardHtml(currentRecordedAudioDataUrl, currentRecordedAudioDuration)}
        </div>
      </div>

      <!-- Action Buttons Row -->
      <div style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
        <button type="button" class="btn btn-secondary btn-sm" onclick="cancelThoughtEdit()">
          Отмена
        </button>
        <button type="button" class="btn btn-primary thought-save-btn" onclick="saveCurrentThought()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Сохранить запись</span>
        </button>
      </div>

    </div>
  `;
}

/**
 * Cancel Edit / Composer
 */
function cancelThoughtEdit() {
  if (isRecordingThoughtAudio) {
    stopThoughtAudioRecording();
  }

  if (currentOpenThoughtId) {
    // Return to view mode for existing thought
    isEditingThought = false;
    updateDetailTopbar(false, true);
    const thought = allJournalThoughts.find(t => t.id === Number(currentOpenThoughtId));
    if (thought) {
      renderThoughtViewMode(thought);
    } else {
      backToJournalList();
    }
  } else {
    // Was creating a new thought, return to list
    backToJournalList();
  }
}
window.cancelThoughtEdit = cancelThoughtEdit;

/**
 * Save Current Thought (New or Existing)
 */
async function saveCurrentThought() {
  if (isRecordingThoughtAudio) {
    stopThoughtAudioRecording();
  }

  const textInput = document.getElementById('iosNoteEditText');
  const tagSelect = document.getElementById('iosNoteEditTag');

  const text = textInput ? textInput.value.trim() : '';
  const tag = tagSelect ? tagSelect.value : 'Мысли';

  if (!text && !currentRecordedAudioDataUrl) {
    showToast('Введите текст или запишите голосовую мысль', 'warning');
    return;
  }

  try {
    if (currentOpenThoughtId) {
      // Update existing thought
      const existing = await getJournalThought(currentOpenThoughtId);
      if (!existing) {
        showToast('Ошибка: исходная мысль не найдена', 'error');
        return;
      }

      const updated = {
        ...existing,
        text: text,
        tag: tag,
        audioData: currentRecordedAudioDataUrl || null,
        audioDuration: currentRecordedAudioDuration || 0,
        updatedAt: new Date().toISOString()
      };

      await updateJournalThought(updated);
      showToast('Мысль успешно обновлена!', 'success');

      // Refresh cache
      await loadAndRenderJournal();
      if (typeof scheduleAutoSync === 'function') scheduleAutoSync();

      // Return to view mode with updated thought
      const refreshed = allJournalThoughts.find(t => t.id === Number(currentOpenThoughtId)) || updated;
      isEditingThought = false;
      updateDetailTopbar(false, true);
      renderThoughtViewMode(refreshed);

    } else {
      // Create new thought
      const newThought = {
        text: text,
        tag: tag,
        audioData: currentRecordedAudioDataUrl || null,
        audioDuration: currentRecordedAudioDuration || 0,
        createdAt: new Date().toISOString()
      };

      await addJournalThought(newThought);
      showToast('Запись добавлена в дневник!', 'success');

      // Return to list screen so user sees the newly added thought at the top
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
      if (typeof scheduleAutoSync === 'function') scheduleAutoSync();
    } catch (err) {
      console.error('Failed to delete thought:', err);
      showToast('Не удалось удалить мысль', 'error');
    }
  }
}
window.handleCurrentThoughtDelete = handleCurrentThoughtDelete;

/**
 * Audio Recording Logic
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
    btnText.textContent = `Остановить запись (${mins}:${secs})`;
  }
}

function updateThoughtRecordUI(recording) {
  const btn = document.getElementById('thoughtRecordBtn');
  const wave = document.getElementById('thoughtRecordWave');

  if (btn) {
    if (recording) {
      btn.classList.add('recording');
      btn.innerHTML = `
        <span class="record-pulse-dot"></span>
        <span id="thoughtRecordBtnText">Остановить запись (00:00)</span>
      `;
    } else {
      btn.classList.remove('recording');
      btn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span id="thoughtRecordBtnText">Записать голосовую мысль</span>
      `;
    }
  }

  if (wave) {
    wave.style.display = recording ? 'flex' : 'none';
  }
}

function renderAudioPreviewCardHtml(dataUrl, duration) {
  if (!dataUrl) return '';
  return `
    <div class="audio-note-preview-card">
      <div class="audio-note-left">
        <span class="audio-note-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </span>
        <div class="audio-note-info">
          <span class="audio-note-title">Голосовая запись прикреплена</span>
          <span class="audio-note-meta">${duration ? duration + ' сек' : ''}</span>
        </div>
      </div>
      <audio controls src="${dataUrl}" class="thought-native-audio"></audio>
      <button type="button" class="btn btn-secondary btn-sm" onclick="removeCurrentThoughtAudio()" title="Удалить запись" style="display: inline-flex; align-items: center; gap: 4px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        <span>Удалить</span>
      </button>
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
 * Search & Filtering Handlers
 */
function handleJournalSearch(val) {
  journalSearchQuery = val || '';
  const clearBtn = document.getElementById('journalSearchClearBtn');
  if (clearBtn) {
    clearBtn.style.display = journalSearchQuery ? 'inline-flex' : 'none';
  }
  renderJournalThoughtsList();
}
window.handleJournalSearch = handleJournalSearch;

function clearJournalSearch() {
  journalSearchQuery = '';
  const input = document.getElementById('journalSearchInput');
  const clearBtn = document.getElementById('journalSearchClearBtn');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  renderJournalThoughtsList();
}
window.clearJournalSearch = clearJournalSearch;

function filterJournalThoughts(tag) {
  journalFilterTag = tag || 'all';
  renderJournalThoughtsList();
}
window.filterJournalThoughts = filterJournalThoughts;

/**
 * Format Russian Plural for Thoughts Count
 */
function formatThoughtCountRu(count) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return `${count} мыслей`;
  if (n1 > 1 && n1 < 5) return `${count} мысли`;
  if (n1 === 1) return `${count} мысль`;
  return `${count} мыслей`;
}

/**
 * Format Short Date for Notes Feed Row
 */
function formatThoughtShortDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Вчера`;
  }

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/**
 * Format Full Date for Detail View
 */
function formatThoughtFullDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }) + ' · ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

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
