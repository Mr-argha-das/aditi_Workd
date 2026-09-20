/**
 * INDEX MATRIX — Index Status Store (index-status.js)
 *
 * Honest, file-persisted status tracking for the URL/PDF validation pipeline.
 * Core rule enforced everywhere: Submitted != Discovered != Crawled != Indexed.
 *
 * States:
 *   RECEIVED -> VALIDATED -> DISCOVERY_SUBMITTED -> DISCOVERY_PENDING -> DISCOVERED
 *     -> CRAWL_PENDING -> CRAWLED -> INDEX_STATUS_CHECK -> INDEXED
 *   Failure/terminal informational states:
 *     INVALID, BLOCKED, FETCH_ERROR, DISCOVERY_FAILED, NOT_DISCOVERED, NOT_INDEXED, UNKNOWN
 *
 * Persistence: data/index-status.json (atomic tmp+rename writes, corrupt-file recovery).
 * No Mongo dependency here by design — this store must work even with zero config.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const STATUS_FILE = path.join(DATA_DIR, 'index-status.json');
const MAX_RECORDS = 2000;

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

/**
 * Minimal atomic JSON store with malformed-file recovery.
 * Shared by the status store and the queue (index-engine.js).
 */
function createJsonStore(filePath, defaultValue) {
  ensureDataDir();
  const cloneDefault = () => JSON.parse(JSON.stringify(defaultValue));
  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        const d = cloneDefault();
        save(d);
        return d;
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) { const d = cloneDefault(); save(d); return d; }
      return JSON.parse(raw);
    } catch (err) {
      // Corrupt file: quarantine it, start fresh, never crash.
      try {
        const bak = `${filePath}.corrupt-${Date.now()}.bak`;
        fs.renameSync(filePath, bak);
      } catch (e) { /* ignore */ }
      const d = cloneDefault();
      try { save(d); } catch (e) { /* ignore */ }
      return d;
    }
  }
  function save(data) {
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath);
  }
  return { load, save };
}

const store = createJsonStore(STATUS_FILE, { records: [] });

function nowIso() { return new Date().toISOString(); }

function recordId(normalizedUrl) {
  return crypto.createHash('sha1').update(normalizedUrl).digest('hex').slice(0, 16);
}

function blankRecord({ url, normalizedUrl, host, ownership, source }) {
  const t = nowIso();
  return {
    id: recordId(normalizedUrl),
    url,
    normalizedUrl,
    host,
    ownership, // SELF | THIRD_PARTY
    state: 'RECEIVED',
    validation: null,
    pdf: null,
    discovery: { state: 'NOT_SUBMITTED', relayListed: false, feedListed: false, indexnow: null, provider: null, note: null },
    crawl: { state: 'UNKNOWN', evidence: [] },
    index: { state: 'UNKNOWN', evidence: [] },
    attempts: 0,
    lastError: null,
    source: source || 'api',
    createdAt: t,
    updatedAt: t
  };
}

function pruneIfNeeded(db) {
  if (db.records.length > MAX_RECORDS) {
    db.records.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
    db.records = db.records.slice(db.records.length - MAX_RECORDS);
  }
}

/** Insert or patch a record by normalized URL. Patch is shallow-merged; nested objects replaced. */
function upsertByUrl(key, patch) {
  const db = store.load();
  const idx = db.records.findIndex(r => r.normalizedUrl === key.normalizedUrl);
  let rec;
  if (idx === -1) {
    rec = blankRecord(key);
    db.records.push(rec);
  } else {
    rec = db.records[idx];
  }
  if (patch && typeof patch === 'object') {
    for (const k of Object.keys(patch)) rec[k] = patch[k];
  }
  rec.updatedAt = nowIso();
  pruneIfNeeded(db);
  store.save(db);
  return rec;
}

function getByUrl(normalizedUrl) {
  const db = store.load();
  return db.records.find(r => r.normalizedUrl === normalizedUrl) || null;
}

function getById(id) {
  const db = store.load();
  return db.records.find(r => r.id === id) || null;
}

function list({ state, limit = 50, offset = 0 } = {}) {
  const db = store.load();
  let rows = db.records.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (state) rows = rows.filter(r => r.state === state);
  const total = rows.length;
  rows = rows.slice(offset, offset + Math.min(limit, 200));
  return { total, rows };
}

function counts() {
  const db = store.load();
  const byState = {};
  let validated = 0, discoveryPending = 0, discovered = 0, crawlChecked = 0, indexed = 0, notIndexed = 0, unknown = 0;
  for (const r of db.records) {
    byState[r.state] = (byState[r.state] || 0) + 1;
    if (r.validation) validated++;
    if (r.discovery && (r.discovery.state === 'DISCOVERY_PENDING' || r.discovery.state === 'DISCOVERY_SUBMITTED')) discoveryPending++;
    if (r.discovery && r.discovery.state === 'DISCOVERED') discovered++;
    if (r.crawl && r.crawl.state !== 'UNKNOWN') crawlChecked++;
    if (r.index && r.index.state === 'INDEXED') indexed++;
    if (r.index && r.index.state === 'NOT_INDEXED') notIndexed++;
    if (!r.index || r.index.state === 'UNKNOWN') unknown++;
  }
  return { total: db.records.length, byState, validated, discoveryPending, discovered, crawlChecked, indexed, notIndexed, unknown };
}

module.exports = {
  createJsonStore,
  upsertByUrl,
  getByUrl,
  getById,
  list,
  counts,
  recordId,
  STATUS_FILE,
  MAX_RECORDS
};
