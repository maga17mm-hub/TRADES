/**
 * ============================================================================
 * TradeLog Journal Thoughts & Voice Memos Module
 * Manages personal trader thoughts, reflections, emotions, and audio recordings.
 * Stored completely offline in IndexedDB (journal_thoughts).
 * ============================================================================
 */

let thoughtMediaRecorder = null;
let thoughtAudioChunks = [];
let thoughtRecordStartTime = 0;
let thoughtRecordTimerInterval = null;
let currentRecordedAudioDataUrl = null;
let currentRecordedAudioDuration = 0;
let isRecordingThoughtAudio = false;

document.addEventListener('DOMContentLoaded', () => {
  initJournalThoughts();
});

async function initJournalThoughts() {
  await renderJournalThoughtsFeed();
}

/**
 * Voice Recording for Journal Thought
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

    // Check supported mime types
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
        renderThoughtAudioPreview();
      };
      reader.readAsDataURL(audioBlob);

      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
    };

    thoughtMediaRecorder.start(250);
    isRecordingThoughtAudio = true;
    thoughtRecordStartTime = Date.now();

    updateThoughtRecordUI(true);
    thoughtRecordTimerInterval = setInterval(updateThoughtRecordTimer, 500);
    showToast('🎙 Запись голоса началась...', 'info');

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
  currentRecordedAudioDuration = Math.round((Date.now() - thoughtRecordStartTime) / 1000);
  updateThoughtRecordUI(false);
  showToast('Голосовая запись сохранена для заметки', 'success');
}
window.stopThoughtAudioRecording = stopThoughtAudioRecording;

function updateThoughtRecordTimer() {
  const elapsedSec = Math.floor((Date.now() - thoughtRecordStartTime) / 1000);
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');
  const label = document.getElementById('thoughtRecordTimerLabel');
  if (label) {
    label.textContent = `${mins}:${secs}`;
  }
}

function updateThoughtRecordUI(recording) {
  const btn = document.getElementById('thoughtRecordBtn');
  const wave = document.getElementById('thoughtRecordWave');
  const timerLabel = document.getElementById('thoughtRecordTimerLabel');

  if (btn) {
    if (recording) {
      btn.classList.add('recording');
      btn.innerHTML = `
        <span class="record-pulse-dot"></span>
        <span>■ Остановить запись (<span id="thoughtRecordTimerLabel">00:00</span>)</span>
      `;
    } else {
      btn.classList.remove('recording');
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
        <span>🎙 Записать голосовую мысль</span>
      `;
    }
  }

  if (wave) {
    wave.style.display = recording ? 'flex' : 'none';
  }
}

function renderThoughtAudioPreview() {
  const container = document.getElementById('thoughtAudioPreviewBox');
  if (!container) return;

  if (currentRecordedAudioDataUrl) {
    container.innerHTML = `
      <div class="audio-note-preview-card">
        <div class="audio-note-left">
          <span class="audio-note-icon">🎙</span>
          <div class="audio-note-info">
            <span class="audio-note-title">Голосовая запись готова</span>
            <span class="audio-note-meta">${currentRecordedAudioDuration} сек</span>
          </div>
        </div>
        <audio controls src="${currentRecordedAudioDataUrl}" class="thought-native-audio"></audio>
        <button type="button" class="btn btn-secondary btn-sm" onclick="clearCurrentThoughtAudio()" title="Удалить запись">✕ Удалить</button>
      </div>
    `;
    container.style.display = 'block';
  } else {
    container.innerHTML = '';
    container.style.display = 'none';
  }
}

function clearCurrentThoughtAudio() {
  currentRecordedAudioDataUrl = null;
  currentRecordedAudioDuration = 0;
  renderThoughtAudioPreview();
}
window.clearCurrentThoughtAudio = clearCurrentThoughtAudio;

/**
 * Save Journal Thought
 */
async function handleSaveJournalThought(e) {
  if (e) e.preventDefault();

  const textInput = document.getElementById('journalThoughtText');
  const tagSelect = document.getElementById('journalThoughtTag');

  const text = textInput ? textInput.value.trim() : '';
  const tag = tagSelect ? tagSelect.value : '💭 Мысли';

  if (!text && !currentRecordedAudioDataUrl) {
    showToast('Введите текст или запишите голосовую мысль', 'warning');
    return;
  }

  const thoughtData = {
    text: text,
    tag: tag,
    audioData: currentRecordedAudioDataUrl || null,
    audioDuration: currentRecordedAudioDuration || 0,
    createdAt: new Date().toISOString()
  };

  try {
    await addJournalThought(thoughtData);
    showToast('Запись добавлена в дневник!', 'success');

    // Reset form
    if (textInput) textInput.value = '';
    clearCurrentThoughtAudio();
    await renderJournalThoughtsFeed();
  } catch (err) {
    console.error('Failed to save thought:', err);
    showToast('Ошибка сохранения записи', 'error');
  }
}
window.handleSaveJournalThought = handleSaveJournalThought;

/**
 * Render Thoughts Feed
 */
async function renderJournalThoughtsFeed() {
  const container = document.getElementById('journalThoughtsFeed');
  if (!container) return;

  try {
    const thoughts = await getAllJournalThoughts();

    if (!thoughts || thoughts.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="padding: 36px 20px; text-align: center;">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">📖</div>
          <h3 style="font-size: 1.05rem; font-weight: 600; color: #fff; margin-bottom: 6px;">Ваш дневник мыслей пуст</h3>
          <p style="color: var(--text-muted); font-size: 0.85rem; max-width: 360px; margin: 0 auto 16px;">
            Здесь хранятся ваши личные размышления, эмоции, психология и голосовые заметки без сделок.
          </p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('journalThoughtText').focus()">
            + Написать первую мысль
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = thoughts.map(t => {
      const dateObj = new Date(t.createdAt);
      const formattedDate = dateObj.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      const formattedTime = dateObj.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      });

      const audioPlayerHtml = t.audioData ? `
        <div class="thought-card-audio">
          <div class="thought-card-audio-header">
            <span>🎙 Голосовая заметка</span>
            <span class="thought-audio-duration">${t.audioDuration ? t.audioDuration + ' сек' : ''}</span>
          </div>
          <audio controls src="${t.audioData}" class="thought-native-audio"></audio>
        </div>
      ` : '';

      return `
        <div class="thought-card">
          <div class="thought-card-header">
            <div class="thought-tag-badge">${escapeHtml(t.tag || '💭 Мысли')}</div>
            <div class="thought-date-wrap">
              <span class="thought-date">${formattedDate} · ${formattedTime}</span>
              <button type="button" class="btn-icon-danger btn-sm" onclick="handleDeleteThought(${t.id})" title="Удалить запись">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          ${t.text ? `<div class="thought-card-text">${escapeHtml(t.text).replace(/\n/g, '<br>')}</div>` : ''}
          ${audioPlayerHtml}
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to render thoughts:', err);
  }
}
window.renderJournalThoughtsFeed = renderJournalThoughtsFeed;

async function handleDeleteThought(id) {
  if (confirm('Удалить эту запись из дневника?')) {
    try {
      await deleteJournalThought(id);
      showToast('Запись удалена', 'info');
      await renderJournalThoughtsFeed();
    } catch (e) {
      showToast('Не удалось удалить запись', 'error');
    }
  }
}
window.handleDeleteThought = handleDeleteThought;
