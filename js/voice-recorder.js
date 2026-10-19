/* Microphone capture independent of the browser's proprietary speech service. */
(function (root) {
  const supported = () => !!(root.navigator?.mediaDevices?.getUserMedia && root.MediaRecorder);

  function create({onAudio, onError}) {
    let recorder, stream, context, monitor, deadline;
    let cancelled = false, send = false, finished = false, startedAt = 0;
    const chunks = [];
    function release() {
      clearInterval(monitor); clearTimeout(deadline);
      stream?.getTracks().forEach(track => track.stop());
      if (context) { context.close().catch(() => {}); context = null; }
    }
    function stop(shouldSend = false) {
      if (finished) return;
      send = shouldSend;
      if (!shouldSend) cancelled = true;
      if (!recorder) cancelled = true; // Permission may still be pending; never start recording afterwards.
      if (recorder?.state === 'recording') recorder.stop();
      release();
    }
    function fail(error) {
      if (finished || cancelled) return;
      finished = true; cancelled = true;
      if (recorder?.state === 'recording') recorder.stop();
      release(); onError(error);
    }
    function detectSilence() {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) return;
      try {
        context = new AudioContext();
        context.resume().catch(() => {});
        const analyser = context.createAnalyser(); analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let heardSpeech = false, lastSpeech = Date.now();
        monitor = setInterval(() => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          if (Math.sqrt(sum / samples.length) > 0.018) { heardSpeech = true; lastSpeech = Date.now(); }
          if (heardSpeech && Date.now() - lastSpeech > 2500) stop(true);
        }, 100);
      } catch (_) { /* Manual stop and the 45-second limit still work. */ }
    }
    return {
      async start() {
        try {
          stream = await root.navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, channelCount: 1}});
          if (cancelled) { release(); return; }
          const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus']
            .find(type => root.MediaRecorder.isTypeSupported?.(type));
          recorder = new root.MediaRecorder(stream, {audioBitsPerSecond: 32000, ...(mimeType ? {mimeType} : {})});
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          recorder.onerror = event => fail(event.error || new Error('Не удалось записать звук.'));
          recorder.onstop = () => {
            if (finished) return;
            finished = true; release();
            if (cancelled || !send) return;
            const blob = new Blob(chunks, {type: recorder.mimeType || chunks[0]?.type || 'audio/webm'});
            chunks.length = 0;
            if (blob.size < 100 || Date.now() - startedAt < 300) return onError(new Error('Запись слишком короткая. Нажмите микрофон и произнесите фразу.'));
            if (blob.size > 4200000) return onError(new Error('Запись слишком большая. Произнесите команду короче.'));
            onAudio(blob);
          };
          recorder.start(250); startedAt = Date.now();
          deadline = setTimeout(() => stop(true), 45000);
          detectSilence();
        } catch (error) { fail(error); }
      },
      stop,
      cancel() { stop(false); }
    };
  }
  const api = {supported, create};
  root.TradeVoiceRecorder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
