/* Dmitri neural inference runs off the UI thread. Binary assets are served by this site. */
importScripts('./vendor/piper/ort.wasm.min.js', './vendor/piper/piper_phonemize.js');
let engine, queue = Promise.resolve();
const base = new URL('./vendor/piper/', self.location.href);
const progress = (id, text) => self.postMessage({id, type: 'progress', text});
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

async function cache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TradeLogVoiceCache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function cachedFile(db, key) {
  if (!db) return null;
  return new Promise(resolve => {
    const request = db.transaction('files').objectStore('files').get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  });
}
async function saveFile(db, key, value) {
  if (!db) return;
  await new Promise(resolve => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').put(value, key);
    transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
  });
}
async function unzip(blob) {
  if (!self.DecompressionStream) throw new Error('Для нейросетевого голоса обновите браузер до последней версии.');
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function initialize(id) {
  const [manifestResponse, configResponse] = await Promise.all([fetch(new URL('manifest.json', base)), fetch(new URL('voice.json', base))]);
  if (!manifestResponse.ok || !configResponse.ok) throw new Error('Не удалось загрузить настройки голоса. Обновите страницу и попробуйте снова.');
  const manifest = await manifestResponse.json(), config = await configResponse.json();
  const db = await cache().catch(() => null);
  const total = Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0);
  const files = {};
  let loaded = 0;
  try {
    for (const [name, info] of Object.entries(manifest.files)) {
      const key = manifest.id + ':' + info.sha256;
      let blob = await cachedFile(db, key);
      if (blob && (blob.size !== info.size || await hash(await blob.arrayBuffer()) !== info.sha256)) blob = null;
      if (!blob) {
        const response = await fetch(new URL(name, base));
        if (!response.ok) throw new Error('Загрузка голоса прервана. Проверьте интернет и нажмите озвучку ещё раз.');
        const reader = response.body.getReader(), chunks = [];
        let current = 0;
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          chunks.push(value); current += value.length;
          progress(id, 'Загрузка Дмитрия: ' + Math.min(99, Math.round((loaded + current) * 100 / total)) + '%');
        }
        blob = new Blob(chunks);
        if (blob.size !== info.size || await hash(await blob.arrayBuffer()) !== info.sha256) throw new Error('Модель загрузилась не полностью. Повторите загрузку.');
        await saveFile(db, key, blob).catch(() => {});
      }
      files[name] = blob; loaded += info.size;
    }
  } finally { db?.close(); }
  progress(id, 'Запускаю нейросетевой голос…');
  const [phonemeData, phonemeWasm, ortWasm, model] = await Promise.all([
    unzip(files['piper_phonemize.data.gz']), unzip(files['piper_phonemize.wasm.gz']),
    unzip(files['ort-wasm-simd.wasm.gz']), unzip(new Blob(manifest.model.parts.map(name => files[name])))
  ]);
  if (await hash(model) !== manifest.model.rawSha256) throw new Error('Не удалось проверить модель голоса. Повторите загрузку.');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  const wasmUrl = URL.createObjectURL(new Blob([ortWasm], {type: 'application/wasm'}));
  ort.env.wasm.wasmPaths = {'ort-wasm-simd.wasm': wasmUrl};
  let session;
  try { session = await ort.InferenceSession.create(model, {executionProviders: ['wasm'], enableCpuMemArena: false, enableMemPattern: false}); }
  finally { URL.revokeObjectURL(wasmUrl); }
  return {phonemeWasm, phonemeData, session, config};
}

function wave(samples, sampleRate) {
  const result = new ArrayBuffer(44 + samples.length * 2), view = new DataView(result);
  const label = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, result.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, samples[index])) * (samples[index] < 0 ? 32768 : 32767), true);
  return result;
}
async function synthesize({id, text, stream = false}) {
  if (!engine) engine = initialize(id).catch(error => {engine = null; throw error;});
  const {phonemeWasm, phonemeData, session, config} = await engine;
  progress(id, 'Дмитрий готовит ответ…');
  // Limit each inference to a sentence group, keeping mobile memory bounded.
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*|[.!?…]+/gu) || [text];
  const chunks = [];
  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    for (let offset = 0; offset < sentence.length; offset += 350) chunks.push(sentence.slice(offset, offset + 350));
  }
  const audio = [];
  for (let index = 0; index < chunks.length; index++) {
    progress(id, 'Подготовка фразы ' + (index + 1) + ' из ' + chunks.length + '…');
    // The CLI owns C/C++ stream state and must not re-enter main. A fresh,
    // short-lived phonemizer also bounds memory used by eSpeak's language state.
    let ids;
    const phonemizer = await createPiperPhonemize({
      noInitialRun: true, wasmBinary: phonemeWasm,
      getPreloadedPackage: () => phonemeData,
      locateFile: name => new URL(name, base).href,
      print: line => { try { ids = JSON.parse(line).phoneme_ids; } catch (_) {} },
      printErr: () => {}
    });
    phonemizer.callMain(['-l', config.espeak.voice, '--allow_missing_phonemes', '--input', JSON.stringify([{text: chunks[index].trim()}]), '--espeak_data', '/espeak-ng-data']);
    if (!Array.isArray(ids) || !ids.length) throw new Error('Не удалось подготовить текст для голоса. Попробуйте ещё раз.');
    progress(id, 'Озвучка фразы ' + (index + 1) + ' из ' + chunks.length + '…');
    const feeds = {
      input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
      scales: new ort.Tensor('float32', Float32Array.of(config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w), [3])
    };
    try {
      const output = await session.run(feeds);
      const samples = new Float32Array(output.output.data);
      if (stream) {
        const part = wave(samples, config.audio.sample_rate);
        self.postMessage({id, type: 'chunk', audio: part}, [part]);
      } else audio.push(samples);
      Object.values(output).forEach(tensor => tensor.dispose());
    } finally { Object.values(feeds).forEach(tensor => tensor.dispose()); }
  }
  if (stream) { self.postMessage({id, type: 'done'}); return; }
  const samples = new Float32Array(audio.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of audio) { samples.set(part, offset); offset += part.length; }
  if (!samples.length) throw new Error('Не удалось создать аудио. Нажмите озвучку ещё раз.');
  const result = wave(samples, config.audio.sample_rate);
  self.postMessage({id, type: 'audio', audio: result}, [result]);
}
self.onmessage = event => {
  queue = queue.then(() => synthesize(event.data)).catch(error => self.postMessage({id: event.data.id, type: 'error', message: error.message || 'Не удалось запустить нейросетевой голос.'}));
};
