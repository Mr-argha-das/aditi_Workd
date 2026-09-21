/**
 * INDEX MATRIX - Technical URL/PDF validation and bounded processing queue.
 *
 * This module records technical evidence only. A server-side fetch is never
 * represented as proof of a search-engine crawl or indexing.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const referencePages = require('./reference-pages');

const QUEUE_FILE = path.join(__dirname, 'data', 'index-queue.json');
const MAX_QUEUE = 10000;
const MAX_FETCH_BYTES = 35 * 1024 * 1024;
const CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.INDEX_QUEUE_CONCURRENCY) || 2));
const PER_HOST_DELAY_MS = Math.max(0, Number(process.env.INDEX_PER_HOST_DELAY_MS) || 1200);
const MAX_ATTEMPTS = 3;
let running = false;
const hostNextAt = new Map();

function ensure() {
  const d = path.dirname(QUEUE_FILE);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  if (!fs.existsSync(QUEUE_FILE)) fs.writeFileSync(QUEUE_FILE, '[]', 'utf8');
}
function read() {
  ensure();
  try {
    const x = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(x) ? x : [];
  } catch (e) {
    return [];
  }
}
function write(x) {
  ensure();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(x.slice(0, MAX_QUEUE), null, 2), 'utf8');
}
function now() { return new Date().toISOString(); }

function enqueue(url) {
  const normalized = (() => { try { return new URL(String(url).trim()).toString(); } catch (_) { return String(url || '').trim(); } })();
  const q = read();
  const existing = q.find(x => x.url === normalized && ['PENDING', 'RUNNING'].includes(x.status));
  if (existing) return existing;
  const item = {
    id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    url: normalized,
    status: 'PENDING',
    attempts: 0,
    createdAt: now(),
    updatedAt: now(),
    nextAttemptAt: now()
  };
  q.push(item);
  write(q);
  return item;
}

function list(limit = 100) {
  return read().slice(-Math.min(Math.max(Number(limit) || 100, 1), 1000)).reverse();
}

function stats() {
  const q = read();
  return {
    total: q.length,
    pending: q.filter(x => x.status === 'PENDING').length,
    running: q.filter(x => x.status === 'RUNNING').length,
    done: q.filter(x => x.status === 'DONE').length,
    failed: q.filter(x => x.status === 'FAILED').length
  };
}

async function waitForHost(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return; }
  const current = Date.now();
  const next = hostNextAt.get(host) || 0;
  if (next > current) await new Promise(r => setTimeout(r, next - current));
  hostNextAt.set(host, Date.now() + PER_HOST_DELAY_MS);
}

async function fetchBounded(url, options = {}) {
  await waitForHost(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'INDEX-MATRIX-Validator/2.1',
        'Accept': 'application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_FETCH_BYTES) throw new Error('Remote resource exceeds 35 MB limit.');
    const reader = res.body?.getReader();
    if (!reader) return { res, buffer: Buffer.from(await res.arrayBuffer()) };
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_FETCH_BYTES) {
        await reader.cancel();
        throw new Error('Remote resource exceeds 35 MB limit.');
      }
      chunks.push(Buffer.from(value));
    }
    return { res, buffer: Buffer.concat(chunks, total) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkRobots(url) {
  try {
    const parsed = new URL(url);
    const robotsUrl = parsed.origin + '/robots.txt';
    const { res, buffer } = await fetchBounded(robotsUrl, { timeout: 7000 });
    if (!res.ok) return { found: false, allowed: true, url: robotsUrl };
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/).map(x => x.trim());
    let active = false;
    let allowed = true;
    const targetPath = parsed.pathname || '/';
    for (const raw of lines) {
      const line = raw.split('#')[0].trim();
      if (!line) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith('user-agent:')) {
        const agent = lower.slice('user-agent:'.length).trim();
        active = agent === '*' || agent === 'googlebot';
      } else if (active && lower.startsWith('disallow:')) {
        const rule = line.slice(line.indexOf(':') + 1).trim();
        if (rule && targetPath.startsWith(rule)) allowed = false;
      } else if (active && lower.startsWith('allow:')) {
        const rule = line.slice(line.indexOf(':') + 1).trim();
        if (rule && targetPath.startsWith(rule)) allowed = true;
      }
    }
    return { found: true, allowed, url: robotsUrl };
  } catch (e) {
    return { found: false, allowed: null, url: null, error: e.message };
  }
}

async function validateUrl(url) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch (e) { return { ok: false, error: 'Invalid URL' }; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { ok: false, error: 'Only HTTP/HTTPS URLs are supported.' };
  const started = Date.now();
  try {
    const { res, buffer } = await fetchBounded(parsed.toString());
    const type = (res.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const robots = await checkRobots(res.url || parsed.toString());
    return {
      ok: res.ok,
      httpStatus: res.status,
      contentType: type,
      contentLength: buffer.length,
      finalUrl: res.url,
      redirected: res.redirected,
      elapsedMs: Date.now() - started,
      robotsAllowed: robots.allowed,
      robotsFound: robots.found,
      robotsUrl: robots.url,
      robotsError: robots.error || null,
      buffer
    };
  } catch (e) {
    return { ok: false, error: e.message, elapsedMs: Date.now() - started };
  }
}

async function analyzePdf(buffer, pdfParse) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const validMagic = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  let text = '';
  let pages = null;
  let info = {};
  if (validMagic && pdfParse) {
    try {
      if (pdfParse.PDFParse && typeof pdfParse.PDFParse === 'function') {
        const parser = new pdfParse.PDFParse({ data: buffer });
        const result = await parser.getText();
        pages = Array.isArray(result?.pages) ? result.pages.length : null;
        text = typeof result === 'string' ? result : (result?.text || '');
        await parser.destroy().catch(() => {});
      } else if (typeof pdfParse === 'function') {
        const result = await pdfParse(buffer);
        text = result?.text || '';
        pages = result?.numpages || null;
        info = result?.info || {};
      }
    } catch (e) {
      info = { parseError: e.message };
    }
  }
  return {
    valid: validMagic,
    textLength: text.trim().length,
    pages,
    sizeBytes: buffer.length,
    sha256,
    metadata: info,
    contentClass: text.trim().length ? 'TEXT_PDF' : 'SCANNED_OR_EMPTY_PDF'
  };
}

function analyzeHtml(buffer, finalUrl) {
  const html = buffer.toString('utf8');
  const title = (html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)?.[1] || '').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim();
  const description = (html.match(/<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']*)[\"']/i)?.[1] || '').trim();
  const robots = (html.match(/<meta[^>]+name=[\"']robots[\"'][^>]+content=[\"']([^\"']*)[\"']/i)?.[1] || '').trim();
  const canonical = html.match(/<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']*)[\"']/i)?.[1] || '';
  const text = html.replace(/<script[\\s\\S]*?<\\/script>/gi,' ').replace(/<style[\\s\\S]*?<\\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim();
  return { title: title || finalUrl, description, robots, canonical, textPreview: text.slice(0,900), textLength: text.length };
}

async function processOne(item, deps) {
  const q = read();
  const row = q.find(x => x.id === item.id);
  if (!row) return;
  row.status = 'RUNNING';
  row.attempts = (row.attempts || 0) + 1;
  row.updatedAt = now();
  write(q);

  try {
    const result = await validateUrl(row.url);
    deps.status.markValidated(row.url, {
      ok: result.ok,
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      contentLength: result.contentLength,
      finalUrl: result.finalUrl,
      robotsAllowed: result.robotsAllowed,
      error: result.error
    });

    if (!result.ok) throw new Error(result.error || ('HTTP ' + result.httpStatus));

    deps.status.markCrawlChecked(row.url, {
      httpStatus: result.httpStatus,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
      googlebotUserAgent: false
    });

    if (/application\/pdf/i.test(result.contentType || '') || /\.pdf(?:$|[?#])/i.test(result.finalUrl || row.url)) {
      const pdf = await analyzePdf(result.buffer, deps.pdfParse);
      deps.status.markPdfAnalysis(row.url, pdf);
      if (!pdf.valid) throw new Error('URL did not return a valid PDF file.');
    }

    const isPdf = /application\\/pdf/i.test(result.contentType || '') || /\\.pdf(?:$|[?#])/i.test(result.finalUrl || row.url);
    if (isPdf) {
      const pdf = await analyzePdf(result.buffer, deps.pdfParse);
      deps.status.markPdfAnalysis(row.url, pdf);
      if (!pdf.valid) throw new Error('URL did not return a valid PDF file.');
      let sourceDomain = '';
      try { sourceDomain = new URL(result.finalUrl || row.url).hostname; } catch (_) {}
      let title = pdf.metadata?.Title || 'PDF document';
      try {
        const part = decodeURIComponent(new URL(result.finalUrl || row.url).pathname.split('/').pop() || '');
        if (!pdf.metadata?.Title && part) title = part.replace(/\\.pdf$/i, '');
      } catch (_) {}
      referencePages.upsert(row.url, {
        type: 'PDF', title,
        description: 'Validated PDF reference from ' + sourceDomain + '.',
        excerpt: pdf.textPreview, sourceDomain, finalUrl: result.finalUrl || row.url,
        contentType: result.contentType, pages: pdf.pages, sha256: pdf.sha256, textLength: pdf.textLength
      });
    } else {
      const html = analyzeHtml(result.buffer, result.finalUrl || row.url);
      let sourceDomain = '';
      try { sourceDomain = new URL(result.finalUrl || row.url).hostname; } catch (_) {}
      referencePages.upsert(row.url, {
        type: 'WEB', title: html.title, description: html.description || ('Reference page for ' + sourceDomain + '.'),
        excerpt: html.textPreview, sourceDomain, finalUrl: result.finalUrl || row.url,
        contentType: result.contentType, canonical: html.canonical, textLength: html.textLength
      });
    }

    deps.status.markDiscoverySubmitted(row.url, ['relay-hub']);
    row.status = 'DONE';
    row.lastResult = {
      httpStatus: result.httpStatus,
      contentType: result.contentType,
      finalUrl: result.finalUrl,
      robotsAllowed: result.robotsAllowed,
      checkedAt: now()
    };
    row.updatedAt = now();
    row.error = null;
    write(q);
  } catch (e) {
    row.status = row.attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
    row.error = e.message;
    row.nextAttemptAt = new Date(Date.now() + Math.min(60000, 1500 * Math.pow(2, row.attempts - 1))).toISOString();
    row.updatedAt = now();
    write(q);
  }
}

async function pump(deps) {
  if (running) return;
  running = true;
  try {
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const q = read();
        const nowMs = Date.now();
        const item = q.find(x => x.status === 'PENDING' && (!x.nextAttemptAt || Date.parse(x.nextAttemptAt) <= nowMs));
        if (!item) return;
        await processOne(item, deps);
      }
    });
    await Promise.all(workers);
  } finally {
    running = false;
  }
}

module.exports = { enqueue, list, stats, pump, validateUrl, analyzePdf };
