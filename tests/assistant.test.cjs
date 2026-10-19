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
const context = {console, setTimeout, clearTimeout, AbortController, URL, Date,
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
  console.log('PASS: 5 parser scenarios, 4 intent guards, offline save, follow-up, STT once and cancellation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
