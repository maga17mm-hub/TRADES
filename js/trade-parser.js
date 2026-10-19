/* Deterministic, free trade dictation. No guessed asset, direction or profit. */
(function (root) {
  'use strict';
  const numbers = {
    ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4,
    пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
    одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14,
    пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18,
    девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50,
    шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
    сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
    шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900
  };
  function normalizeNumbers(text) {
    const tokens = text.toLowerCase().replace(/ё/g, 'е').split(/(\s+|[,;:])/);
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!(tokens[i] in numbers)) { out.push(tokens[i]); continue; }
      let subtotal = 0, total = 0, j = i;
      while (j < tokens.length) {
        const token = tokens[j];
        if (token in numbers) subtotal += numbers[token];
        else if (/^тысяч[аиу]?$/.test(token)) { total += (subtotal || 1) * 1000; subtotal = 0; }
        else if (!/^\s+$/.test(token)) break;
        j++;
      }
      out.push(String(total + subtotal));
      // Preserve spacing between converted number and following unit.
      if (j > i && /^\s+$/.test(tokens[j - 1])) out.push(' ');
      i = j - 1;
    }
    return out.join('')
      .replace(/(\d+)\s+с\s+половиной/g, '$1.5')
      .replace(/(\d+)\s+(?:точка|запятая)\s+(\d+)/g, '$1.$2')
      .replace(/(\d)\s+(?=\d{3}(?:\D|$))/g, '$1');
  }
  function isIntent(text) {
    const t = text.toLowerCase();
    if (/(?:не\s+(?:добавляй|записывай|создавай|запиши|добавь)|(?:как|можно ли)\s+(?:мне\s+)?(?:добавить|записать|создать))/.test(t)) return false;
    return /(?:запиши|записать|добавь|добавить|создай|зафиксируй|сохрани|занеси).{0,35}(?:сделк|трейд)/.test(t)
      || /(?:купил[аи]?|продал[аи]?|заш[её]л|зашла|вош[её]л|вошла)\s/.test(t);
  }
  function parse(text) {
    const t = normalizeNumbers(text);
    let symbol = '';
    const pair = t.match(/(?:^|[^a-z])([a-z]{2,10})\s*\/\s*([a-z]{2,6})(?![a-z])/i);
    if (pair) symbol = pair[1].toUpperCase() + '/' + pair[2].toUpperCase();
    if (!symbol) {
      const aliases = [
        [/(?:битко[йи]н|\bbtc\b)/, 'BTC/USDT'], [/(?:эфир|этериум|\beth\b)/, 'ETH/USDT'],
        [/(?:солан|\bsol\b)/, 'SOL/USDT'], [/(?:золот|\bxau\s*usd\b)/, 'XAU/USD'],
        [/(?:евро.{0,8}доллар|\beur\s*usd\b)/, 'EUR/USD'], [/(?:\bgbp\s*usd\b|фунт.{0,8}доллар)/, 'GBP/USD']
      ];
      for (const [pattern, value] of aliases) if (pattern.test(t)) { symbol = value; break; }
    }
    if (!symbol) {
      const custom = t.match(/(?:тикер|инструмент|по)\s+([a-z]{2,10})(?![a-z])/i);
      if (custom) {
        const value = custom[1].toUpperCase();
        symbol = value.endsWith('USDT') ? value.slice(0, -4) + '/USDT' : value + '/USDT';
      }
    }
    const short = /(?:шорт|\bshort\b|продал)/.test(t);
    const long = /(?:лонг|\blong\b|купил|покупк)/.test(t);
    const direction = short !== long ? (short ? 'SHORT' : 'LONG') : '';
    const timeframeMatch = t.match(/(?:таймфрейм\s*)?(\d+)\s*(минут[а-я]*|час[а-я]*|дн[а-я]*|день|недел[а-я]*|[mhdw])(?![a-zа-я])/i);
    let timeframe = '15m';
    if (timeframeMatch) {
      const unit = timeframeMatch[2];
      timeframe = timeframeMatch[1] + (/^(?:мин|m)/.test(unit) ? 'm' : /^(?:час|h)/.test(unit) ? 'h' : /^(?:нед|w)/.test(unit) ? 'W' : 'D');
    }
    const rMatch = t.match(/(?:минус\s*|(-)\s*)?(\d+(?:[.,]\d+)?)\s*(?:r|эр|р)(?![a-zа-я])/i);
    let rMultiple = rMatch ? Number(rMatch[2].replace(',', '.')) * (/минус|-/.test(rMatch[0]) ? -1 : 1) : null;
    const be = /(?:безубыт|без убыт|\bbe\b)/.test(t);
    const loss = /(?:убыт|стоп|\bloss\b)/.test(t) && !be;
    const win = /(?:профит|прибыл|тейк|\bwin\b)/.test(t);
    if (loss && rMultiple !== null) rMultiple = -Math.abs(rMultiple);
    if (be) rMultiple = 0;
    const outcome = be ? 'BE' : loss ? 'LOSS' : win ? 'WIN' : rMultiple !== null ? (rMultiple > 0 ? 'WIN' : rMultiple < 0 ? 'LOSS' : 'BE') : '';
    const setupMatch = t.match(/сетап\s+(.+?)(?=\s*[,;]|\s+(?:вход|выход|результат|профит|прибыль|тейк|стоп|заметк)|$)/);
    let setup = setupMatch ? setupMatch[1].trim() : '';
    if (!setup) {
      for (const [pattern, label] of [[/fvg|имбаланс|фвг/, 'FVG / Imbalance'], [/order block|ордер.?блок/, 'Order Block'], [/пробой|breakout/, 'Breakout / Пробой'], [/sweep|свип|снятие ликвидности/, 'Liquidity Sweep'], [/choch|слом/, 'CHoCH / Слом']]) {
        if (pattern.test(t)) { setup = label; break; }
      }
    }
    const price = word => {
      const match = t.match(new RegExp(word + '(?:а|у)?\\s*(?:по|цена|цене)?\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)'));
      return match ? match[1].replace(',', '.') : '';
    };
    const missing = [];
    if (!symbol) missing.push('инструмент');
    if (!direction) missing.push('направление: лонг или шорт');
    if (!outcome || rMultiple === null) missing.push('результат в R, например «профит два с половиной эр»');
    const trade = {symbol, direction, timeframe, setup: setup || 'Без сетапа', outcome,
      rMultiple, entryPrice: price('вход'), exitPrice: price('выход'), notes: text,
      pnl: rMultiple === null ? '' : `${rMultiple > 0 ? '+' : ''}${rMultiple}R`};
    return {intent: isIntent(text), trade, missing};
  }
  const api = {parse, isIntent, normalizeNumbers};
  root.TradeVoiceParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
