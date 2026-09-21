/** INDEX MATRIX - Observable Index Status Store */
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'index-status.json');
const MAX_RECORDS = 10000;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, '[]', 'utf8');
}
function readStore() {
  ensureStore();
  try {
    const v = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function writeStore(records) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(records.slice(0, MAX_RECORDS), null, 2), 'utf8');
}
function normalizeUrl(url) {
  try { return new URL(String(url).trim()).toString(); } catch (e) { return String(url || '').trim(); }
}
function now() { return new Date().toISOString(); }

function upsert(url, patch) {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  const records = readStore();
  let r = records.find(x => x.url === normalized);
  if (!r) {
    r = {
      id: 'idx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      url: normalized,
      type: patch.type || 'URL',
      submissionStatus: 'RECEIVED',
      discoveryStatus: 'NOT_SUBMITTED',
      crawlStatus: 'UNKNOWN',
      indexStatus: 'UNKNOWN',
      searchVisible: 'UNKNOWN',
      createdAt: now(),
      updatedAt: now(),
      events: []
    };
    records.unshift(r);
  }
  Object.assign(r, patch, { url: normalized, updatedAt: now() });
  if (!Array.isArray(r.events)) r.events = [];
  if (patch.event) {
    r.events.unshift({
      at: now(),
      type: patch.event.type || 'STATUS',
      message: patch.event.message || '',
      evidence: patch.event.evidence || null
    });
    r.events = r.events.slice(0, 50);
  }
  writeStore(records);
  return r;
}

function markReceived(url, meta = {}) {
  return upsert(url, {
    type: meta.type || 'URL',
    submissionStatus: 'RECEIVED',
    discoveryStatus: 'NOT_SUBMITTED',
    event: { type: 'RECEIVED', message: 'URL accepted by INDEX MATRIX.' }
  });
}

function markValidated(url, meta = {}) {
  return upsert(url, {
    type: meta.type || 'URL',
    submissionStatus: meta.ok === false ? 'VALIDATION_FAILED' : 'VALIDATED',
    validation: {
      ok: meta.ok !== false,
      httpStatus: meta.httpStatus ?? null,
      contentType: meta.contentType || null,
      contentLength: meta.contentLength ?? null,
      finalUrl: meta.finalUrl || url,
      redirectCount: meta.redirectCount ?? 0,
      robotsAllowed: meta.robotsAllowed ?? null,
      checkedAt: now(),
      error: meta.error || null
    },
    event: {
      type: meta.ok === false ? 'VALIDATION_FAILED' : 'VALIDATED',
      message: meta.ok === false ? (meta.error || 'Technical URL validation failed.') : 'Technical URL validation completed.',
      evidence: {
        httpStatus: meta.httpStatus ?? null,
        contentType: meta.contentType || null,
        robotsAllowed: meta.robotsAllowed ?? null
      }
    }
  });
}

function markReferencePublished(url, meta = {}) {
  return upsert(url, {
    referencePage: {
      id: meta.id || null,
      url: meta.url || null,
      publishedAt: meta.publishedAt || now()
    },
    event: {
      type: 'REFERENCE_PAGE_PUBLISHED',
      message: 'Public reference page published for discovery.',
      evidence: { url: meta.url || null }
    }
  });
}

function markWebAnalysis(url, analysis = {}) {
  return upsert(url, {
    web: analysis,
    event: {
      type: 'WEB_ANALYSIS',
      message: 'HTML metadata and text signals extracted.',
      evidence: {
        title: analysis.title || null,
        canonical: analysis.canonical || null,
        robots: analysis.robots || null
      }
    }
  });
}

function markDiscoverySubmitted(url, channels = []) {
  return upsert(url, {
    submissionStatus: 'DISCOVERY_SUBMITTED',
    discoveryStatus: 'DISCOVERY_PENDING',
    discovery: { channels: Array.isArray(channels) ? channels : [], submittedAt: now() },
    event: {
      type: 'DISCOVERY_SUBMITTED',
      message: 'Discovery signals were submitted. This does not prove crawler discovery.',
      evidence: { channels: Array.isArray(channels) ? channels : [] }
    }
  });
}

function markCrawlChecked(url, meta = {}) {
  return upsert(url, {
    crawlStatus: meta.googlebotUserAgent ? 'FETCH_CHECKED_NOT_GOOGLEBOT_EVIDENCE' : 'FETCH_CHECKED',
    crawlCheck: {
      httpStatus: meta.httpStatus ?? null,
      finalUrl: meta.finalUrl || url,
      contentType: meta.contentType || null,
      checkedAt: now()
    },
    event: {
      type: 'CRAWL_CHECK',
      message: meta.googlebotUserAgent
        ? 'Server fetched the URL using a Googlebot-like User-Agent. This is not evidence that Googlebot made the request.'
        : 'Server fetch completed. This is not evidence of a search-engine crawl.',
      evidence: { httpStatus: meta.httpStatus ?? null, userAgent: meta.googlebotUserAgent ? 'googlebot-like' : 'server' }
    }
  });
}

function markUnknownIndex(url, reason) {
  return upsert(url, {
    indexStatus: 'UNKNOWN',
    event: { type: 'INDEX_STATUS', message: reason || 'No independent indexing evidence available.' }
  });
}

function markIndexEvidence(url, evidence = {}) {
  const status = evidence.indexed === true ? 'INDEXED' : evidence.indexed === false ? 'NOT_INDEXED' : 'UNKNOWN';
  return upsert(url, {
    indexStatus: status,
    indexEvidence: { ...evidence, checkedAt: now() },
    event: {
      type: 'INDEX_STATUS_EVIDENCE',
      message: evidence.source ? `Index status recorded from: ${evidence.source}` : 'Index status evidence recorded.',
      evidence
    }
  });
}

function markPdfAnalysis(url, analysis) {
  return upsert(url, {
    type: 'PDF',
    pdf: analysis,
    event: {
      type: 'PDF_ANALYSIS',
      message: analysis.valid ? 'PDF validated and analyzed.' : 'PDF analysis failed.',
      evidence: {
        valid: !!analysis.valid,
        pages: analysis.pages ?? null,
        textLength: analysis.textLength ?? 0,
        sha256: analysis.sha256 || null
      }
    }
  });
}

function markDiscoveryEvidence(url, evidence) {
  return upsert(url, {
    discoveryStatus: 'DISCOVERED',
    discoveryEvidence: { ...evidence, checkedAt: now() },
    event: { type: 'DISCOVERED', message: 'Independent discovery evidence recorded.', evidence }
  });
}

function get(url) {
  const normalized = normalizeUrl(url);
  return readStore().find(r => r.url === normalized) || null;
}
function list({ limit = 100, status = '' } = {}) {
  let records = readStore();
  if (status) records = records.filter(r => r.submissionStatus === status || r.discoveryStatus === status || r.crawlStatus === status || r.indexStatus === status);
  return records.slice(0, Math.min(Math.max(Number(limit) || 100, 1), 1000));
}
function stats() {
  const records = readStore();
  return {
    total: records.length,
    received: records.filter(r => r.submissionStatus === 'RECEIVED').length,
    validated: records.filter(r => r.submissionStatus === 'VALIDATED').length,
    discoverySubmitted: records.filter(r => r.submissionStatus === 'DISCOVERY_SUBMITTED').length,
    discoveryPending: records.filter(r => r.discoveryStatus === 'DISCOVERY_PENDING').length,
    discovered: records.filter(r => r.discoveryStatus === 'DISCOVERED').length,
    crawlChecked: records.filter(r => String(r.crawlStatus || '').includes('FETCH_CHECKED')).length,
    indexed: records.filter(r => r.indexStatus === 'INDEXED').length,
    notIndexed: records.filter(r => r.indexStatus === 'NOT_INDEXED').length,
    unknownIndex: records.filter(r => r.indexStatus === 'UNKNOWN').length
  };
}
module.exports = { markReceived, markValidated, markReferencePublished, markWebAnalysis, markDiscoverySubmitted, markCrawlChecked, markUnknownIndex, markIndexEvidence, markPdfAnalysis, markDiscoveryEvidence, get, list, stats };
