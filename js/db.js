/**
 * TradeLog IndexedDB Storage Layer
 * Supports high-volume trades and full-resolution screenshot storage offline.
 */

const DB_NAME = 'TradeLogDB';
const DB_VERSION = 1;
const STORE_NAME = 'trades';

let dbInstance = null;

function getDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      return resolve(dbInstance);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('month', 'month', { unique: false });
        store.createIndex('setup', 'setup', { unique: false });
        store.createIndex('timeframe', 'timeframe', { unique: false });
        store.createIndex('outcome', 'outcome', { unique: false });
        store.createIndex('direction', 'direction', { unique: false });
        store.createIndex('entryTime', 'entryTime', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Add a new trade
 */
async function addTrade(trade) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Auto-calculate month for indexing/filtering
    if (trade.entryTime) {
      trade.month = trade.entryTime.substring(0, 7); // e.g. "2026-10"
    } else {
      trade.month = new Date().toISOString().substring(0, 7);
    }
    trade.createdAt = trade.createdAt || new Date().toISOString();
    trade.updatedAt = new Date().toISOString();

    const request = store.add(trade);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Update existing trade
 */
async function updateTrade(trade) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    if (trade.entryTime) {
      trade.month = trade.entryTime.substring(0, 7);
    }
    trade.updatedAt = new Date().toISOString();

    const request = store.put(trade);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Delete a trade by ID
 */
async function deleteTrade(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(Number(id));
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get single trade by ID
 */
async function getTrade(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(Number(id));
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Get all trades
 */
async function getAllTrades() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      // Return sorted by entryTime descending (newest first)
      const list = request.result || [];
      list.sort((a, b) => {
        const timeA = new Date(a.entryTime || a.createdAt).getTime();
        const timeB = new Date(b.entryTime || b.createdAt).getTime();
        return timeB - timeA;
      });
      resolve(list);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Clear all trades (factory reset)
 */
async function clearAllTrades() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Export all trades to JSON string (Backup)
 */
async function exportToJSON() {
  const trades = await getAllTrades();
  const data = {
    appName: 'TradeLog PWA',
    version: '1.0',
    exportDate: new Date().toISOString(),
    totalTrades: trades.length,
    trades: trades
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Import trades from JSON string (Restore)
 */
async function importFromJSON(jsonString) {
  const parsed = JSON.parse(jsonString);
  const trades = Array.isArray(parsed) ? parsed : (parsed.trades || []);
  if (!trades.length) {
    throw new Error('Файл не содержит записей о сделках');
  }

  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    let count = 0;
    for (const trade of trades) {
      delete trade.id; // Allow new ID generation to avoid collision
      if (trade.entryTime) {
        trade.month = trade.entryTime.substring(0, 7);
      }
      store.add(trade);
      count++;
    }

    transaction.oncomplete = () => resolve(count);
    transaction.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Client-side image optimization (compresses high-res chart screenshots)
 * Converts to WebP / JPEG with max dimensions to preserve chart readability while keeping DB fast
 */
function compressImage(file, maxWidth = 1920, maxHeight = 1080, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Try webp, fallback to jpeg
        let dataUrl;
        try {
          dataUrl = canvas.toDataURL('image/webp', quality);
          if (dataUrl.indexOf('image/webp') === -1) {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
        } catch {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve({
          name: file.name,
          dataUrl: dataUrl,
          width: width,
          height: height,
          sizeKb: Math.round(dataUrl.length * 3 / 4 / 1024)
        });
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// Demo data generator (for first-time users so app is immediately visual)
async function loadDemoTradesIfEmpty() {
  const existing = await getAllTrades();
  if (existing && existing.length > 0) return false;

  const now = new Date();
  const formatIso = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const demoTrades = [
    {
      symbol: 'BTC/USDT',
      direction: 'LONG',
      timeframe: '15m',
      setup: 'Liquidity Sweep',
      entryTime: formatIso(new Date(now.getTime() - 2 * 3600 * 1000)),
      exitTime: formatIso(new Date(now.getTime() - 40 * 60 * 1000)),
      entryPrice: '67420',
      exitPrice: '68950',
      outcome: 'WIN',
      pnl: '+3.4R',
      rMultiple: 3.4,
      notes: 'Снятие ликвидности азиатской сессии (Asian Low) на 15m. Слом структуры (CHoCH) на 1m, вход от FVG с коротким стопом за свинг. Тейк-профит на снятии ликвидности с верхней границы диапазона. Все правила соблюдены.',
      images: []
    },
    {
      symbol: 'ETH/USDT',
      direction: 'SHORT',
      timeframe: '1h',
      setup: 'Order Block (OB)',
      entryTime: formatIso(new Date(now.getTime() - 28 * 3600 * 1000)),
      exitTime: formatIso(new Date(now.getTime() - 22 * 3600 * 1000)),
      entryPrice: '2640',
      exitPrice: '2580',
      outcome: 'WIN',
      pnl: '+2.5R',
      rMultiple: 2.5,
      notes: 'Тест 1h Bearish Order Block после снятия равных максимумов (Equal Highs). Фиксация на пуле ликвидности снизу.',
      images: []
    },
    {
      symbol: 'XAU/USD',
      direction: 'LONG',
      timeframe: '5m',
      setup: 'Breakout / Пробой',
      entryTime: formatIso(new Date(now.getTime() - 48 * 3600 * 1000)),
      exitTime: formatIso(new Date(now.getTime() - 46 * 3600 * 1000)),
      entryPrice: '2685.5',
      exitPrice: '2681.0',
      outcome: 'LOSS',
      pnl: '-1.0R',
      rMultiple: -1.0,
      notes: 'Попытка зайти в лонг на пробое утреннего хая на золоте. Пробой оказался ложным, выбило по системному стопу. Ошибка: вход прямо перед выходом новостей CPI.',
      images: []
    },
    {
      symbol: 'SOL/USDT',
      direction: 'LONG',
      timeframe: '15m',
      setup: 'FVG / Imbalance',
      entryTime: formatIso(new Date(now.getTime() - 72 * 3600 * 1000)),
      exitTime: formatIso(new Date(now.getTime() - 65 * 3600 * 1000)),
      entryPrice: '152.4',
      exitPrice: '157.8',
      outcome: 'WIN',
      pnl: '+4.1R',
      rMultiple: 4.1,
      notes: 'Идеальное заполнение 15m бычьего имбаланса (FVG) на открытии Нью-Йоркской сессии. Реакция импульсная.',
      images: []
    }
  ];

  for (const t of demoTrades) {
    await addTrade(t);
  }
  return true;
}
