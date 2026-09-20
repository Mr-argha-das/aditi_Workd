/**
 * INDEX MATRIX — Index Engine (index-engine.js)
 *
 * Real URL validation + PDF analysis + discovery queue. Additive module:
 * it does NOT modify legacy dispatch behavior, it adds an honest pipeline where
 *   Submitted != Discovered != Crawled != Indexed
 *
 * Pipeline per job:
 *   RECEIVED -> fetch(+redirects) -> robots check -> PDF analysis -> VALIDATED
 *     -> relay/feed listing (operator-owned discovery) -> optional provider submit
 *     -> DISCOVERED (in OUR discovery surface) ; crawl/index stay UNKNOWN
 *     (this engine has no search-engine evidence channel, and never fabricates one)
 *
 * Protections: PDF size cap (~35MB), fetch timeouts, redirect cap, per-host
 * throttle, retry with backoff, atomic persistence, provider failure isolation.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const indexStatus = require('./index-status');

const VALIDATOR_UA = 'INDEX-MATRIX-Validator/2.0 (+technical-probe; not-a-search-crawler)';
const QUEUE_FILE = path.join(__dirname, 'data', 'index-queue.json');
const QUEUE_KEEP_DONE = 500;
const HTML_SNIFF_MAX_KB = 512;
const DENY_HOSTS = new Set(['169.254.169.254', '0.0.0.0']);

// ---- dynamic config (env-overridable at call time, tests can tune) ----
function numEnv(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}
const cfg = {
  concurrency: () => Math.max(1, Math.min(10, Math.floor(numEnv('INDEX_QUEUE_CONCURRENCY', 2)))),
  perHostDelayMs: () => numEnv('INDEX_PER_HOST_DELAY_MS', 1500),
  pdfMaxMB: () => numEnv('INDEX_PDF_MAX_MB', 35),
  maxAttempts: () => Math.max(1, Math.min(10, Math.floor(numEnv('INDEX_MAX_ATTEMPTS', 3)))),
  fetchTimeoutMs: () => numEnv('INDEX_FETCH_TIMEOUT_MS', 15000),
  retryBaseMs: () => numEnv('INDEX_RETRY_BASE_MS', 20000),
  maxRedirects: () => 5,
  providerTimeoutMs: () => 10000,
  ownDomains: () => (process.env.OWN_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
};

function providerKey() {
  const k = (process.env.SPEEDYINDEX_API_KEY || process.env.INDEXER_API_KEY || '').trim();
  return k || null;
}

const queueStore = indexStatus.createJsonStore(QUEUE_FILE, { jobs: [] });

// ---------------------------------------------------------------- normalize
function normalizeUrl(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'INVALID_URL' };
  const raw = input.trim();
  if (!raw || raw.length > 2048) return { ok: false, reason: 'INVALID_URL' };
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (!m) return { ok: false, reason: 'INVALID_URL' };
  const scheme = m[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'UNSUPPORTED_PROTOCOL' };
  let u;
  try { u = new URL(raw); } catch (e) { return { ok: false, reason: 'INVALID_URL' }; }
  if (!u.hostname) return { ok: false, reason: 'INVALID_URL' };
  const host = u.hostname.toLowerCase();
  if (DENY_HOSTS.has(host)) return { ok: false, reason: 'BLOCKED_HOST' };
  u.hostname = host;
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  u.hash = '';
  return { ok: true, normalized: u.toString(), host };
}

function ownershipOf(host) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'SELF';
  if (cfg.ownDomains().includes(host)) return 'SELF';
  return 'THIRD_PARTY';
}

// ---------------------------------------------------------------- fetch core
async function readCapped(body, maxBytes) {
  const chunks = [];
  let total = 0, truncated = false;
  for await (const chunk of body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const keep = buf.length - (total - maxBytes);
      if (keep > 0) chunks.push(buf.subarray(0, keep));
      truncated = true;
      try { if (body.cancel) await body.cancel(); } catch (e) { /* ignore */ }
      break;
    }
    chunks.push(buf);
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

/**
 * GET with manual redirect handling + byte cap.
 * Returns headers + body (capped). Never follows non-http(s) locations.
 */
async function fetchWithRedirects(startUrl, { timeoutMs, maxBytes, maxRedirects }) {
  const redirects = [];
  let current = startUrl;
  const t0 = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': VALIDATOR_UA, 'Accept': '*/*' }
      });
    } catch (err) {
      return { ok: false, error: `FETCH_FAILED: ${err.message}`, redirects, responseMs: Date.now() - t0, finalUrl: current };
    }
    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get('location');
      try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* ignore */ }
      if (!loc) return { ok: false, error: 'REDIRECT_WITHOUT_LOCATION', redirects, responseMs: Date.now() - t0, finalUrl: current, httpStatus: status };
      let next;
      try { next = new URL(loc, current).toString(); } catch (e) {
        return { ok: false, error: 'REDIRECT_BAD_LOCATION', redirects, responseMs: Date.now() - t0, finalUrl: current, httpStatus: status };
      }
      if (!/^https?:\/\//i.test(next)) {
        return { ok: false, error: 'REDIRECT_NON_HTTP', redirects, responseMs: Date.now() - t0, finalUrl: current, httpStatus: status };
      }
      redirects.push({ from: current, status, to: next });
      current = next;
      continue;
    }
    // terminal response
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* ignore */ }
      return { ok: true, oversized: true, httpStatus: status, finalUrl: current, redirects, contentType, contentLength: declared, responseMs: Date.now() - t0 };
    }
    let bytes;
    try {
      const r = await readCapped(res.body, maxBytes);
      bytes = r.bytes;
      if (r.truncated) {
        return { ok: true, oversized: true, httpStatus: status, finalUrl: current, redirects, contentType, contentLength: declared || null, responseMs: Date.now() - t0 };
      }
    } catch (err) {
      return { ok: false, error: `BODY_READ_FAILED: ${err.message}`, redirects, responseMs: Date.now() - t0, finalUrl: current, httpStatus: status };
    }
    return { ok: true, httpStatus: status, finalUrl: current, redirects, contentType, contentLength: declared || bytes.length, bytes, responseMs: Date.now() - t0 };
  }
  return { ok: false, error: 'TOO_MANY_REDIRECTS', redirects, responseMs: Date.now() - t0, finalUrl: current };
}

// ---------------------------------------------------------------- robots
function robotsAllowedFor(robotsText, ua, pathname) {
  // Minimal parser: collect Allow/Disallow from groups matching our UA or '*'.
  const lines = robotsText.split(/\r?\n/);
  let inScope = false, sawGroup = false;
  const rules = [];
  const me = ua.toLowerCase();
  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      const v = value.toLowerCase();
      if (!sawGroup) sawGroup = true;
      // new group starts when we already collected a group and see another UA line
      inScope = (v === '*' || me.includes(v) || v.includes(me));
    } else if (field === 'disallow' || field === 'allow') {
      if (inScope && value) rules.push({ type: field, path: value });
    }
  }
  let bestAllow = -1, bestDisallow = -1;
  for (const r of rules) {
    if (pathname.startsWith(r.path)) {
      if (r.type === 'allow') bestAllow = Math.max(bestAllow, r.path.length);
      else bestDisallow = Math.max(bestDisallow, r.path.length);
    }
  }
  if (bestDisallow === -1 && bestAllow === -1) return true;
  return bestAllow >= bestDisallow;
}

async function checkRobots(targetUrl) {
  let host, protocol, pathname;
  try {
    const u = new URL(targetUrl);
    host = u.host; protocol = u.protocol; pathname = u.pathname || '/'; // u.host keeps non-default ports
  } catch (e) { return { state: 'UNKNOWN', allowed: null, note: 'bad target url' }; }
  const robotsUrl = `${protocol}//${host}/robots.txt`;
  const res = await fetchWithRedirects(robotsUrl, { timeoutMs: 6000, maxBytes: 100 * 1024, maxRedirects: 3 });
  if (!res.ok || res.httpStatus !== 200 || !res.bytes) {
    return { state: 'UNKNOWN', allowed: null, note: res.ok ? `robots http ${res.httpStatus}` : res.error };
  }
  let allowed = true;
  try { allowed = robotsAllowedFor(res.bytes.toString('utf8'), VALIDATOR_UA, pathname); } catch (e) { /* default allow */ }
  return allowed
    ? { state: 'AVAILABLE', allowed: true, note: 'path allowed by robots.txt' }
    : { state: 'BLOCKED', allowed: false, note: 'path disallowed by robots.txt' };
}

// ---------------------------------------------------------------- pdf
let pdfParseLib = null, pdfLibTried = false;
function getPdfLib() {
  if (!pdfLibTried) { pdfLibTried = true; try { pdfParseLib = require('pdf-parse'); } catch (e) { pdfParseLib = null; } }
  return pdfParseLib;
}

async function analyzePdf(bytes) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const sigOk = bytes.length > 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!sigOk) {
    return { isPdf: false, valid: false, pages: null, textLength: 0, bytes: bytes.length, sha256, classification: 'NOT_A_PDF', note: 'missing %PDF- signature (content is not a PDF)' };
  }
  const lib = getPdfLib();
  if (!lib) {
    return { isPdf: true, valid: true, pages: null, textLength: 0, bytes: bytes.length, sha256, classification: 'SCANNED_OR_EMPTY_PDF', note: 'pdf parser unavailable; signature valid' };
  }
  try {
    let text = '', pages = null;
    if (lib.PDFParse && typeof lib.PDFParse === 'function') {
      const parser = new lib.PDFParse({ data: bytes });
      const out = await parser.getText();
      await parser.destroy().catch(() => {});
      if (typeof out === 'string') text = out;
      else if (out && typeof out.text === 'string') text = out.text;
      else if (out && Array.isArray(out.pages)) { pages = out.pages.length; text = out.pages.map(p => p.text || '').join(' '); }
    } else if (typeof lib === 'function') {
      const data = await lib(bytes);
      text = data?.text || '';
      pages = typeof data?.numpages === 'number' ? data.numpages : null;
    }
    text = (text || '').replace(/\s+/g, ' ').trim();
    const isText = text.length >= 100;
    return {
      isPdf: true, valid: true, pages, textLength: text.length, bytes: bytes.length, sha256,
      classification: isText ? 'TEXT_PDF' : 'SCANNED_OR_EMPTY_PDF',
      note: isText ? 'text layer present' : 'no extractable text (scanned image or empty)'
    };
  } catch (err) {
    return { isPdf: true, valid: false, pages: null, textLength: 0, bytes: bytes.length, sha256, classification: 'SCANNED_OR_EMPTY_PDF', note: `parse failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------- queue
function loadQueue() {
  const q = queueStore.load();
  if (!q || !Array.isArray(q.jobs)) return { jobs: [] };
  return q;
}
function saveQueue(q) {
  // keep bounded: all active + last QUEUE_KEEP_DONE terminal
  const active = q.jobs.filter(j => j.state === 'PENDING' || j.state === 'RUNNING');
  const done = q.jobs.filter(j => j.state !== 'PENDING' && j.state !== 'RUNNING')
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, QUEUE_KEEP_DONE);
  queueStore.save({ jobs: active.concat(done) });
}

function enqueueUrls(urls, source) {
  const accepted = [], rejected = [], duplicates = [];
  const seenBatch = new Set();
  const q = loadQueue();
  const activeSet = new Set(q.jobs.filter(j => j.state === 'PENDING' || j.state === 'RUNNING').map(j => j.normalizedUrl));
  for (const raw of urls || []) {
    const n = normalizeUrl(raw);
    if (!n.ok) { rejected.push({ url: String(raw).slice(0, 300), reason: n.reason }); continue; }
    if (seenBatch.has(n.normalized)) { duplicates.push({ url: n.normalized, reason: 'DUPLICATE_IN_BATCH' }); continue; }
    seenBatch.add(n.normalized);
    if (activeSet.has(n.normalized)) { duplicates.push({ url: n.normalized, reason: 'ALREADY_QUEUED' }); continue; }
    const t = new Date().toISOString();
    q.jobs.push({
      id: indexStatus.recordId(n.normalized + ':' + Date.now() + Math.random()),
      url: String(raw).slice(0, 2048), normalizedUrl: n.normalized, host: n.host,
      state: 'PENDING', attempts: 0, maxAttempts: cfg.maxAttempts(),
      nextRunAt: t, createdAt: t, updatedAt: t, lastError: null, source: source || 'api'
    });
    activeSet.add(n.normalized);
    accepted.push({ url: n.normalized });
    indexStatus.upsertByUrl(
      { url: String(raw).slice(0, 2048), normalizedUrl: n.normalized, host: n.host, ownership: ownershipOf(n.host), source: source || 'api' },
      { state: 'RECEIVED', attempts: 0, lastError: null }
    );
  }
  saveQueue(q);
  return { accepted, rejected, duplicates };
}

// ---------------------------------------------------------------- provider
async function submitProvider(finalUrl) {
  const key = providerKey();
  if (!key) {
    return { provider: 'SpeedyIndex', accepted: false, taskId: null, reason: 'PROVIDER_NOT_CONFIGURED', googleCrawlConfirmed: false, googleIndexedConfirmed: false };
  }
  let hostPart = 'Site';
  try { hostPart = new URL(finalUrl).hostname; } catch (e) { /* ignore */ }
  try {
    const res = await fetch('https://api.speedyindex.com/v2/task/google/indexer/create', {
      method: 'POST',
      headers: { 'Authorization': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [finalUrl], title: `IndexMatrix - ${hostPart}`, pay_per_indexed: true }),
      signal: AbortSignal.timeout(cfg.providerTimeoutMs())
    });
    const data = await res.json().catch(() => ({}));
    if (data && (data.code === 0 || data.task_id)) {
      return { provider: 'SpeedyIndex', accepted: true, taskId: data.task_id || (data.result && data.result.task_id) || null, httpStatus: res.status, googleCrawlConfirmed: false, googleIndexedConfirmed: false };
    }
    return { provider: 'SpeedyIndex', accepted: false, taskId: null, httpStatus: res.status, error: data.message || data.error || 'provider rejected task', googleCrawlConfirmed: false, googleIndexedConfirmed: false };
  } catch (err) {
    return { provider: 'SpeedyIndex', accepted: false, taskId: null, error: `PROVIDER_REQUEST_FAILED: ${err.message}`, googleCrawlConfirmed: false, googleIndexedConfirmed: false };
  }
}

// ---------------------------------------------------------------- discovery (operator-owned surface)
function submitLocalDiscovery(finalUrl, host) {
  // Relay directory + RSS feed read the same store, so one write lists both.
  try {
    const db = require('./db');
    if (db && typeof db.saveRelayLinks === 'function') {
      return Promise.resolve(db.saveRelayLinks([{ url: finalUrl, title: `Index Engine discovery — ${host}`, source: 'index-engine' }]))
        .then(() => ({ relayListed: true, feedListed: true, note: 'listed in local relay directory + RSS feed (operator-owned discovery surface)' }))
        .catch(err => ({ relayListed: false, feedListed: false, note: `relay write failed: ${err.message}` }));
    }
  } catch (err) {
    return Promise.resolve({ relayListed: false, feedListed: false, note: `relay unavailable: ${err.message}` });
  }
  return Promise.resolve({ relayListed: false, feedListed: false, note: 'relay store unavailable' });
}

// ---------------------------------------------------------------- pipeline
async function runValidationPipeline(key, { attemptNumber }) {
  const pdfCap = Math.floor(cfg.pdfMaxMB() * 1024 * 1024);
  const htmlCap = HTML_SNIFF_MAX_KB * 1024;
  const looksPdf = /\.pdf(\?|#|$)/i.test(key.normalizedUrl);

  // Pass 1: fetch headers + body with the right cap. If not obviously a PDF but
  // content-type says PDF, refetch with the PDF cap.
  let res = await fetchWithRedirects(key.normalizedUrl, {
    timeoutMs: cfg.fetchTimeoutMs(),
    maxBytes: looksPdf ? pdfCap : htmlCap,
    maxRedirects: cfg.maxRedirects()
  });
  if (res.ok && !res.oversized && !looksPdf && res.contentType.includes('pdf')) {
    res = await fetchWithRedirects(key.normalizedUrl, {
      timeoutMs: cfg.fetchTimeoutMs(), maxBytes: pdfCap, maxRedirects: cfg.maxRedirects()
    });
  }

  if (!res.ok) {
    return { terminal: false, retryable: true, validation: null, error: res.error || 'FETCH_FAILED', redirects: res.redirects, finalUrl: res.finalUrl };
  }
  if (res.oversized) {
    return {
      terminal: true,
      validation: { httpStatus: res.httpStatus, finalUrl: res.finalUrl, redirects: res.redirects, contentType: res.contentType, contentLength: res.contentLength, responseMs: res.responseMs, robots: null },
      error: `OVERSIZED: declared/delivered body exceeds ${cfg.pdfMaxMB()}MB cap`
    };
  }
  const robots = await checkRobots(res.finalUrl);
  const validation = {
    httpStatus: res.httpStatus, finalUrl: res.finalUrl, redirects: res.redirects,
    contentType: res.contentType, contentLength: res.contentLength, responseMs: res.responseMs, robots
  };
  let pdf = null;
  if (res.httpStatus === 200 && (res.contentType.includes('pdf') || looksPdf)) {
    pdf = await analyzePdf(res.bytes);
  } else if (res.httpStatus === 200 && res.bytes && res.bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    pdf = await analyzePdf(res.bytes); // undeclared PDF, sniffed
  }
  return { terminal: true, validation, pdf };
}

/** Single immediate validation (no queue, no retry, no provider). Discovery stays NOT_SUBMITTED. */
async function validateOnce(rawUrl, source) {
  const n = normalizeUrl(rawUrl);
  if (!n.ok) return { ok: false, reason: n.reason };
  const key = { url: n.normalized, normalizedUrl: n.normalized, host: n.host, ownership: ownershipOf(n.host), source: source || 'validate' };
  indexStatus.upsertByUrl(key, { state: 'RECEIVED', attempts: 1, lastError: null });
  const out = await runValidationPipeline(key, { attemptNumber: 1 });
  if (!out.terminal) {
    return { ok: true, record: indexStatus.upsertByUrl(key, { state: 'FETCH_ERROR', validation: out.validation || null, attempts: 1, lastError: out.error }) };
  }
  const patch = { state: 'VALIDATED', validation: out.validation, pdf: out.pdf, attempts: 1, lastError: out.error || null,
    crawl: { state: out.validation.httpStatus === 200 ? 'FETCH_CHECKED' : 'UNKNOWN', evidence: [], note: 'server-side technical fetch only; NOT search-engine crawl evidence' } };
  if (out.error) { patch.state = 'FETCH_ERROR'; }
  else if (out.validation.robots && out.validation.robots.state === 'BLOCKED') { patch.state = 'BLOCKED'; }
  else if (out.validation.httpStatus !== 200) { patch.state = 'VALIDATED'; } // validation succeeded; resource missing
  const record = indexStatus.upsertByUrl(key, patch);
  return { ok: true, record };
}

async function processJob(job) {
  const key = { url: job.url, normalizedUrl: job.normalizedUrl, host: job.host, ownership: ownershipOf(job.host), source: job.source };
  const attemptNumber = job.attempts + 1;
  indexStatus.upsertByUrl(key, { state: 'RECEIVED', attempts: attemptNumber, lastError: null });

  let out;
  try {
    out = await runValidationPipeline(key, { attemptNumber });
  } catch (err) {
    out = { terminal: false, retryable: true, error: `PIPELINE_EXCEPTION: ${err.message}` };
  }

  // --- retryable failure path ---
  const httpStatus = out.validation ? out.validation.httpStatus : null;
  const serverError5xx = httpStatus !== null && httpStatus >= 500 && httpStatus < 600;
  if ((!out.terminal && out.retryable) || serverError5xx) {
    const errMsg = out.error || `HTTP_${httpStatus}`;
    if (attemptNumber >= job.maxAttempts) {
      markJob(job.id, 'FAILED', errMsg);
      indexStatus.upsertByUrl(key, { state: 'FETCH_ERROR', validation: out.validation || null, attempts: attemptNumber, lastError: `${errMsg} (attempts exhausted: ${attemptNumber}/${job.maxAttempts})` });
      return { outcome: 'FAILED', error: errMsg };
    }
    const delay = cfg.retryBaseMs() * attemptNumber;
    markJob(job.id, 'PENDING', errMsg, new Date(Date.now() + delay).toISOString(), attemptNumber);
    indexStatus.upsertByUrl(key, { state: 'RECEIVED', validation: out.validation || null, attempts: attemptNumber, lastError: `${errMsg} (retry ${attemptNumber}/${job.maxAttempts} in ${Math.round(delay / 1000)}s)` });
    return { outcome: 'RETRY', error: errMsg };
  }

  // --- terminal deterministic path ---
  if (out.error && !out.validation) {
    markJob(job.id, 'COMPLETED', out.error, null, attemptNumber);
    indexStatus.upsertByUrl(key, { state: 'FETCH_ERROR', attempts: attemptNumber, lastError: out.error });
    return { outcome: 'COMPLETED', state: 'FETCH_ERROR' };
  }
  const v = out.validation;
  // Non-200 (4xx etc.): validation complete, nothing to discover.
  if (v.httpStatus !== 200) {
    markJob(job.id, 'COMPLETED', null, null, attemptNumber);
    const record = indexStatus.upsertByUrl(key, {
      state: 'VALIDATED', validation: v, pdf: out.pdf || null, attempts: attemptNumber, lastError: null,
      discovery: { state: 'NOT_DISCOVERED', relayListed: false, feedListed: false, indexnow: null, provider: null, note: `not discoverable: HTTP ${v.httpStatus}` },
      crawl: { state: 'UNKNOWN', evidence: [] }
    });
    return { outcome: 'COMPLETED', state: 'VALIDATED', record };
  }
  // Robots-blocked: polite stop, no discovery/provider.
  if (v.robots && v.robots.state === 'BLOCKED') {
    markJob(job.id, 'COMPLETED', null, null, attemptNumber);
    const record = indexStatus.upsertByUrl(key, {
      state: 'BLOCKED', validation: v, pdf: out.pdf || null, attempts: attemptNumber, lastError: null,
      discovery: { state: 'NOT_DISCOVERED', relayListed: false, feedListed: false, indexnow: null, provider: null, note: 'robots.txt disallows this path; discovery skipped' },
      crawl: { state: 'FETCH_CHECKED', evidence: [], note: 'server-side technical fetch only; NOT search-engine crawl evidence' }
    });
    return { outcome: 'COMPLETED', state: 'BLOCKED', record };
  }
  if (out.error) { // e.g. OVERSIZED with headers recorded
    markJob(job.id, 'COMPLETED', out.error, null, attemptNumber);
    const record = indexStatus.upsertByUrl(key, {
      state: 'FETCH_ERROR', validation: v, pdf: out.pdf || null, attempts: attemptNumber, lastError: out.error,
      discovery: { state: 'NOT_DISCOVERED', relayListed: false, feedListed: false, indexnow: null, provider: null, note: out.error }
    });
    return { outcome: 'COMPLETED', state: 'FETCH_ERROR', record };
  }

  // --- healthy 200: VALIDATED -> local discovery -> optional provider ---
  indexStatus.upsertByUrl(key, {
    state: 'VALIDATED', validation: v, pdf: out.pdf || null, attempts: attemptNumber, lastError: null,
    discovery: { state: 'DISCOVERY_SUBMITTED', relayListed: false, feedListed: false, indexnow: null, provider: null, note: 'validation passed; submitting to discovery surface' },
    crawl: { state: 'FETCH_CHECKED', evidence: [], note: 'server-side technical fetch only; NOT search-engine crawl evidence' }
  });

  const local = await submitLocalDiscovery(v.finalUrl, job.host);
  // IndexNow honesty: this engine never sends IndexNow for hosts without a
  // verified key, and no per-target key registry is configured -> always report requirement.
  const indexnow = { state: 'TARGET_VERIFICATION_REQUIRED', reason: 'target-domain key not configured; IndexNow needs target-domain ownership verification' };
  const provider = await submitProvider(v.finalUrl); // never throws; failure isolated

  const discovered = !!(local.relayListed || local.feedListed);
  markJob(job.id, 'COMPLETED', null, null, attemptNumber);
  const record = indexStatus.upsertByUrl(key, {
    state: discovered ? 'DISCOVERED' : 'DISCOVERY_FAILED',
    discovery: {
      state: discovered ? 'DISCOVERED' : 'DISCOVERY_FAILED',
      relayListed: local.relayListed, feedListed: local.feedListed,
      indexnow, provider, note: local.note
    }
    // crawl/index deliberately stay as-is (FETCH_CHECKED / UNKNOWN): no evidence channel.
  });
  return { outcome: 'COMPLETED', state: record.state, record };
}

function markJob(id, state, lastError, nextRunAt, attempts) {
  const q = loadQueue();
  const j = q.jobs.find(x => x.id === id);
  if (!j) return;
  j.state = state;
  j.updatedAt = new Date().toISOString();
  if (typeof lastError !== 'undefined') j.lastError = lastError;
  if (typeof attempts === 'number') j.attempts = attempts;
  if (nextRunAt) { j.nextRunAt = nextRunAt; }
  saveQueue(q);
}

// ---------------------------------------------------------------- worker
let timer = null, ticking = false, runningCount = 0;
const hostCooldown = new Map(); // host -> last dispatch epoch ms

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const limit = cfg.concurrency();
    const delay = cfg.perHostDelayMs();
    while (runningCount < limit) {
      const q = loadQueue();
      const now = Date.now();
      const job = q.jobs
        .filter(j => j.state === 'PENDING' && Date.parse(j.nextRunAt) <= now && (now - (hostCooldown.get(j.host) || 0)) >= delay)
        .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1))[0];
      if (!job) break;
      hostCooldown.set(job.host, now);
      markJob(job.id, 'RUNNING', null, null, job.attempts);
      runningCount++;
      processJob(job).catch(err => {
        try {
          const nq = loadQueue();
          const jj = nq.jobs.find(x => x.id === job.id);
          if (jj && jj.state === 'RUNNING') {
            if (jj.attempts + 1 >= jj.maxAttempts) { markJob(jj.id, 'FAILED', `WORKER_EXCEPTION: ${err.message}`, null, jj.attempts + 1); }
            else { markJob(jj.id, 'PENDING', `WORKER_EXCEPTION: ${err.message}`, new Date(Date.now() + cfg.retryBaseMs()).toISOString(), jj.attempts + 1); }
          }
        } catch (e) { /* ignore */ }
      }).finally(() => { runningCount--; });
    }
  } finally {
    ticking = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, 400);
  tick();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function queueStats(limitJobs) {
  const q = loadQueue();
  let pending = 0, running = 0, completed = 0, failed = 0;
  for (const j of q.jobs) {
    if (j.state === 'PENDING') pending++;
    else if (j.state === 'RUNNING') running++;
    else if (j.state === 'COMPLETED') completed++;
    else if (j.state === 'FAILED') failed++;
  }
  const jobs = q.jobs.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, limitJobs || 50);
  return { pending, running, completed, failed, total: q.jobs.length, jobs };
}

function getStats() {
  return {
    worker: { running: !!timer, inFlight: runningCount },
    queue: queueStats(5),
    status: indexStatus.counts(),
    provider: { speedyindex: { configured: !!providerKey() } },
    limits: {
      concurrency: cfg.concurrency(), perHostDelayMs: cfg.perHostDelayMs(),
      pdfMaxMB: cfg.pdfMaxMB(), maxAttempts: cfg.maxAttempts(),
      fetchTimeoutMs: cfg.fetchTimeoutMs(), retryBaseMs: cfg.retryBaseMs()
    }
  };
}

module.exports = {
  normalizeUrl, ownershipOf, enqueueUrls, validateOnce, processJob,
  start, stop, tick, queueStats, getStats, providerKey, cfg,
  fetchWithRedirects, checkRobots, analyzePdf
};
