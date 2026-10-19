const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(getUserMedia) {
  let now = 1000, stops = 0, captures = 0;
  const audio = [], errors = [];
  const stream = {getTracks: () => [{stop: () => { stops++; }}]};
  class Recorder {
    static isTypeSupported(type) { return type.includes('webm'); }
    constructor() { captures++; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable({data: new Blob([Buffer.alloc(150)])}); this.onstop(); });
    }
  }
  class Clock extends Date { static now() { return now; } }
  const context = {navigator: {mediaDevices: {getUserMedia: getUserMedia || (async () => stream)}},
    MediaRecorder: Recorder, Date: Clock, Blob, Uint8Array, setTimeout, clearTimeout, setInterval, clearInterval, module: {exports: {}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/voice-recorder.js'), 'utf8'), context);
  const recorder = context.module.exports.create({onAudio: blob => audio.push(blob), onError: error => errors.push(error)});
  return {recorder, audio, errors, stream, advance: () => { now += 1000; }, get stops() { return stops; }, get captures() { return captures; }};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('recording sends audio exactly once and releases the microphone', async () => {
  const f = fixture(); await f.recorder.start(); f.advance();
  f.recorder.stop(true); f.recorder.stop(true); await flush();
  assert.equal(f.audio.length, 1); assert.equal(f.audio[0].type, 'audio/webm'); assert.ok(f.stops > 0);
  assert.equal(f.errors.length, 0);
});
test('cancellation does not send audio', async () => {
  const f = fixture(); await f.recorder.start(); f.advance(); f.recorder.cancel(); await flush();
  assert.equal(f.audio.length, 0); assert.ok(f.stops > 0);
});
test('stopping while permission is pending cannot start a late recording', async () => {
  let allow;
  const f = fixture(() => new Promise(resolve => { allow = resolve; }));
  const pending = f.recorder.start(); f.recorder.stop(true); allow(f.stream); await pending;
  assert.equal(f.captures, 0); assert.equal(f.audio.length, 0); assert.ok(f.stops > 0);
});
test('microphone permission rejection is surfaced without starting a recording', async () => {
  const f = fixture(async () => { throw Object.assign(new Error('denied'), {name: 'NotAllowedError'}); });
  await f.recorder.start(); assert.equal(f.errors[0].name, 'NotAllowedError'); assert.equal(f.captures, 0);
});
