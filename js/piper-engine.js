/* Cancelable, lazy neural voice worker. No model is downloaded until speech is requested. */
(function () {
  const workerUrl = new URL('./piper-worker.js?v=35', document.currentScript.src);
  let worker = null, serial = 0, idleTimer;
  const pending = new Map();
  function reset() {
    clearTimeout(idleTimer);
    worker?.terminate(); worker = null;
    for (const job of pending.values()) { job.clean(); job.reject(new DOMException('Озвучка отменена', 'AbortError')); }
    pending.clear();
  }
  function getWorker() {
    if (worker) return worker;
    worker = new Worker(workerUrl);
    worker.onmessage = ({data}) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.type === 'progress') return job.onProgress?.(data.text);
      if (data.type === 'chunk') return job.onChunk?.(data.audio);
      pending.delete(data.id); job.clean();
      if (data.type === 'audio') job.resolve(new Blob([data.audio], {type: 'audio/wav'}));
      else if (data.type === 'done') job.resolve(null);
      else { job.reject(new Error(data.message)); if (!pending.size) return reset(); }
      if (!pending.size) idleTimer = setTimeout(reset, 120000);
    };
    worker.onerror = () => {
      for (const job of pending.values()) { job.clean(); job.reject(new Error('Не удалось запустить голос. Обновите браузер и повторите попытку.')); }
      pending.clear(); reset();
    };
    return worker;
  }
  window.DmitryPiper = {
    synthesize(text, {signal, onProgress, onChunk} = {}) {
      if (signal?.aborted) return Promise.reject(new DOMException('Озвучка отменена', 'AbortError'));
      clearTimeout(idleTimer);
      return new Promise((resolve, reject) => {
        const id = ++serial, abort = () => reset();
        signal?.addEventListener('abort', abort, {once: true});
        pending.set(id, {resolve, reject, onProgress, onChunk, clean: () => signal?.removeEventListener('abort', abort)});
        try { getWorker().postMessage({id, text, stream: !!onChunk}); } catch (error) { pending.delete(id); signal?.removeEventListener('abort', abort); reject(error); }
      });
    }
  };
})();
