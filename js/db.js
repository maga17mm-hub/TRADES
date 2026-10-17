/**
 * TradeLog IndexedDB Storage Layer
 * Supports high-volume trades, full-resolution screenshot storage offline,
 * and automatic persistent LocalStorage mirroring.
 */

const DB_NAME = 'TradeLogDB';
const DB_VERSION = 2;
const STORE_NAME = 'trades';
const THOUGHTS_STORE = 'journal_thoughts';
const LS_BACKUP_KEY = 'tradelog_trades_store';
const LS_DELETED_TRADES_KEY = 'tradelog_deleted_trade_sigs';
const LS_DELETED_THOUGHTS_KEY = 'tradelog_deleted_thought_sigs';

function getTradeSig(t) {
  if (!t) return '';
  if (t.uuid) return 'uuid:' + t.uuid;
  return `${(t.symbol || '').toUpperCase()}|${t.entryTime || ''}|${t.direction || ''}|${t.entryPrice || ''}`;
}

function getThoughtSig(t) {
  if (!t) return '';
  if (t.uuid) return 'uuid:' + t.uuid;
  const dateKey = (t.createdAt || '').substring(0, 19);
  const titleKey = (t.title || '').trim();
  const textSnippet = (t.text || '').substring(0, 30);
  return `${dateKey}|${titleKey}|${textSnippet}`;
}

function getDeletedTradeSigs() {
  try {
    const raw = localStorage.getItem(LS_DELETED_TRADES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function recordDeletedTradeTombstone(trade) {
  if (!trade) return;
  const sigs = new Set(getDeletedTradeSigs());
  if (trade.uuid) sigs.add(trade.uuid);
  const sig = getTradeSig(trade);
  if (sig) sigs.add(sig);
  if (trade.id !== undefined && trade.id !== null) sigs.add(String(trade.id));
  try {
    localStorage.setItem(LS_DELETED_TRADES_KEY, JSON.stringify(Array.from(sigs).slice(-500)));
  } catch (_) {}
}

function isTradeDeletedLocally(trade) {
  if (!trade) return false;
  const sigs = new Set(getDeletedTradeSigs());
  if (trade.uuid && sigs.has(trade.uuid)) return true;
  if (trade.id !== undefined && trade.id !== null && sigs.has(String(trade.id))) return true;
  const sig = getTradeSig(trade);
  if (sig && sigs.has(sig)) return true;
  return false;
}

function getDeletedThoughtSigs() {
  try {
    const raw = localStorage.getItem(LS_DELETED_THOUGHTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function recordDeletedThoughtTombstone(thought) {
  if (!thought) return;
  const sigs = new Set(getDeletedThoughtSigs());
  if (thought.uuid) sigs.add(thought.uuid);
  const sig = getThoughtSig(thought);
  if (sig) sigs.add(sig);
  if (thought.id !== undefined && thought.id !== null) sigs.add(String(thought.id));
  try {
    localStorage.setItem(LS_DELETED_THOUGHTS_KEY, JSON.stringify(Array.from(sigs).slice(-500)));
  } catch (_) {}
}

function isThoughtDeletedLocally(thought) {
  if (!thought) return false;
  const sigs = new Set(getDeletedThoughtSigs());
  if (thought.uuid && sigs.has(thought.uuid)) return true;
  if (thought.id !== undefined && thought.id !== null && sigs.has(String(thought.id))) return true;
  const sig = getThoughtSig(thought);
  if (sig && sigs.has(sig)) return true;
  return false;
}

async function deleteTradeFromStoreOnly(id) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const numId = Number(id);
    if (!isNaN(numId)) store.delete(numId);
    store.delete(String(id));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function deleteThoughtFromStoreOnly(id) {
  const db = await getDB();
  return new Promise((resolve) => {
    const tx = db.transaction([THOUGHTS_STORE], 'readwrite');
    const store = tx.objectStore(THOUGHTS_STORE);
    const numId = Number(id);
    if (!isNaN(numId)) store.delete(numId);
    store.delete(String(id));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

window.getDeletedTradeSigs = getDeletedTradeSigs;
window.getDeletedThoughtSigs = getDeletedThoughtSigs;
window.isTradeDeletedLocally = isTradeDeletedLocally;
window.isThoughtDeletedLocally = isThoughtDeletedLocally;

let dbInstance = null;

// Request persistent storage so browser/OS never clears data
if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

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

      if (!db.objectStoreNames.contains(THOUGHTS_STORE)) {
        const thoughtStore = db.createObjectStore(THOUGHTS_STORE, { keyPath: 'id', autoIncrement: true });
        thoughtStore.createIndex('createdAt', 'createdAt', { unique: false });
        thoughtStore.createIndex('tag', 'tag', { unique: false });
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
 * Mirror trades to LocalStorage for bulletproof persistence
 */
function syncTradesToLocalStorage(trades) {
  try {
    localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(trades));
  } catch (e) {
    try {
      // In case quota exceeded due to large images, back up trades without base64 images
      const lightweight = trades.map(t => ({ ...t, images: [] }));
      localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(lightweight));
    } catch (err) {
      console.warn('LocalStorage backup quota reached:', err);
    }
  }
}

function getTradesFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_BACKUP_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function getAllTradesRaw() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      let items = request.result || [];
      items = items.filter(t => !isTradeDeletedLocally(t));
      resolve(items);
    };
    request.onerror = (e) => reject(e.target.error);
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
    trade.uuid = trade.uuid || ('tr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8));

    const request = store.add(trade);
    request.onsuccess = async () => {
      const newId = request.result;
      try {
        const all = await getAllTradesRaw();
        syncTradesToLocalStorage(all);
      } catch (err) {
        console.warn('Sync to localStorage failed:', err);
      }
      resolve(newId);
    };
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
    request.onsuccess = async () => {
      try {
        const all = await getAllTradesRaw();
        syncTradesToLocalStorage(all);
      } catch (err) {
        console.warn('Sync to localStorage failed:', err);
      }
      resolve(request.result);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Delete a trade by ID
 */
async function deleteTrade(id) {
  const db = await getDB();
  try {
    const trade = await getTrade(id);
    if (trade) {
      recordDeletedTradeTombstone(trade);
    } else {
      recordDeletedTradeTombstone({ id: id });
    }
  } catch (_) {}

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const numId = Number(id);
    if (!isNaN(numId)) {
      store.delete(numId);
    }
    store.delete(String(id));
    transaction.oncomplete = async () => {
      try {
        const all = await getAllTradesRaw();
        syncTradesToLocalStorage(all);
      } catch (err) {
        console.warn('Sync to localStorage failed:', err);
      }
      resolve(true);
    };
    transaction.onerror = (e) => reject(e.target.error);
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
    const numId = Number(id);
    const request = !isNaN(numId) ? store.get(numId) : store.get(String(id));
    request.onsuccess = () => {
      if (request.result) return resolve(request.result);
      const req2 = store.get(String(id));
      req2.onsuccess = () => resolve(req2.result);
      req2.onerror = () => resolve(null);
    };
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
    request.onsuccess = async () => {
      let list = request.result || [];

      // Filter out any trade that is marked as deleted
      list = list.filter(t => !isTradeDeletedLocally(t));

      // One-time cleanup: If existing trades are ONLY the original hardcoded demo trades, clear them so app is clean empty
      if (localStorage.getItem('tradelog_demo_cleaned_v2') !== 'true') {
        localStorage.setItem('tradelog_demo_cleaned_v2', 'true');
        const isOnlyDemo = list.length > 0 && list.every(t => 
          (t.notes && t.notes.includes('Asian Low')) ||
          (t.symbol === 'ETH/USDT' && t.notes && t.notes.includes('Order Block')) ||
          (t.symbol === 'XAU/USD' && t.notes && t.notes.includes('CPI')) ||
          (t.symbol === 'SOL/USDT' && t.notes && t.notes.includes('FVG'))
        );
        if (isOnlyDemo) {
          await clearAllTrades();
          list = [];
        }
      }

      // Restore from localStorage ONLY if IndexedDB is empty AND backup trades weren't deleted
      if (list.length === 0) {
        let backup = getTradesFromLocalStorage() || [];
        backup = backup.filter(t => !isTradeDeletedLocally(t));
        if (backup && backup.length > 0) {
          console.log('Restoring trades from LocalStorage mirror...');
          try {
            for (const t of backup) {
              const item = { ...t };
              delete item.id;
              await new Promise((res, rej) => {
                const tx = db.transaction([STORE_NAME], 'readwrite');
                const s = tx.objectStore(STORE_NAME);
                const req = s.add(item);
                req.onsuccess = () => res(req.result);
                req.onerror = (e) => rej(e.target.error);
              });
            }
            list = await getAllTradesRaw();
          } catch (e) {
            console.warn('Restoration error:', e);
            list = backup;
          }
        }
      } else {
        syncTradesToLocalStorage(list);
      }

      // Return sorted by entryTime descending (newest first)
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
    request.onsuccess = () => {
      try {
        localStorage.removeItem(LS_BACKUP_KEY);
      } catch (e) {}
      resolve(true);
    };
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
    version: '2.0',
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

    transaction.oncomplete = async () => {
      try {
        const all = await getAllTradesRaw();
        syncTradesToLocalStorage(all);
      } catch (err) {}
      resolve(count);
    };
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

/**
 * No demo trades: App starts completely empty for user data
 */
async function loadDemoTradesIfEmpty() {
  return false;
}

/**
 * ============================================================================
 * JOURNAL THOUGHTS & VOICE RECORDINGS STORAGE
 * ============================================================================
 */
async function addJournalThought(thought) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([THOUGHTS_STORE], 'readwrite');
    const store = tx.objectStore(THOUGHTS_STORE);

    thought.createdAt = thought.createdAt || new Date().toISOString();
    thought.updatedAt = new Date().toISOString();
    thought.uuid = thought.uuid || ('th_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8));

    const request = store.add(thought);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getAllJournalThoughts() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([THOUGHTS_STORE], 'readonly');
    const store = tx.objectStore(THOUGHTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      let items = request.result || [];
      items = items.filter(t => !isThoughtDeletedLocally(t));
      // Sort newest first
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(items);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function deleteJournalThought(id) {
  const db = await getDB();
  try {
    const thought = await getJournalThought(id);
    if (thought) {
      recordDeletedThoughtTombstone(thought);
    } else {
      recordDeletedThoughtTombstone({ id: id });
    }
  } catch (_) {}

  return new Promise((resolve, reject) => {
    const tx = db.transaction([THOUGHTS_STORE], 'readwrite');
    const store = tx.objectStore(THOUGHTS_STORE);
    const numId = Number(id);
    if (!isNaN(numId)) {
      store.delete(numId);
    }
    store.delete(String(id));
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function updateJournalThought(thought) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([THOUGHTS_STORE], 'readwrite');
    const store = tx.objectStore(THOUGHTS_STORE);
    thought.updatedAt = new Date().toISOString();
    const request = store.put(thought);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getJournalThought(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([THOUGHTS_STORE], 'readonly');
    const store = tx.objectStore(THOUGHTS_STORE);
    const numId = Number(id);
    const request = !isNaN(numId) ? store.get(numId) : store.get(String(id));
    request.onsuccess = () => {
      if (request.result) return resolve(request.result);
      const req2 = store.get(String(id));
      req2.onsuccess = () => resolve(req2.result);
      req2.onerror = () => resolve(null);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * ============================================================================
 * CLOUD SYNCHRONIZATION DATA MERGE HELPERS
 * ============================================================================
 */

/**
 * Two-way merge of cloud trades into local IndexedDB
 */
async function mergeCloudTrades(cloudTrades, remoteDeletedSigs = []) {
  const localDeletedSigs = new Set(getDeletedTradeSigs());
  (remoteDeletedSigs || []).forEach(sig => {
    if (sig) {
      localDeletedSigs.add(String(sig));
      recordDeletedTradeTombstone({ uuid: String(sig) });
    }
  });

  const localTrades = await getAllTradesRaw();

  // Purge any local trades that have been deleted in remote tombstones
  for (const lt of localTrades) {
    const sig = getTradeSig(lt);
    if (localDeletedSigs.has(sig) || (lt.uuid && localDeletedSigs.has(lt.uuid)) || localDeletedSigs.has(String(lt.id))) {
      await deleteTradeFromStoreOnly(lt.id);
    }
  }

  if (!Array.isArray(cloudTrades) || cloudTrades.length === 0) return 0;

  const freshLocalTrades = await getAllTradesRaw();
  const localMap = new Map();
  freshLocalTrades.forEach(lt => {
    localMap.set(getTradeSig(lt), lt);
  });

  let mergedCount = 0;

  for (const ct of cloudTrades) {
    if (!ct || typeof ct !== 'object') continue;
    const sig = getTradeSig(ct);

    // If trade was deleted locally or remotely, do NOT re-add or update it!
    if (localDeletedSigs.has(sig) || (ct.uuid && localDeletedSigs.has(ct.uuid)) || localDeletedSigs.has(String(ct.id)) || isTradeDeletedLocally(ct)) {
      continue;
    }

    const existing = localMap.get(sig);

    if (existing) {
      const cloudTime = ct.updatedAt ? new Date(ct.updatedAt).getTime() : 0;
      const localTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (cloudTime > localTime) {
        const updated = { ...ct, id: existing.id };
        await updateTrade(updated);
        mergedCount++;
      }
    } else {
      const newTrade = { ...ct };
      delete newTrade.id;
      if (!newTrade.uuid) {
        newTrade.uuid = 'tr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
      }
      await addTrade(newTrade);
      mergedCount++;
    }
  }

  return mergedCount;
}
window.mergeCloudTrades = mergeCloudTrades;

/**
 * Two-way merge of cloud journal thoughts into local IndexedDB
 */
async function mergeCloudThoughts(cloudThoughts, remoteDeletedSigs = []) {
  const localDeletedSigs = new Set(getDeletedThoughtSigs());
  (remoteDeletedSigs || []).forEach(sig => {
    if (sig) {
      localDeletedSigs.add(String(sig));
      recordDeletedThoughtTombstone({ uuid: String(sig) });
    }
  });

  const localThoughts = await getAllJournalThoughts();

  // Purge any local thoughts that have been deleted in remote tombstones
  for (const lt of localThoughts) {
    const sig = getThoughtSig(lt);
    if (localDeletedSigs.has(sig) || (lt.uuid && localDeletedSigs.has(lt.uuid)) || localDeletedSigs.has(String(lt.id))) {
      await deleteThoughtFromStoreOnly(lt.id);
    }
  }

  if (!Array.isArray(cloudThoughts) || cloudThoughts.length === 0) return 0;

  const freshLocalThoughts = await getAllJournalThoughts();
  const localMap = new Map();
  freshLocalThoughts.forEach(lt => {
    localMap.set(getThoughtSig(lt), lt);
  });

  let mergedCount = 0;

  for (const ct of cloudThoughts) {
    if (!ct || typeof ct !== 'object') continue;
    const sig = getThoughtSig(ct);

    // If thought was deleted locally or remotely, do NOT re-add or update it!
    if (localDeletedSigs.has(sig) || (ct.uuid && localDeletedSigs.has(ct.uuid)) || localDeletedSigs.has(String(ct.id)) || isThoughtDeletedLocally(ct)) {
      continue;
    }

    const existing = localMap.get(sig);

    if (existing) {
      const cloudTime = ct.updatedAt ? new Date(ct.updatedAt).getTime() : 0;
      const localTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (cloudTime > localTime) {
        const updated = { ...ct, id: existing.id };
        await updateJournalThought(updated);
        mergedCount++;
      }
    } else {
      const newThought = { ...ct };
      delete newThought.id;
      if (!newThought.uuid) {
        newThought.uuid = 'th_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
      }
      await addJournalThought(newThought);
      mergedCount++;
    }
  }

  return mergedCount;
}
window.mergeCloudThoughts = mergeCloudThoughts;



