const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const workers = [];
  class Worker {
    constructor(url) { this.url = url.href; this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({data}); }
  }
  const context = {URL, Blob, DOMException, Worker, setTimeout: () => 1, clearTimeout() {},
    document: {currentScript: {src: 'https://trades.test/TRADES/js/piper-engine.js'}}};
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/piper-engine.js'), 'utf8'), context);
  return {api: context.DmitryPiper, workers};
}
test('Piper is lazy, returns a WAV and removes abort listeners after completion', async () => {
  const f = fixture(), controller = new AbortController(), progress = [];
  assert.equal(f.workers.length, 0);
  const pending = f.api.synthesize('Привет', {signal: controller.signal, onProgress: text => progress.push(text)});
  const worker = f.workers[0], id = worker.messages[0].id;
  assert.equal(worker.url, 'https://trades.test/TRADES/js/piper-worker.js?v=35');
  worker.reply({id, type: 'progress', text: 'Загрузка Дмитрия: 50%'});
  worker.reply({id, type: 'audio', audio: new Uint8Array([1, 2, 3]).buffer});
  assert.equal((await pending).type, 'audio/wav');
  assert.deepEqual(progress, ['Загрузка Дмитрия: 50%']);
  controller.abort(); assert.equal(worker.terminated, undefined);
});
test('cancellation terminates synthesis; late audio cannot finish the next request', async () => {
  const f = fixture(), controller = new AbortController();
  const pending = f.api.synthesize('Первый', {signal: controller.signal});
  const old = f.workers[0], oldId = old.messages[0].id;
  controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(old.terminated, true);
  const next = f.api.synthesize('Второй');
  const current = f.workers[1], id = current.messages[0].id;
  old.reply({id: oldId, type: 'audio', audio: new ArrayBuffer(1)});
  current.reply({id, type: 'audio', audio: new ArrayBuffer(3)});
  assert.equal((await next).size, 3);
});
test('worker initialization failure is visible and a subsequent request can retry', async () => {
  const f = fixture(), pending = f.api.synthesize('Привет');
  f.workers[0].onerror(); await assert.rejects(pending, /Не удалось запустить голос/);
  const next = f.api.synthesize('Привет');
  const worker = f.workers[1], id = worker.messages[0].id;
  worker.reply({id, type: 'audio', audio: new ArrayBuffer(2)});
  assert.equal((await next).size, 2);
});
test('streamed audio is delivered before completion without buffering the entire answer', async () => {
  const f = fixture(), chunks = [];
  let done = false;
  const pending = f.api.synthesize('Длинный ответ', {onChunk: data => chunks.push(data.byteLength)}).then(value => {done = true; return value;});
  const worker = f.workers[0], id = worker.messages[0].id;
  assert.equal(worker.messages[0].stream, true);
  worker.reply({id, type: 'chunk', audio: new ArrayBuffer(5)});
  assert.deepEqual(chunks, [5]); assert.equal(done, false);
  worker.reply({id, type: 'chunk', audio: new ArrayBuffer(7)});
  worker.reply({id, type: 'done'});
  assert.equal(await pending, null); assert.deepEqual(chunks, [5, 7]);
});
