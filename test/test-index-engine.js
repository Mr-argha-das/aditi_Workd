/**
 * INDEX MATRIX — Index Engine verification suite (test/test-index-engine.js)
 *
 * Covers the spec: health, queue, validation, PDF workflow, bulk, third-party
 * handling, discovery honesty, retry/FAILED, error cases, persistence recovery.
 *
 * NOTE: this sandbox has NO outbound internet, so all remote-origin behavior is
 * tested against a local fixture server (127.0.0.1). Truly-remote assertions
 * are marked NOT TESTED (environment limitation) in the final report.
 *
 * Requires: server running on PORT (default http://localhost:8080) with the
 * demo_user/demo1234 account present.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = process.env.TEST_BASE || 'http://localhost:8080';
const results = [];
function verdict(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// ---------------- fixture origin server ----------------
function buildPdf(lines) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let stream = 'BT /F1 18 Tf 72 720 Td (' + esc(lines[0]) + ') Tj';
  for (let i = 1; i < lines.length; i++) stream += ' 0 -24 Td (' + esc(lines[i]) + ') Tj';
  stream += ' ET';
  const objs = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  };
  let pdf = '%PDF-1.4\n';
  const off = [0];
  for (let i = 1; i <= 5; i++) { off[i] = Buffer.byteLength(pdf); pdf += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  const xp = Buffer.byteLength(pdf);
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) pdf += String(off[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xp + '\n%%EOF';
  return Buffer.from(pdf, 'latin1');
}
const PDF_LINES = [
  'Hello Index Matrix validation world.',
  'This sample PDF tests the honest indexing pipeline.',
  'Line three adds more extractable text content here.',
  'Line four ensures we cross one hundred characters total.',
  'Final line for good measure and padding text.'
];

function startFixture() {
  return new Promise(resolve => {
    const pdfBuf = buildPdf(PDF_LINES);
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/sample.pdf' || u.pathname === '/blocked.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfBuf.length });
        return res.end(pdfBuf);
      }
      if (u.pathname === '/redirect') {
        res.writeHead(302, { Location: '/sample.pdf' });
        return res.end();
      }
      if (u.pathname === '/html-as.pdf') {
        const b = '<html><body>not a pdf at all</body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(b) });
        return res.end(b);
      }
      if (u.pathname === '/page.html') {
        const b = '<html><head><title>t</title></head><body>hello page</body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(b) });
        return res.end(b);
      }
      if (u.pathname === '/robots.txt') {
        const b = 'User-agent: *\nDisallow: /blocked\n';
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(b) });
        return res.end(b);
      }
      if (u.pathname === '/big.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': 40 * 1024 * 1024 });
        res.write(Buffer.alloc(1024, 0x25));
        return; // hold open: client must see declared length -> OVERSIZED
      }
      if (u.pathname === '/lies.pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' }); // no length: lying streamer
        for (let i = 0; i < 30; i++) res.write(Buffer.alloc(10240, 0x41));
        return res.end();
      }
      if (u.pathname === '/slow') {
        const t = setTimeout(() => { try { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('late'); } catch (e) {} }, 25000);
        req.on('close', () => clearTimeout(t));
        return;
      }
      if (u.pathname === '/flaky-500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        return res.end('boom');
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('nope');
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, origin: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// ---------------- http helpers ----------------
async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const { srv, origin } = await startFixture();
  console.log(`Fixture origin: ${origin}`);
  let token = null;
  try {
    // 1. auth gate
    let r = await api('GET', '/api/index/health');
    verdict('health requires auth (401 without token)', r.status === 401, `http=${r.status}`);

    // 2. login
    r = await api('POST', '/api/auth/login', { username: 'demo_user', password: 'demo1234' });
    token = r.json.token || r.json.session || null;
    verdict('login demo_user works', r.status === 200 && !!token, `http=${r.status}`);

    // 3. health content
    r = await api('GET', '/api/index/health', null, token);
    const h = r.json || {};
    verdict('health ok + worker running', r.status === 200 && h.ok === true && h.worker && h.worker.running === true);
    verdict('health reports provider NOT configured (no key invented)', h.provider && h.provider.speedyindex && h.provider.speedyindex.configured === false, JSON.stringify(h.provider));
    verdict('health exposes limits + queue + status', !!(h.limits && h.queue && h.status), `limits=${JSON.stringify(h.limits)}`);

    const U = p => origin + p;

    // 4. PDF workflow via validate
    r = await api('POST', '/api/index/validate', { url: U('/sample.pdf') }, token);
    const rec = r.json.record || {};
    verdict('validate PDF -> VALIDATED', r.status === 200 && rec.state === 'VALIDATED', `state=${rec.state}`);
    verdict('pdf detected TEXT_PDF + sha256', rec.pdf && rec.pdf.isPdf === true && rec.pdf.classification === 'TEXT_PDF' && /^[0-9a-f]{64}$/.test(rec.pdf.sha256 || ''), `pdf=${JSON.stringify(rec.pdf)}`);
    verdict('robots AVAILABLE + ownership SELF (test rig)', rec.validation && rec.validation.robots && rec.validation.robots.state === 'AVAILABLE' && rec.ownership === 'SELF', `robots=${JSON.stringify(rec.validation && rec.validation.robots)} owner=${rec.ownership}`);
    verdict('honest states: crawl FETCH_CHECKED, index UNKNOWN, discovery NOT_SUBMITTED',
      rec.crawl && rec.crawl.state === 'FETCH_CHECKED' && rec.index && rec.index.state === 'UNKNOWN' && rec.discovery && rec.discovery.state === 'NOT_SUBMITTED',
      `crawl=${rec.crawl && rec.crawl.state} index=${rec.index && rec.index.state} disco=${rec.discovery && rec.discovery.state}`);

    // 5. invalid inputs
    r = await api('POST', '/api/index/validate', { url: 'hello' }, token);
    verdict("invalid 'hello' -> 400 INVALID_URL", r.status === 400 && r.json.error === 'INVALID_URL', JSON.stringify(r.json));
    r = await api('POST', '/api/index/validate', { url: 'ftp://example.com/file.pdf' }, token);
    verdict('ftp:// -> 400 UNSUPPORTED_PROTOCOL', r.status === 400 && r.json.error === 'UNSUPPORTED_PROTOCOL', JSON.stringify(r.json));

    // 6. 404 / html-as-pdf / oversized / redirect / robots-blocked
    r = await api('POST', '/api/index/validate', { url: U('/404') }, token);
    verdict('404 -> VALIDATED with httpStatus 404 (finding, not crash)', r.json.record && r.json.record.state === 'VALIDATED' && r.json.record.validation.httpStatus === 404, `state=${r.json.record && r.json.record.state}`);
    r = await api('POST', '/api/index/validate', { url: U('/html-as.pdf') }, token);
    verdict('HTML pretending PDF -> NOT_A_PDF', r.json.record && r.json.record.pdf && r.json.record.pdf.isPdf === false && r.json.record.pdf.classification === 'NOT_A_PDF', `pdf=${JSON.stringify(r.json.record && r.json.record.pdf)}`);
    r = await api('POST', '/api/index/validate', { url: U('/big.pdf') }, token);
    verdict('oversized (40MB declared) -> FETCH_ERROR OVERSIZED', r.json.record && r.json.record.state === 'FETCH_ERROR' && /OVERSIZED/.test(r.json.record.lastError || ''), `state=${r.json.record && r.json.record.state} err=${r.json.record && r.json.record.lastError}`);
    r = await api('POST', '/api/index/validate', { url: U('/redirect') }, token);
    const rr = r.json.record || {};
    verdict('redirect followed, final URL stored', rr.validation && rr.validation.redirects && rr.validation.redirects.length === 1 && (rr.validation.finalUrl || '').endsWith('/sample.pdf'), `final=${rr.validation && rr.validation.finalUrl}`);
    r = await api('POST', '/api/index/validate', { url: U('/blocked.pdf') }, token);
    verdict('robots-disallowed path -> BLOCKED', r.json.record && r.json.record.state === 'BLOCKED', `state=${r.json.record && r.json.record.state}`);

    // 7. bulk: accepted/rejected/duplicates
    const batch = [U('/sample.pdf'), U('/page.html'), 'hello', 'ftp://example.com/f.pdf', U('/sample.pdf')];
    r = await api('POST', '/api/index/bulk', { urls: batch }, token);
    verdict('bulk counts accepted=2 rejected=2 duplicates=1',
      r.json.counts && r.json.counts.accepted === 2 && r.json.counts.rejected === 2 && r.json.counts.duplicates === 1, JSON.stringify(r.json.counts));
    const r2 = await api('POST', '/api/index/bulk', { urls: [U('/sample.pdf'), U('/page.html')] }, token);
    verdict('immediate re-bulk -> ALREADY_QUEUED (no dup active jobs)',
      r2.json.counts && r2.json.counts.accepted === 0 && (r2.json.duplicates || []).every(d => d.reason === 'ALREADY_QUEUED'), JSON.stringify(r2.json.counts));
    const big = Array.from({ length: 501 }, (_, i) => `http://example.com/${i}`);
    const r3 = await api('POST', '/api/index/bulk', { urls: big }, token);
    verdict('bulk cap 500 enforced', r3.status === 400, `http=${r3.status}`);

    // 8. queue endpoint + drain
    r = await api('GET', '/api/index/queue', null, token);
    verdict('queue endpoint exposes pending/running/completed/failed',
      r.status === 200 && ['pending', 'running', 'completed', 'failed'].every(k => typeof r.json[k] === 'number'), JSON.stringify({ p: r.json.pending, r: r.json.running, c: r.json.completed, f: r.json.failed }));
    let drained = false;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      const q = await api('GET', '/api/index/queue?limit=5', null, token);
      if (q.json.pending === 0 && q.json.running === 0) { drained = true; break; }
    }
    verdict('worker drains queue (pending+running -> 0)', drained);

    // 9. discovery honesty on completed record
    r = await api('GET', '/api/index/status/by-url?url=' + encodeURIComponent(U('/sample.pdf')), null, token);
    const done = r.json.record || {};
    const prov = (done.discovery && done.discovery.provider) || {};
    const inx = (done.discovery && done.discovery.indexnow) || {};
    verdict('completed job -> DISCOVERED via local relay/feed', done.state === 'DISCOVERED' && done.discovery && done.discovery.relayListed === true, `state=${done.state} relay=${done.discovery && done.discovery.relayListed}`);
    verdict('provider recorded NOT_CONFIGURED, google flags false', prov.reason === 'PROVIDER_NOT_CONFIGURED' && prov.googleCrawlConfirmed === false && prov.googleIndexedConfirmed === false, JSON.stringify(prov));
    verdict('indexnow TARGET_VERIFICATION_REQUIRED (no fake key)', inx.state === 'TARGET_VERIFICATION_REQUIRED', JSON.stringify(inx));
    verdict('index stays UNKNOWN (nothing fabricated)', done.index && done.index.state === 'UNKNOWN', `index=${done.index && done.index.state}`);
    const relay = await api('GET', '/api/seo/relay/directory?limit=200');
    const relayTxt = JSON.stringify(relay.json);
    verdict('relay directory (public discovery surface) lists final URL', relay.status === 200 && relayTxt.includes(U('/sample.pdf')), `http=${relay.status}`);

    // 10. status list + unknown lookup
    r = await api('GET', '/api/index/status?limit=10', null, token);
    verdict('status list + counts', r.status === 200 && r.json.total >= 2 && r.json.counts && r.json.counts.validated >= 1, `total=${r.json.total}`);
    r = await api('GET', '/api/index/status/by-url?url=' + encodeURIComponent('http://127.0.0.1:1/never-seen'), null, token);
    verdict('unknown URL lookup -> 404 honest', r.status === 404, `http=${r.status}`);

    // 11. remote URL graceful handling (content assertions NOT TESTED here — no outbound net)
    r = await api('POST', '/api/index/validate', { url: 'http://www.egr.msu.edu/decs/sites/default/files/webform/poster_print_request/_sid_/nainaxcvv-renew-2.pdf' }, token);
    const remote = r.json.record || {};
    verdict('remote URL handled gracefully (FETCH_ERROR, server alive)', r.status === 200 && (remote.state === 'FETCH_ERROR' || remote.state === 'VALIDATED'), `state=${remote.state} err=${remote.lastError}`);

    // ---- direct engine tests (fast env-tuned) ----
    const engine = require('../index-engine');
    const statusStore = require('../index-status');

    process.env.INDEX_FETCH_TIMEOUT_MS = '1200';
    process.env.INDEX_MAX_ATTEMPTS = '2';
    process.env.INDEX_RETRY_BASE_MS = '200';
    const mkJob = (p) => ({ id: 'direct-' + Math.random().toString(36).slice(2), url: U(p), normalizedUrl: U(p), host: '127.0.0.1', attempts: 0, maxAttempts: 2, source: 'direct-test' });
    let o1 = await engine.processJob(mkJob('/slow'));
    verdict('timeout attempt 1 -> RETRY', o1.outcome === 'RETRY', o1.error);
    const j2 = mkJob('/slow'); j2.attempts = 1;
    let o2 = await engine.processJob(j2);
    verdict('timeout attempt 2 (max) -> FAILED', o2.outcome === 'FAILED', o2.error);
    let o3 = await engine.processJob(mkJob('/flaky-500'));
    verdict('HTTP 500 -> RETRY (transient)', o3.outcome === 'RETRY', o3.error);

    process.env.INDEX_PDF_MAX_MB = '0.05';
    const lie = await engine.validateOnce(U('/lies.pdf'), 'direct-test');
    verdict('lying streamer (no length, huge body) -> OVERSIZED', lie.ok && lie.record.state === 'FETCH_ERROR' && /OVERSIZED/.test(lie.record.lastError || ''), lie.ok && lie.record.lastError);
    delete process.env.INDEX_PDF_MAX_MB;

    process.env.SPEEDYINDEX_API_KEY = 'bogus-key-for-test';
    const pj = await engine.processJob(mkJob('/page.html'));
    const pjRec = statusStore.getByUrl(U('/page.html'));
    const pjProv = (pjRec.discovery && pjRec.discovery.provider) || {};
    verdict('provider failure isolated: job COMPLETED + honest provider record',
      pj.outcome === 'COMPLETED' && pjProv.accepted === false && /PROVIDER_REQUEST_FAILED/.test(pjProv.error || ''), JSON.stringify(pjProv));
    delete process.env.SPEEDYINDEX_API_KEY;
    delete process.env.INDEX_FETCH_TIMEOUT_MS;
    delete process.env.INDEX_MAX_ATTEMPTS;
    delete process.env.INDEX_RETRY_BASE_MS;

    // 12. persistence recovery
    const statusFile = path.join(__dirname, '..', 'data', 'index-status.json');
    const backup = fs.readFileSync(statusFile, 'utf8');
    fs.writeFileSync(statusFile, '{corrupt!!!');
    const c = statusStore.counts();
    const bakExists = fs.readdirSync(path.join(__dirname, '..', 'data')).some(f => f.startsWith('index-status.json.corrupt-'));
    verdict('corrupt status file recovered (fresh store + .bak quarantine)', c.total === 0 && bakExists === true, `total=${c.total} bak=${bakExists}`);
    fs.writeFileSync(statusFile, backup);
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'data'))) {
      if (f.startsWith('index-status.json.corrupt-')) fs.unlinkSync(path.join(__dirname, '..', 'data', f));
    }
    verdict('queue + status files exist on disk', fs.existsSync(statusFile) && fs.existsSync(path.join(__dirname, '..', 'data', 'index-queue.json')));
  } catch (err) {
    verdict('SUITE EXCEPTION: ' + err.message, false, err.stack.split('\n').slice(0, 3).join(' | '));
  } finally {
    srv.close();
  }

  const fails = results.filter(r => !r.pass);
  console.log(`\n===== ${results.length - fails.length}/${results.length} passed =====`);
  process.exit(fails.length ? 1 : 0);
})();
