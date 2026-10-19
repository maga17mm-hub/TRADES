/**
 * ============================================================================
 * TradeLog AI Assistant (Raycast Midnight Theme)
 * Powered by Tooken Club (gpt-5.6-terra)
 * Voice: local Piper Dmitri neural synthesis and server Whisper recognition.
 * 
 * Features:
 * - Natural language trade logging ("добавь сделку лонг по BTC...")
 * - Speech-to-Text: Speak commands via microphone in Russian
 * - Text-to-Speech: Neural voice "Дмитрий" (Piper), with explicit device/Edge options
 * - Automatic extraction of Symbol, Direction, Setup, Timeframe, Outcome, PnL
 * - Journal performance analytics & trading psychology feedback
 * - Offline / CORS-resilient fallback parser
 * - Server-side credentials and same-origin API requests
 * ============================================================================
 */

// Model & API configuration
const AI_DEFAULT_MODEL = 'gpt-5.6-terra';
const AI_DEFAULT_BASE_URL = 'https://tooken.club/v1';

function getPreconfiguredKey() { return ''; }


function getAiApiKey() {
  return localStorage.getItem('tradelog_ai_api_key') || getPreconfiguredKey();
}

function getAiModel() {
  return localStorage.getItem('tradelog_ai_model') || AI_DEFAULT_MODEL;
}

function getAiBaseUrl() {
  return localStorage.getItem('tradelog_ai_base_url') || AI_DEFAULT_BASE_URL;
}

function getAiProxyUrl() { return ''; }


// Conversation State
let aiChatHistory = [];
let isAiGenerating = false;

// Voice Synthesis (TTS - Dmitry) State
let isVoiceEnabled = localStorage.getItem('tradelog_ai_voice_enabled') !== 'false'; // default on
let currentlySpeakingIdx = null;

// Voice Recognition (STT - Mic) State
let speechRecognizer = null;
let isListening = false;

/**
 * Initialize AI Assistant on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  initAiChatHistory();
  initVoiceEngine();
  updateVoiceToggleUI();
});

function initVoiceEngine() {
  try {
    const saved = localStorage.getItem('tradelog_selected_voice') || '';
    if (saved.toLowerCase().includes('milena') || saved.toLowerCase().includes('милена')) {
      localStorage.removeItem('tradelog_selected_voice');
    }
  } catch (e) {}

  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.getVoices();
    } catch (e) {}
    window.speechSynthesis.onvoiceschanged = () => {
      getDmitryVoice();
      if (typeof populateSettingsVoiceList === 'function') {
        populateSettingsVoiceList();
      }
    };
  }
}

function initAiChatHistory() {
  const saved = localStorage.getItem('tradelog_ai_chat') || sessionStorage.getItem('tradelog_ai_chat');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        aiChatHistory = parsed;
        renderAiChat();
        return;
      }
    } catch (e) {
      console.warn('Failed to parse AI chat history:', e);
    }
  }

  // Initial welcome message
  aiChatHistory = [
    {
      role: 'assistant',
      content: 'Привет! Я твой торговый ИИ-ассистент с голосом **Дмитрия**.\n\nТы можешь нажать на микрофон и сказать голосом:\n- *«Добавь сделку: лонг по BTC/USDT на 15m, сетап пробой уровня, вход 68500, выход 70000, профит +2.5R»*\n- *«Проанализируй мои последние сделки и винрейт»*\n- *«Какой сетап приносит больше всего прибыли?»*\n\nЯ сразу распознаю голос, занесу сделку в дневник и отвечу голосом Дмитрия!',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ];
  renderAiChat();
}

function saveAiChatHistory() {
  try {
    const trimmed = aiChatHistory.slice(-50);
    localStorage.setItem('tradelog_ai_chat', JSON.stringify(trimmed));
  } catch (e) {
    console.warn('Failed to save AI chat:', e);
  }
}

/**
 * ============================================================================
 * VOICE SYNTHESIS: Нейросетевой голос «Дмитрий» (TTS)
 * ============================================================================
 */
// Helper: Strictly reject Milena and all known female voices
function isFemaleRussianVoice(v) {
  if (!v) return false;
  const n = (v.name || '').toLowerCase();
  return n.includes('milena') || n.includes('милена') ||
         n.includes('katya') || n.includes('катя') ||
         n.includes('svetlana') || n.includes('светлана') ||
         n.includes('irina') || n.includes('ирина') ||
         n.includes('dariya') || n.includes('дарья') ||
         n.includes('daria') || n.includes('tatiana') ||
         n.includes('татьяна') || n.includes('tatyana') ||
         n.includes('elena') || n.includes('елена') ||
         n.includes('olga') || n.includes('ольга') ||
         n.includes('anna') || n.includes('анна') ||
         n.includes('victoria') || n.includes('виктория') ||
         n.includes('viktoriya') || n.includes('alena') ||
         n.includes('алена') || n.includes('алёна') ||
         n.includes('ksenia') || n.includes('ксения') ||
         n.includes('natalia') || n.includes('наталья') ||
         n.includes('vera') || n.includes('вера') ||
         n.includes('female') || n.includes('женск') ||
         n.includes('siri voice 1');
}

// Helper: Detect verified male Russian voice
function isMaleRussianVoice(v) {
  if (!v) return false;
  const n = (v.name || '').toLowerCase();
  return n.includes('dmitry') || n.includes('дмитрий') ||
         n.includes('pavel') || n.includes('павел') ||
         n.includes('yuri') || n.includes('юрий') ||
         n.includes('aleksandr') || n.includes('александр') ||
         n.includes('ivan') || n.includes('иван') ||
         n.includes('boris') || n.includes('борис') ||
         n.includes('male') || n.includes('мужск');
}

function getDmitryVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices || voices.length === 0) return null;

  // 0. User-selected preferred voice from Settings (ignoring any female voice)
  let preferredVoiceName = localStorage.getItem('tradelog_selected_voice');
  if (preferredVoiceName) {
    if (isFemaleRussianVoice({ name: preferredVoiceName })) {
      localStorage.removeItem('tradelog_selected_voice');
      preferredVoiceName = null;
    } else {
      const userVoice = voices.find(v => v.name === preferredVoiceName);
      if (userVoice && !isFemaleRussianVoice(userVoice)) return userVoice;
    }
  }

  // 1. Exact Microsoft Dmitry Neural / Online Natural voice (Highest fidelity 24kHz natural Russian male voice)
  let voice = voices.find(v => {
    const n = v.name.toLowerCase();
    const l = (v.lang || '').toLowerCase();
    return (l.startsWith('ru') || l.includes('ru')) &&
           (n.includes('dmitry') || n.includes('дмитрий')) &&
           (n.includes('natural') || n.includes('neural') || n.includes('online')) &&
           !isFemaleRussianVoice(v);
  });
  if (voice) return voice;

  // 2. Any Dmitry / Дмитрий in Russian
  voice = voices.find(v => {
    const n = v.name.toLowerCase();
    const l = (v.lang || '').toLowerCase();
    return (l.startsWith('ru') || l.includes('ru')) && 
           (n.includes('dmitry') || n.includes('дмитрий')) &&
           !isFemaleRussianVoice(v);
  });
  if (voice) return voice;

  // 3. Microsoft Natural / Neural Russian male voice (Edge / Windows Online Natural)
  voice = voices.find(v => {
    const n = v.name.toLowerCase();
    const l = (v.lang || '').toLowerCase();
    return (l.startsWith('ru') || l.includes('ru')) && 
           (n.includes('natural') || n.includes('neural') || n.includes('online')) && 
           !isFemaleRussianVoice(v);
  });
  if (voice) return voice;

  // 4. Any verified Russian male voice (Pavel / Павел, Yuri / Юрий on iOS, Aleksandr, Ivan)
  voice = voices.find(v => {
    const l = (v.lang || '').toLowerCase();
    return (l.startsWith('ru') || l.includes('ru')) && isMaleRussianVoice(v) && !isFemaleRussianVoice(v);
  });
  if (voice) return voice;

  // 5. Any Russian voice that is NOT female (e.g. Google Russian which we will pitch-shift to male baritone)
  voice = voices.find(v => {
    const l = (v.lang || '').toLowerCase();
    const n = v.name.toLowerCase();
    return (l.startsWith('ru') || l.includes('ru') || n.includes('russian') || n.includes('русский')) && !isFemaleRussianVoice(v);
  });
  if (voice) return voice;

  return null;
}

function getAvailableRussianVoices() {
  if (!('speechSynthesis' in window)) return [];
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.filter(v => {
    const l = (v.lang || '').toLowerCase();
    const n = (v.name || '').toLowerCase();
    // Strictly exclude all female voices
    if (isFemaleRussianVoice(v)) return false;
    return l.startsWith('ru') || l.includes('ru') || n.includes('russian') || n.includes('русский') || n.includes('dmitry');
  });
}
window.getAvailableRussianVoices = getAvailableRussianVoices;

// Native Russian Streaming Audio Player (Fallback when OS has no Russian TTS)
let currentTtsAudio = null;
let currentTtsAudioChunks = [];
let currentTtsChunkIndex = 0;

function splitIntoTtsChunks(text, maxLen = 170) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+|\S+/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    const cleanS = s.trim();
    if (!cleanS) continue;
    if ((cur + ' ' + cleanS).trim().length <= maxLen) {
      cur = (cur + ' ' + cleanS).trim();
    } else {
      if (cur) chunks.push(cur);
      if (cleanS.length > maxLen) {
        const words = cleanS.split(' ');
        let sub = '';
        for (const w of words) {
          if ((sub + ' ' + w).trim().length <= maxLen) {
            sub = (sub + ' ' + w).trim();
          } else {
            if (sub) chunks.push(sub);
            sub = w;
          }
        }
        if (sub) chunks.push(sub);
        cur = '';
      } else {
        cur = cleanS;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks.filter(c => c.trim().length > 0);
}



function cleanTextForSpeech(text) {
  if (!text) return '';
  let t = String(text);

  // 1. Remove code blocks and JSON action definitions
  t = t.replace(/```json:trade_action[\s\S]*?```/gi, '');
  t = t.replace(/```json[\s\S]*?```/gi, '');
  t = t.replace(/```[\s\S]*?```/g, '');
  t = t.replace(/`([^`]+)`/g, '$1');

  // 2. Remove URLs and links
  t = t.replace(/https?:\/\/\S+/gi, '');

  // 3. Phonetic conversion of trading pairs and symbols to natural Russian speech
  t = t.replace(/\bBTC\/USDT\b/gi, 'Биткоин к ю-эс-ди-ти');
  t = t.replace(/\bETH\/USDT\b/gi, 'Эфириум к ю-эс-ди-ти');
  t = t.replace(/\bSOL\/USDT\b/gi, 'Солана к ю-эс-ди-ти');
  t = t.replace(/\bXAU\/USD\b/gi, 'Золото к доллару');
  t = t.replace(/\bXRP\/USDT\b/gi, 'Риппл к ю-эс-ди-ти');
  t = t.replace(/\bTON\/USDT\b/gi, 'Тон к ю-эс-ди-ти');
  t = t.replace(/\bBNB\/USDT\b/gi, 'Би-эн-би к ю-эс-ди-ти');
  t = t.replace(/\bDOGE\/USDT\b/gi, 'Доги к ю-эс-ди-ти');
  t = t.replace(/\bBTC\b/gi, 'Биткоин');
  t = t.replace(/\bETH\b/gi, 'Эфириум');
  t = t.replace(/\bSOL\b/gi, 'Солана');
  t = t.replace(/\bLONG\b/gi, 'лонг');
  t = t.replace(/\bSHORT\b/gi, 'шорт');
  t = t.replace(/\bWIN\b/gi, 'тейк-профит');
  t = t.replace(/\bLOSS\b/gi, 'стоп-лосс');
  t = t.replace(/\bBE\b/gi, 'безубыток');
  t = t.replace(/\bPnL\b/gi, 'пээнель');
  t = t.replace(/\b(R:R|R\/R|RR)\b/gi, 'соотношение риска к прибыли');
  t = t.replace(/\+([0-9]+(?:\.[0-9]+)?)\s*R\b/gi, 'плюс $1 эр');
  t = t.replace(/\-([0-9]+(?:\.[0-9]+)?)\s*R\b/gi, 'минус $1 эр');
  t = t.replace(/\b([0-9]+(?:\.[0-9]+)?)\s*R\b/gi, '$1 эр');
  t = t.replace(/\b15m\b/gi, '15 минут');
  t = t.replace(/\b1h\b/gi, 'один час');
  t = t.replace(/\b4h\b/gi, 'четыре часа');
  t = t.replace(/\b1D\b/gi, 'дневной график');
  t = t.replace(/\b5m\b/gi, '5 минут');
  t = t.replace(/\b1m\b/gi, '1 минута');

  // 4. Strip markdown formatting
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/_([^_]+)_/g, '$1');
  t = t.replace(/#+\s+/g, '');
  t = t.replace(/^\s*[-•*]\s+/gm, '');
  t = t.replace(/\|/g, ' ');

  // 5. Remove unicode emojis and symbols
  t = t.replace(/[\u2600-\u27BF]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F\uDE80-\uDEFF]|\uD83E[\uDD00-\uDDFF]/g, '');

  // 6. Smooth punctuation for natural breathing pauses
  t = t.replace(/[:;]/g, ',');
  t = t.replace(/[\(\)\[\]\{\}]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

let dmitryKeepAliveTimer = null;

let speechAbortController = null;
let speechObjectUrl = null;
let speechGeneration = 0;
let voicePlaybackContext = null;
let currentPiperSource = null;
const piperPlaybackSources = new Set();

function unlockVoicePlayback() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    if (voicePlaybackContext?.state === 'closed') voicePlaybackContext = null;
    voicePlaybackContext ||= new AudioContext();
    voicePlaybackContext.resume().catch(() => {});
  } catch (_) {}
}

function setVoiceStatus(text = '') {
  for (const id of ['aiVoiceStatus', 'settingsVoiceStatus']) {
    const element = document.getElementById(id);
    if (element) { if (element.textContent !== text) element.textContent = text; element.hidden = !text; }
  }
}

async function speakWithDmitry(text, msgIdx = null, force = false) {
  if (!isVoiceEnabled && !force) return;
  stopSpeaking();
  unlockVoicePlayback();
  const cleanText = cleanTextForSpeech(text).slice(0, 2500);
  if (!cleanText) return;
  const selected = localStorage.getItem('tradelog_selected_voice');
  // System voices remain an explicit option; they are never presented as neural Dmitry.
  if (selected && selected !== 'edge-dmitry' && window.speechSynthesis) {
    const voice = window.speechSynthesis.getVoices().find(item => item.name === selected);
    if (voice) {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.voice = voice; utterance.lang = 'ru-RU';
      currentlySpeakingIdx = msgIdx;
      utterance.onend = () => { currentlySpeakingIdx = null; updateSpeechButtonsUI(); };
      utterance.onerror = utterance.onend;
      window.speechSynthesis.speak(utterance);
      updateSpeechButtonsUI();
      return;
    }
  }
  const generation = speechGeneration;
  speechAbortController = new AbortController();
  const controller = speechAbortController;
  const timer = setTimeout(() => controller.abort(), selected === 'edge-dmitry' ? 100000 : 300000);
  currentlySpeakingIdx = msgIdx;
  updateSpeechButtonsUI();
  let playbackFailure = null;
  try {
    let blob;
    if (selected !== 'edge-dmitry') {
      if (!window.DmitryPiper) throw new Error('Модуль голоса не загрузился. Обновите страницу.');
      setVoiceStatus('Подготавливаю голос Дмитрия…');
      if (voicePlaybackContext) {
        let queue = Promise.resolve(), nextStart = 0, queued = 0, ended = 0, complete = false;
        await window.DmitryPiper.synthesize(cleanText, {
          signal: controller.signal,
          onProgress: text => { if (generation === speechGeneration && !piperPlaybackSources.size) setVoiceStatus(text); },
          onChunk: audio => {
            queued++;
            queue = queue.then(async () => {
              if (generation !== speechGeneration) return;
              const buffer = await voicePlaybackContext.decodeAudioData(audio);
              if (generation !== speechGeneration) return;
              await voicePlaybackContext.resume();
              if (voicePlaybackContext.state !== 'running') throw new DOMException('Нужно разрешить воспроизведение', 'NotAllowedError');
              const source = voicePlaybackContext.createBufferSource();
              source.buffer = buffer; source.connect(voicePlaybackContext.destination);
              piperPlaybackSources.add(source);
              const startAt = Math.max(voicePlaybackContext.currentTime + 0.02, nextStart);
              nextStart = startAt + buffer.duration;
              source.onended = () => {
                piperPlaybackSources.delete(source); source.disconnect(); ended++;
                if (complete && ended === queued && generation === speechGeneration) stopSpeaking();
              };
              source.start(startAt); setVoiceStatus('Дмитрий говорит…');
            }).catch(error => { playbackFailure = error; controller.abort(); });
          }
        });
        await queue;
        if (playbackFailure) throw playbackFailure;
        if (generation !== speechGeneration) return;
        complete = true;
        if (!queued) throw new Error('Не удалось создать озвучку. Нажмите кнопку ещё раз.');
        if (ended === queued) stopSpeaking();
        return;
      }
      blob = await window.DmitryPiper.synthesize(cleanText, {
        signal: controller.signal,
        onProgress: text => { if (generation === speechGeneration) setVoiceStatus(text); }
      });
    } else {
      const response = await tradeLogApiFetch('/api/speech', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text: cleanText}), signal: controller.signal
      });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('audio/')) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Голос Дмитрия недоступен. Проверьте подключение к серверу.');
      }
      blob = await response.blob();
    }
    if (generation !== speechGeneration) return;
    setVoiceStatus();
    if (voicePlaybackContext) {
      const buffer = await voicePlaybackContext.decodeAudioData(await blob.arrayBuffer());
      if (generation !== speechGeneration) return;
      await voicePlaybackContext.resume();
      if (voicePlaybackContext.state !== 'running') throw new DOMException('Нужно разрешить воспроизведение', 'NotAllowedError');
      currentPiperSource = voicePlaybackContext.createBufferSource();
      currentPiperSource.buffer = buffer;
      currentPiperSource.connect(voicePlaybackContext.destination);
      currentPiperSource.onended = () => { if (generation === speechGeneration) stopSpeaking(); };
      currentPiperSource.start();
      setVoiceStatus('Дмитрий говорит…');
      return;
    }
    speechObjectUrl = URL.createObjectURL(blob);
    currentTtsAudio = new Audio(speechObjectUrl);
    currentTtsAudio.onended = () => { if (generation === speechGeneration) stopSpeaking(); };
    await currentTtsAudio.play();
    setVoiceStatus('Дмитрий говорит…');
  } catch (error) {
    if (generation !== speechGeneration) return;
    error = playbackFailure || error;
    stopSpeaking();
    if (error.name !== 'AbortError') showToast(error.name === 'NotAllowedError'
      ? 'Нажмите кнопку озвучки у ответа, чтобы включить звук.' : error.message, 'warning');
  } finally { clearTimeout(timer); }
}
window.speakWithDmitry = speakWithDmitry;

function stopSpeaking() {
  speechGeneration++;
  speechAbortController?.abort(); speechAbortController = null;
  for (const source of piperPlaybackSources) { try { source.stop(); source.disconnect(); } catch (_) {} }
  piperPlaybackSources.clear();
  if (currentPiperSource) { try { currentPiperSource.stop(); currentPiperSource.disconnect(); } catch (_) {} currentPiperSource = null; }
  setVoiceStatus();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentTtsAudio) { currentTtsAudio.pause(); currentTtsAudio.src = ''; currentTtsAudio = null; }
  if (speechObjectUrl) { URL.revokeObjectURL(speechObjectUrl); speechObjectUrl = null; }
  currentlySpeakingIdx = null;
  updateSpeechButtonsUI();
}
window.stopSpeaking = stopSpeaking;


function toggleSpeakMessage(idx) {
  if (currentlySpeakingIdx === idx) {
    stopSpeaking();
  } else {
    const msg = aiChatHistory[idx];
    if (msg && msg.content) {
      speakWithDmitry(msg.content, idx, true);
    }
  }
}
window.toggleSpeakMessage = toggleSpeakMessage;

function toggleAiVoice() {
  isVoiceEnabled = !isVoiceEnabled;
  localStorage.setItem('tradelog_ai_voice_enabled', isVoiceEnabled);

  if (!isVoiceEnabled) {
    stopSpeaking();
    showToast('Озвучка Дмитрия выключена', 'info');
  } else {
    showToast('Озвучка Дмитрия включена', 'success');
    speakWithDmitry('Голос Дмитрия включен. Я готов озвучивать ответы и добавленные сделки.');
  }

  updateVoiceToggleUI();
}
window.toggleAiVoice = toggleAiVoice;

function updateVoiceToggleUI() {
  const btn = document.getElementById('aiVoiceToggleBtn');
  const label = document.getElementById('aiVoiceToggleLabel');
  if (btn) {
    if (isVoiceEnabled) {
      btn.classList.add('active');
      if (label) label.textContent = 'Дмитрий: Вкл';
    } else {
      btn.classList.remove('active');
      if (label) label.textContent = 'Дмитрий: Выкл';
    }
  }

  const modalToggleBtn = document.getElementById('modalVoiceToggleBtn');
  if (modalToggleBtn) {
    if (isVoiceEnabled) {
      modalToggleBtn.textContent = 'Включено';
      modalToggleBtn.classList.remove('btn-secondary');
      modalToggleBtn.classList.add('btn-primary');
    } else {
      modalToggleBtn.textContent = 'Выключено';
      modalToggleBtn.classList.remove('btn-primary');
      modalToggleBtn.classList.add('btn-secondary');
    }
  }
}

function updateSpeechButtonsUI() {
  document.querySelectorAll('.ai-speech-btn').forEach(btn => {
    const idx = Number(btn.dataset.msgIdx);
    if (currentlySpeakingIdx === idx) {
      btn.classList.add('speaking');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2"></rect>
        </svg>
      `;
      btn.title = 'Остановить воспроизведение';
    } else {
      btn.classList.remove('speaking');
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        </svg>
      `;
      btn.title = 'Озвучить голосом Дмитрия';
    }
  });
}

/**
 * ============================================================================
 * VOICE INPUT: Распознавание речи (STT - Speech-to-Text)
 * ============================================================================
 */
let recognitionSilenceTimer = null;

let recognitionSession = 0;
let recognitionShouldSend = false;
let recognitionFinalText = '';
let recognitionPrefix = '';
let voiceRecorder = null;
let voiceTranscribing = false;
let transcriptionController = null;

async function transcribeRecording(blob, session) {
  if (session !== recognitionSession) return;
  isListening = false;
  voiceTranscribing = true;
  updateMicButtonUI(false);
  const controller = new AbortController();
  transcriptionController = controller;
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    if (session !== recognitionSession) return;
    const response = await tradeLogApiFetch('/api/transcribe', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, cache: 'no-store',
      body: JSON.stringify({audio: btoa(binary)}), signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось распознать запись.');
    if (session !== recognitionSession) return;
    if (!result.text?.trim()) throw new Error('Речь не распознана. Попробуйте ещё раз.');
    const input = document.getElementById('aiChatInput');
    if (input) input.value = [recognitionPrefix, result.text.trim()].filter(Boolean).join(' ');
    voiceTranscribing = false;
    updateMicButtonUI(false);
    await handleAiSubmit();
  } catch (error) {
    if (session === recognitionSession) showToast(error.name === 'AbortError'
      ? 'Распознавание заняло слишком много времени. Попробуйте ещё раз.' : error.message, 'warning');
  } finally {
    clearTimeout(timeout);
    if (session === recognitionSession) {
      voiceTranscribing = false; transcriptionController = null; updateMicButtonUI(false);
    }
  }
}

function initSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = 'ru-RU'; recognition.continuous = true; recognition.interimResults = true;
  const session = recognitionSession;
  recognition.onresult = event => {
    if (session !== recognitionSession) return;
    let final = '', interim = '';
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) final += result[0].transcript + ' ';
      else interim += result[0].transcript + ' ';
    }
    recognitionFinalText = final.trim();
    const input = document.getElementById('aiChatInput');
    if (input) input.value = [recognitionPrefix, final, interim].join(' ').trim();
    clearTimeout(recognitionSilenceTimer);
    if (recognitionFinalText && !interim.trim()) recognitionSilenceTimer = setTimeout(() => stopListening(true), 2500);
  };
  recognition.onerror = event => {
    if (session !== recognitionSession) return;
    recognitionShouldSend = false;
    isListening = false; updateMicButtonUI(false);
    clearTimeout(recognitionSilenceTimer);
    const messages = {
      'not-allowed': 'Разрешите доступ к микрофону в настройках браузера.',
      'service-not-allowed': 'Браузер запретил распознавание речи. Попробуйте Chrome или Edge.',
      'audio-capture': 'Микрофон не найден. Проверьте подключение.',
      'network': 'Нет связи с сервисом распознавания. Текст можно отправить вручную.',
      'no-speech': 'Речь не распознана. Нажмите микрофон и попробуйте снова.'
    };
    if (event.error !== 'aborted') showToast(messages[event.error] || 'Не удалось распознать речь.', 'warning');
  };
  recognition.onend = () => {
    if (session !== recognitionSession) return;
    clearTimeout(recognitionSilenceTimer);
    isListening = false; updateMicButtonUI(false);
    const shouldSend = recognitionShouldSend && recognitionFinalText;
    recognitionShouldSend = false;
    if (shouldSend) {
      const input = document.getElementById('aiChatInput');
      if (input) input.value = [recognitionPrefix, recognitionFinalText].join(' ').trim();
      handleAiSubmit();
    }
  };
  return recognition;
}

function toggleVoiceRecording() {
  if (voiceTranscribing) stopListening(false);
  else if (isListening) stopListening(true);
  else startListening();
}
window.toggleVoiceRecording = toggleVoiceRecording;

function startListening() {
  if (isAiGenerating || isListening || voiceTranscribing) return;
  stopSpeaking();
  unlockVoicePlayback();
  recognitionSession++;
  recognitionFinalText = '';
  recognitionPrefix = document.getElementById('aiChatInput')?.value.trim() || '';
  recognitionShouldSend = true;
  if (window.TradeVoiceRecorder?.supported()) {
    const session = recognitionSession;
    isListening = true; updateMicButtonUI(true);
    voiceRecorder = window.TradeVoiceRecorder.create({
      onAudio: blob => transcribeRecording(blob, session),
      onError: error => {
        if (session !== recognitionSession) return;
        isListening = false; updateMicButtonUI(false);
        showToast(error.name === 'NotAllowedError' ? 'Разрешите сайту доступ к микрофону.'
          : error.name === 'NotFoundError' ? 'Микрофон не найден. Проверьте подключение.' : error.message, 'warning');
      }
    });
    voiceRecorder.start();
    return;
  }
  speechRecognizer = initSpeechRecognition();
  if (!speechRecognizer) return showToast('Для голосового ввода откройте сайт в Chrome, Edge или Safari с поддержкой распознавания речи.', 'warning');
  try {
    isListening = true; updateMicButtonUI(true);
    speechRecognizer.start();
  } catch (error) {
    isListening = false; recognitionShouldSend = false; updateMicButtonUI(false);
    showToast('Не удалось включить микрофон. Проверьте разрешение браузера.', 'error');
  }
}

function stopListening(send = false) {
  clearTimeout(recognitionSilenceTimer);
  recognitionShouldSend = send;
  isListening = false; updateMicButtonUI(false);
  if (!send) recognitionSession++; // Closing the modal cancels delayed recognition events.
  if (!send) { transcriptionController?.abort(); transcriptionController = null; voiceTranscribing = false; }
  if (voiceRecorder) { voiceRecorder.stop(send); voiceRecorder = null; }
  try { speechRecognizer?.[send ? 'stop' : 'abort'](); } catch (_) {}
  updateMicButtonUI(false);
}


function updateMicButtonUI(listening) {
  const micBtn = document.getElementById('aiMicBtn');
  const inputEl = document.getElementById('aiChatInput');

  if (micBtn) {
    micBtn.setAttribute('aria-busy', String(voiceTranscribing));
    micBtn.classList.toggle('transcribing', voiceTranscribing);
    if (listening) {
      micBtn.classList.add('listening');
      micBtn.title = 'Идет запись... Нажмите, чтобы остановить';
    } else {
      micBtn.classList.remove('listening');
      micBtn.title = 'Голосовой ввод (нажмите и говорите команду)';
    }
    if (voiceTranscribing) micBtn.title = 'Распознаю запись… Нажмите для отмены';
  }

  if (inputEl) {
    if (listening) {
      inputEl.placeholder = 'Слушаю вас...';
    } else {
      inputEl.placeholder = voiceTranscribing ? 'Распознаю запись…' : '';
    }
  }
}

/**
 * UI: Open & Close AI Modal
 */
function openAiAssistant(initialPrompt = '') {
  unlockVoicePlayback();
  const modal = document.getElementById('aiAssistantModal');
  if (!modal) return;

  modal.classList.add('active');
  document.body.classList.add('modal-open');
  document.documentElement.classList.add('modal-open');
  document.body.style.overflow = 'hidden';

  const inputEl = document.getElementById('aiChatInput');
  if (inputEl) {
    if (initialPrompt) {
      inputEl.value = initialPrompt;
    }
    setTimeout(() => inputEl.focus(), 200);
  }

  updateVoiceToggleUI();
  scrollAiChatToBottom();
}
window.openAiAssistant = openAiAssistant;

function closeAiAssistant() {
  const modal = document.getElementById('aiAssistantModal');
  if (modal) {
    modal.classList.remove('active');
  }
  document.body.classList.remove('modal-open');
  document.documentElement.classList.remove('modal-open');
  document.body.style.overflow = '';
  stopSpeaking();
  stopListening();
}
window.closeAiAssistant = closeAiAssistant;

function scrollAiChatToBottom() {
  const container = document.getElementById('aiChatMessages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Render Chat Messages
 */
function renderAiChat() {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;

  container.innerHTML = aiChatHistory.map((msg, idx) => {
    const isUser = msg.role === 'user';
    const roleClass = isUser ? 'ai-msg-user' : 'ai-msg-assistant';
    const timeStr = msg.timestamp || '';

    let contentHtml = formatAiMessageContent(msg.content);

    // If message contains added trade info
    let tradeCardHtml = '';
    if (msg.createdTrade) {
      const t = msg.createdTrade;
      const outcomeClass = t.outcome === 'WIN' ? 'stat-win' : t.outcome === 'LOSS' ? 'stat-loss' : '';
      const dirColor = t.direction === 'LONG' ? 'var(--win)' : 'var(--loss)';

      tradeCardHtml = `
        <div class="ai-trade-card">
          <div class="ai-trade-card-header">
            <span class="ai-trade-pill-dir" style="color: ${dirColor};">${escapeHtml(t.direction)}</span>
            <span class="ai-trade-symbol">${escapeHtml(t.symbol)}</span>
            <span class="ai-trade-meta">${escapeHtml(t.timeframe || '15m')} · ${escapeHtml(t.setup || 'Без сетапа')}</span>
            <span class="ai-trade-pnl ${outcomeClass}">${escapeHtml(t.pnl || '')}</span>
          </div>
          <div class="ai-trade-actions">
            <button class="btn btn-secondary btn-sm" onclick="viewTradeInJournal(${t.id})" style="display: inline-flex; align-items: center; gap: 5px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <span>Открыть сделку</span>
            </button>
            <button class="btn btn-secondary btn-sm" onclick="closeAiAssistant(); editTrade(${t.id})" style="display: inline-flex; align-items: center; gap: 5px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
              <span>Редактировать</span>
            </button>
          </div>
        </div>
      `;
    }

    // Voice button for assistant messages
    const speakBtnHtml = !isUser ? `
      <button type="button" class="ai-speech-btn" data-msg-idx="${idx}" onclick="toggleSpeakMessage(${idx})" title="Озвучить голосом Дмитрия">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        </svg>
      </button>
    ` : '';

    return `
      <div class="ai-msg-row ${roleClass}">
        ${!isUser ? '<div class="ai-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6363" stroke-width="2.5"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg></div>' : ''}
        <div class="ai-msg-bubble">
          <div class="ai-msg-text">${contentHtml}</div>
          ${tradeCardHtml}
          <div class="ai-msg-footer">
            ${speakBtnHtml}
            <div class="ai-msg-time">${escapeHtml(timeStr)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (isAiGenerating) {
    container.innerHTML += `
      <div class="ai-msg-row ai-msg-assistant">
        <div class="ai-avatar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6363" stroke-width="2.5"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"></path></svg></div>
        <div class="ai-msg-bubble ai-typing-bubble">
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
          <span class="ai-typing-dot"></span>
        </div>
      </div>
    `;
  }

  updateSpeechButtonsUI();
  scrollAiChatToBottom();
}

function formatAiMessageContent(text) {
  if (!text) return '';

  // Clean out raw trade action json blocks from user-visible text if model included it
  let cleanText = text.replace(/```json:trade_action[\s\S]*?```/gi, '').trim();

  // Basic markdown formatting
  let html = escapeHtml(cleanText)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="ai-code">$1</code>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');

  return html;
}

function viewTradeInJournal(tradeId) {
  closeAiAssistant();
  switchTab('home');
  openTradeDetailModal(tradeId);
}
window.viewTradeInJournal = viewTradeInJournal;

/**
 * Handle AI Send Message
 */
let pendingTradeDictation = '';

async function handleAiSubmit(e) {
  if (e) e.preventDefault();

  const inputEl = document.getElementById('aiChatInput');
  if (!inputEl) return;

  const userText = inputEl.value.trim();
  if (!userText || isAiGenerating) return;

  if (isListening) stopListening(false);
  inputEl.value = '';

  // Add user message
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  aiChatHistory.push({
    role: 'user',
    content: userText,
    timestamp: timeStr
  });

  isAiGenerating = true;
  renderAiChat();

  try {
    if (/^(?:отмена|отмени|cancel)[.! ]*$/i.test(userText)) {
      pendingTradeDictation = '';
      pushAiMessage('Запись сделки отменена.', null, null, timeStr);
    } else if (pendingTradeDictation || TradeVoiceParser.isIntent(userText)) {
      const dictation = [TradeVoiceParser.isIntent(userText) ? '' : pendingTradeDictation, userText].filter(Boolean).join(', ');
      const parsed = TradeVoiceParser.parse(dictation);
      if (parsed.missing.length) {
        pendingTradeDictation = dictation;
        pushAiMessage('Чтобы сохранить сделку, уточните: ' + parsed.missing.join('; ') + '. Можно дописать или продиктовать. Для отмены скажите «отмена».', null, null, timeStr);
      } else {
        const trade = await executeAddTradeFromAi(parsed.trade);
        pendingTradeDictation = '';
        const message = `Сделка ${trade.symbol}, ${trade.direction}, ${trade.pnl} сохранена в дневнике.`;
        pushAiMessage(message, trade, message, timeStr);
      }
    } else {
      const aiResponse = await callTookenClubAi(userText);
      await processAiResponse(aiResponse);
    }
  } catch (err) {
    pushAiMessage('Не удалось выполнить запрос: ' + err.message + '\nЗапись сделок по команде «Запиши сделку…» работает без GPT.', null, null, timeStr);
  } finally {
    isAiGenerating = false;
    renderAiChat();
    saveAiChatHistory();
  }
}
window.handleAiSubmit = handleAiSubmit;

function sendAiPrompt(promptText) {
  const inputEl = document.getElementById('aiChatInput');
  if (inputEl) {
    inputEl.value = promptText;
    if (promptText.trim().endsWith(':')) {
      inputEl.focus();
    } else {
      handleAiSubmit();
    }
  }
}
window.sendAiPrompt = sendAiPrompt;

/**
 * Build System Prompt with current user trading context
 */
function buildAiSystemPrompt() {
  const now = new Date();
  const currentIso = now.toISOString();
  const currentDateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const savedTickers = JSON.parse(localStorage.getItem('tradelog_saved_tickers') || '[]');
  const savedSetups = JSON.parse(localStorage.getItem('tradelog_saved_setups') || '[]');

  // Calculate current user statistics
  const total = allTrades.length;
  let wins = 0;
  let losses = 0;
  let totalR = 0;
  allTrades.forEach(t => {
    totalR += parseFloat(t.rMultiple || 0);
    if (t.outcome === 'WIN') wins++;
    else if (t.outcome === 'LOSS') losses++;
  });
  const wr = total > 0 ? Math.round((wins / total) * 100) : 0;

  // Recent 5 trades summary
  const recentTrades = allTrades.slice(0, 5).map(t => 
    `#${t.id}: ${t.symbol} (${t.direction}, ${t.timeframe}) Setup: "${t.setup}", Outcome: ${t.outcome}, PnL: ${t.pnl || t.rMultiple + 'R'}, Date: ${t.entryTime}`
  ).join('\n');

  return `Ты профессиональный русскоязычный торговый ИИ-ассистент в приложении TradeLog (Raycast Midnight) с голосом Дмитрия.
Текущее локальное время пользователя: ${currentDateTime} (ISO: ${currentIso}).

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
- Всего сделок в дневнике: ${total} (Винрейт: ${wr}%, Накопленный PnL: ${totalR.toFixed(1)}R, Побед: ${wins}, Поражений: ${losses})
- Доступные тикеры: ${savedTickers.join(', ')}
- Доступные сетапы: ${savedSetups.join(', ')}
- Последние сделки:
${recentTrades || 'Пока нет сделок'}

ТВОЯ ЗАДАЧА:
Запись сделок выполняется самим приложением по явной команде пользователя.
Не утверждай, что создал или изменил сделку, не генерируй команды и JSON действий.
Если пользователь хочет записать сделку, попроси его начать сообщение с «Запиши сделку».
2. АНАЛИЗ И СОВЕТЫ:
Если пользователь спрашивает об анализе статистики, ошибках, сетапах или психологии: отвечай четко, структурно, лаконично, как профессиональный трейдер и риск-менеджер.
Отвечай всегда на русском языке. Твой ответ будет также озвучен голосом Дмитрия, поэтому пиши естественно.`;
}

/**
 * Call Tooken Club OpenAI-Compatible API (gpt-5.6-terra)
 */
async function callTookenClubAi(userMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await tradeLogApiFetch('/api/chat', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type': 'application/json'}, signal: controller.signal,
      body: JSON.stringify({model: getAiModel(), baseUrl: getAiBaseUrl(), apiKey: getAiApiKey(),
        messages: [{role: 'system', content: buildAiSystemPrompt()},
          ...aiChatHistory.slice(-6).map(({role, content}) => ({role, content}))]})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось подключиться к ИИ через сервер сайта.');
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('ИИ вернул пустой ответ.');
    return content;
  } finally { clearTimeout(timer); }
}


async function processAiResponse(rawResponse) {
  const content = rawResponse.replace(/```(?:json(?::trade_action)?)?[\s\S]*?```/gi, '').trim();
  pushAiMessage(content || 'Чтобы записать сделку, напишите «Запиши сделку» и продиктуйте её параметры.', null, null,
    new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}));
}

async function executeAddTradeFromAi(tradeObj) {
  if (!tradeObj.symbol || !['LONG', 'SHORT'].includes(tradeObj.direction) || !['WIN', 'LOSS', 'BE'].includes(tradeObj.outcome) || !Number.isFinite(tradeObj.rMultiple)) throw new Error('Не хватает данных сделки.');
  const symbol = tradeObj.symbol.toUpperCase();
  const direction = tradeObj.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const timeframe = tradeObj.timeframe || '15m';
  const setup = tradeObj.setup || 'Без сетапа';
  const outcome = tradeObj.outcome === 'LOSS' ? 'LOSS' : tradeObj.outcome === 'BE' ? 'BE' : 'WIN';

  const now = new Date();
  const currentIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const entryTime = tradeObj.entryTime || currentIso;
  const exitTime = tradeObj.exitTime || currentIso;

  let rMultiple = parseFloat(tradeObj.rMultiple);
  if (isNaN(rMultiple)) {
    rMultiple = outcome === 'WIN' ? 2.0 : outcome === 'LOSS' ? -1.0 : 0.0;
  }

  let pnl = tradeObj.pnl;
  if (!pnl) {
    pnl = rMultiple > 0 ? `+${rMultiple}R` : `${rMultiple}R`;
  }

  const tradeData = {
    symbol,
    direction,
    timeframe,
    setup,
    criteria: tradeObj.criteria || tradeObj.entryCriteria || tradeObj.entry_criteria || '',
    outcome,
    entryTime,
    exitTime,
    entryPrice: tradeObj.entryPrice ? String(tradeObj.entryPrice) : '',
    exitPrice: tradeObj.exitPrice ? String(tradeObj.exitPrice) : '',
    pnl,
    rMultiple,
    notes: tradeObj.notes || 'Записано через ИИ-ассистента',
    images: []
  };

  // Auto-save presets
  if (typeof saveTicker === 'function') saveTicker(symbol);
  if (typeof saveSetup === 'function') saveSetup(setup);
  if (typeof saveCriteria === 'function' && tradeData.criteria) saveCriteria(tradeData.criteria);
  if (typeof saveTimeframe === 'function') saveTimeframe(timeframe);

  const newId = await addTrade(tradeData);
  tradeData.id = newId;

  // Refresh calendar, analytics and feeds
  if (typeof refreshTrades === 'function') {
    await refreshTrades();
  }

  showToast(`Сделка #${newId} (${symbol}) добавлена ИИ!`, 'success');
  return tradeData;
}

/**
 * Autonomous AI Trading Engine
 * Seamlessly handles natural language trade logging, performance analytics,
 * psychology & discipline coaching, and trading education with Dmitry's neural voice.
 * Operates offline or whenever external API/CORS is unreachable.
 */
function pushAiMessage(content, createdTrade, speechText, timeStr) {
  const newIdx = aiChatHistory.length;
  aiChatHistory.push({
    role: 'assistant',
    content: content,
    createdTrade: createdTrade,
    timestamp: timeStr
  });

  speakWithDmitry(speechText || content, newIdx);
}

/**
 * Local heuristic NLP extractor for trade parameters
 */
function openAiSettings() {
  const panel = document.getElementById('aiSettingsPanel');
  if (!panel) return;

  const keyInput = document.getElementById('aiSettingKey');
  const modelInput = document.getElementById('aiSettingModel');
  const baseUrlInput = document.getElementById('aiSettingBaseUrl');
  const proxyInput = document.getElementById('aiSettingProxy');

  if (keyInput) keyInput.value = getAiApiKey();
  if (modelInput) modelInput.value = getAiModel();
  if (baseUrlInput) baseUrlInput.value = getAiBaseUrl();
  if (proxyInput) proxyInput.value = getAiProxyUrl();

  panel.style.display = 'block';
}
window.openAiSettings = openAiSettings;

function closeAiSettings() {
  const panel = document.getElementById('aiSettingsPanel');
  if (panel) panel.style.display = 'none';
}
window.closeAiSettings = closeAiSettings;

function saveAiSettings(e) {
  if (e) e.preventDefault();

  const keyInput = document.getElementById('aiSettingKey');
  const modelInput = document.getElementById('aiSettingModel');
  const baseUrlInput = document.getElementById('aiSettingBaseUrl');
  const proxyInput = document.getElementById('aiSettingProxy');

  if (keyInput) localStorage.setItem('tradelog_ai_api_key', keyInput.value.trim());
  if (modelInput) localStorage.setItem('tradelog_ai_model', modelInput.value.trim() || AI_DEFAULT_MODEL);
  if (baseUrlInput) localStorage.setItem('tradelog_ai_base_url', baseUrlInput.value.trim() || AI_DEFAULT_BASE_URL);
  if (proxyInput) localStorage.setItem('tradelog_ai_proxy_url', '');

  showToast('Настройки ИИ сохранены!', 'success');
  closeAiSettings();
}
window.saveAiSettings = saveAiSettings;

function resetAiSettings() {
  localStorage.removeItem('tradelog_ai_api_key');
  localStorage.removeItem('tradelog_ai_model');
  localStorage.removeItem('tradelog_ai_base_url');
  localStorage.removeItem('tradelog_ai_proxy_url');

  openAiSettings();
  showToast('Настройки сброшены на значения по умолчанию', 'info');
}
window.resetAiSettings = resetAiSettings;

function clearAiChat() {
  if (confirm('Очистить историю диалога с ИИ?')) {
    stopSpeaking();
    localStorage.removeItem('tradelog_ai_chat');
    sessionStorage.removeItem('tradelog_ai_chat');
    aiChatHistory = [];
    initAiChatHistory();
    showToast('История диалога очищена', 'info');
  }
}
window.clearAiChat = clearAiChat;
