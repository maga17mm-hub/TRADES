const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('../js/trade-parser.js');

const cases = [
  ['Запиши сделку: лонг BTC/USDT на 15m, сетап FVG, вход 68500, выход 70000, профит +2.5R', 'BTC/USDT', 'LONG', 2.5, '15m', '68500'],
  ['Добавь сделку по биткоину, шорт, пятнадцать минут, вход шестьдесят восемь тысяч пятьсот, стоп минус один эр', 'BTC/USDT', 'SHORT', -1, '15m', '68500'],
  ['Запиши сделку по эфиру, лонг на четыре часа, прибыль два с половиной эр', 'ETH/USDT', 'LONG', 2.5, '4h', ''],
  ['Запиши сделку EURUSD шорт, один час, безубыток', 'EUR/USD', 'SHORT', 0, '1h', ''],
  ['Добавь сделку по SOL, лонг, вход 68 500, профит 2,5R', 'SOL/USDT', 'LONG', 2.5, '15m', '68500']
];
for (const [text, symbol, direction, r, tf, entry] of cases) {
  const result = parser.parse(text);
  assert.equal(result.intent, true, text);
  assert.deepEqual(result.missing, [], text);
  assert.equal(result.trade.symbol, symbol, text);
  assert.equal(result.trade.direction, direction, text);
  assert.equal(result.trade.rMultiple, r, text);
  assert.equal(result.trade.timeframe, tf, text);
  assert.equal(result.trade.entryPrice, entry, text);
}
for (const text of ['Как записать сделку?', 'Не записывай сделку BTC лонг 2R', 'Расскажи про FVG', 'Проанализируй сделки'])
  assert.equal(parser.isIntent(text), false, text);
assert.equal(parser.parse('Запиши сделку').missing.length, 3);

const values = new Map([['tradelog_ai_voice_enabled', 'false']]);
const storage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
const input = {value: '', placeholder: ''};
let saved = [], fetches = 0;
class Recognition {
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}
const context = {console, setTimeout, clearTimeout, AbortController, URL, Date, btoa: text => Buffer.from(text, 'binary').toString('base64'),
  localStorage: storage, sessionStorage: storage, TradeVoiceParser: parser,
  document: {addEventListener() {}, querySelectorAll: () => [], getElementById: id => id === 'aiChatInput' ? input : null,
    body: {classList: {remove() {}}, style: {}}, documentElement: {classList: {remove() {}}}},
  SpeechRecognition: Recognition, showToast() {}, allTrades: [],
  addTrade: async trade => { saved.push(trade); return saved.length; }, refreshTrades: async () => {},
  fetch: async () => { fetches++; throw new Error('offline'); }};
context.window = context;
context.tradeLogApiFetch = context.fetch;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../js/ai.js'), 'utf8'), context);
async function submit(text) { input.value = text; await context.handleAiSubmit(); }
async function main() {
  await submit(cases[0][0]);
  assert.equal(saved.length, 1);
  assert.equal(fetches, 0, 'Local dictation must not depend on GPT');
  await submit('Запиши сделку по эфиру');
  assert.equal(saved.length, 1, 'Incomplete command must not invent data');
  await submit('Лонг, профит три эр');
  assert.equal(saved.length, 2);
  assert.equal(saved[1].symbol, 'ETH/USDT');
  assert.equal(saved[1].rMultiple, 3);
  await submit('Что такое FVG?');
  assert.equal(saved.length, 2, 'Education must never create trades');
  assert.equal(fetches, 1);
  input.value = '';
  context.startListening();
  const recognition = vm.runInContext('speechRecognizer', context);
  const finalResult = {0: {transcript: cases[0][0]}, isFinal: true};
  recognition.onresult({results: [finalResult]});
  recognition.onend();
  recognition.onend();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.length, 3, 'Repeated onend must save once');
  input.value = '';
  context.startListening();
  const cancelled = vm.runInContext('speechRecognizer', context);
  cancelled.onresult({results: [finalResult]});
  context.stopListening(false);
  cancelled.onend();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.length, 3, 'Closing must cancel delayed dictation');
  let capture;
  context.TradeVoiceRecorder = {supported: () => true, create: callbacks => {
    capture = callbacks; return {start() {}, stop() {}};
  }};
  const blob = new Blob([Buffer.alloc(150)]);
  context.tradeLogApiFetch = async (path, options) => {
    assert.equal(path, '/api/transcribe');
    assert.ok(JSON.parse(options.body).audio.length >= 100);
    return Response.json({text: cases[0][0]});
  };
  input.value = '';
  context.startListening();
  await capture.onAudio(blob);
  assert.equal(saved.length, 4, 'Server transcription must create a real trade');
  let reply;
  context.tradeLogApiFetch = async () => new Promise(resolve => { reply = resolve; });
  input.value = '';
  context.startListening();
  const pending = capture.onAudio(blob);
  await new Promise(resolve => setImmediate(resolve));
  context.stopListening(false);
  reply(Response.json({text: cases[0][0]}));
  await pending;
  assert.equal(saved.length, 4, 'Closing while transcription is pending must not submit a late trade');
  let synthesized = 0, played = 0;
  const starts = [];
  context.DmitryPiper = {synthesize: async (_, options) => {
    synthesized++; options.onChunk(new ArrayBuffer(44)); options.onChunk(new ArrayBuffer(44)); return null;
  }};
  context.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; }
    async resume() {}
    async decodeAudioData() { return {duration: 1}; }
    createBufferSource() { return {connect() {}, disconnect() {}, start(time) { played++; starts.push(time); }, stop() {}}; }
  };
  const oldFetches = fetches;
  await context.speakWithDmitry('Проверка голоса', null, true);
  assert.equal(synthesized, 1, 'Manual speech must work even when automatic voice is off');
  assert.equal(played, 2); assert.ok(starts[1] >= starts[0] + 1, 'Speech chunks must play in order without overlap');
  assert.equal(fetches, oldFetches, 'Default Piper must not call Microsoft speech API');
  context.stopSpeaking();
  console.log('PASS: parser, intent guards, real save, native STT, server STT and cancellation during transcription');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
