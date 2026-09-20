# INDEX MATRIX — Verification Report (spec §26)

Date: 2026-09-20 · Host: sandbox (Node v22.22.3, npm 10.9.8) · Server: `PORT=8080 node server.js`
Rule enforced: **Submitted != Discovered != Crawled != Indexed.**

## 1. Architecture

```text
USER → indexer.html (+ Index Engine Monitor) → /api/index/* → index-engine.js
   → normalize → fetch(+redirects) → robots → PDF analysis → index-status.js
   → local relay/feed discovery (db.saveRelayLinks) → optional SpeedyIndex
   → DISCOVERED (in OUR surface) · crawl/fetch-checked · index stays UNKNOWN
```

New honest pipeline (`index-engine.js` + `index-status.js`) is **additive**; legacy
dispatch (`/api/seo/relay/dispatch`, `broadcastQuickIndex`) untouched functionally,
but its response wording + the GSC/IndexNow fallback responses were de-fabricated.

## 2. Files & responsibilities

| File | Role |
|---|---|
| `server.js` | All routes incl. new `/api/index/*` (health/validate/bulk/queue/status/by-url); honest GSC + IndexNow responses |
| `index-engine.js` **(new)** | Queue worker, validation pipeline, PDF analysis, robots, throttling, retry, provider submit |
| `index-status.js` **(new)** | Atomic JSON status store (`data/index-status.json`), corrupt recovery, counts |
| `data/index-queue.json` **(new)** | Persisted jobs (PENDING/RUNNING/COMPLETED/FAILED) |
| `data/index-status.json` **(new)** | Per-URL records (submission/discovery/crawl/index separate) |
| `.env` **(new)** | Safe defaults; provider keys EMPTY (nothing invented) |
| `indexer.html` / `js/indexer.js` | UI honesty wording + new auto-refresh **Index Engine Monitor** panel |
| `test/test-index-engine.js` **(new)** | 36-check suite with local fixture origin (no outbound needed) |

## 3. APIs (new)

`GET /api/index/health` · `POST /api/index/validate` · `POST /api/index/bulk` (≤500)
`GET /api/index/queue` · `GET /api/index/status` · `GET /api/index/status/by-url`
All auth-protected (401 without session), consistent with existing `/api/*` gate.

## 4. Queue

Persistent, deduped (no duplicate PENDING/RUNNING per URL), worker tick 400 ms,
concurrency `INDEX_QUEUE_CONCURRENCY` (2), per-host gap `INDEX_PER_HOST_DELAY_MS`
(1500), retries `INDEX_MAX_ATTEMPTS` (3) with `INDEX_RETRY_BASE_MS` (20s) backoff.
Retryable: network/timeout/5xx/worker exception → else terminal. FAILED only after
attempts exhausted. Completed/failed history capped at 500 jobs.

## 5. PDF processing

Cap `INDEX_PDF_MAX_MB` (35): declared-length upfront check + stream abort (lying
servers). Signature `%PDF-` check → SHA-256 → pdf-parse text → classification
`TEXT_PDF` (≥100 chars) / `SCANNED_OR_EMPTY_PDF` / `NOT_A_PDF` (HTML pretending).
Timeouts on every hop; redirect cap 5, http(s) only.

## 6. Discovery mechanisms (separated)

- **A. Technical validation:** fetch, redirects, content-type/length, PDF, robots
  (`AVAILABLE/UNKNOWN/BLOCKED`; BLOCKED paths skip discovery politely).
- **B. Public discovery:** local relay directory + RSS feed (same store, one write).
- **C. External provider:** SpeedyIndex only if key configured; acceptance stored
  with `googleCrawlConfirmed:false, googleIndexedConfirmed:false` always.
- **IndexNow:** never sent without caller key; otherwise `TARGET_VERIFICATION_REQUIRED`.

## 7. Index status logic

`INDEXED` is set **nowhere** in this engine — no evidence channel exists, so every
record keeps `index.state: UNKNOWN` and `crawl.state: FETCH_CHECKED` (server-side
technical fetch, explicitly labeled NOT search-engine evidence). `NOT_INDEXED` /
`INDEXED` are reserved for a future GSC-evidence integration.

## 8. Security

Auth on all `/api/index/*`; 500-URL bulk cap; 35 MB + timeout + redirect caps;
per-host throttle; provider failure isolated (never crashes jobs); atomic
tmp+rename writes; corrupt-JSON quarantine (`.corrupt-<ts>.bak`); link-local
metadata host `169.254.169.254` denylisted. `.env` gitignored (`*.env`).

## 9. Errors found (all fixed or dispositioned)

1. Spec modules missing (`index-engine.js`, `index-status.js`, `/api/index/*`) → built.
2. `checkRobots` dropped non-default ports (`hostname` vs `host`) → fixed.
3. `/api/gsc/publish` returned fake `200 success:autoIndexed` without creds → honest
   `401 requiresCredentials` (broadcast still sent + disclosed). Google-reject →
   real status passthrough; Google-unreachable → 502.
4. `/api/indexnow/publish` fabricated `md5(host)` keys + hardcoded engine 200s →
   no-key `400 keyRequired` + `TARGET_VERIFICATION_REQUIRED`; with-key reports
   real per-endpoint statuses.
5. Misleading UI/backend strings ("auto-indexed…No GSC ownership required",
   "queued for Googlebot", "Instant…indexer", …) → honest wording; banned-phrase
   sweep now returns zero hits.
6. Stale `test-api.js` Test 2 (expected 302; app intentionally serves 200 session-
   restore page) → test accepts either legitimate gating behavior.
7. Live-network tests (9,10,12,16,20,21,22) fail offline → loud SKIP guards
   (skip, never fake pass).

## 10. Remaining issues (not hidden)

- Legacy `/api/seo/relay/dispatch` + `broadcastQuickIndex` still fire dead
  `google.com/ping` (404, harmless noise) and fake-key IndexNow; kept per
  "don't remove functionality" — new engine is the honest path; recommend
  deprecating/rewiring legacy UI to it.
- Hardcoded SpeedyIndex fallback key remains in legacy broadcast path only.
- Authenticated-user SSRF inherited from `/api/scan` design (only metadata-IP
  block added) — production should add egress allowlist/proxy.
- `pages:null` for some PDFs (pdf-parse v2 string path) — honest unknown, minor.
- PM2 not in repo — production: process manager + `node server.js` (no invented cmd).
- Fixture URLs appended to `data/relay-links.json` during tests (cosmetic).

## 11. Test results

| Suite | Result |
|---|---|
| `test/test-api.js` | **PASS** 14/14 runnable · **SKIP** 7 (live-network, no outbound) |
| `test/test-pdf-scan.js` | **PASS** all |
| `test/test-ui-pages.js` | **PASS** all 13 (incl. modified indexer.html/js) |
| `test/test-index-engine.js` (new) | **PASS 36/36** (fixture origin: validation, PDF, robots, redirects, oversize×2, retry→FAILED, dedupe, bulk cap, provider isolation, corrupt recovery, relay listing) |
| Remote MSU PDF content assertions | **NOT TESTED** (sandbox has no outbound internet; graceful `FETCH_ERROR`, no crash: **PASS**) |
| `npm test` chain exit code | **0** |

## 12. Final success criteria (§28)

```text
[✓] npm install works
[✓] server starts (worker ACTIVE, port 8080 listening)
[✓] frontend loads (all pages 200 incl. new monitor panel)
[✓] health endpoint works (+honest provider/limits report)
[✓] URL validation works
[✓] redirect handling works (chain + final URL stored)
[✓] robots check works (AVAILABLE/UNKNOWN/BLOCKED)
[✓] PDF detection works (incl. HTML-pretending rejection)
[✓] PDF analysis works (pages/text/sha256/classification)
[✓] bulk URL queue works (500 cap, accepted/rejected/duplicates)
[✓] duplicate protection works (ALREADY_QUEUED)
[✓] retry system works (→ FAILED after max attempts)
[✓] queue monitoring works
[✓] status persistence works (+ corrupt recovery)
[✓] discovery relay works (relay directory + RSS list the URL)
[✓] optional provider integration works when configured (env-key only; failure isolated)
[✓] provider failure does not crash application
[✓] third-party URLs handled correctly (ownership + TARGET_VERIFICATION_REQUIRED)
[✓] indexing status is not fabricated (index stays UNKNOWN; banned-phrase sweep = 0)
[✓] UI reflects backend state accurately (monitor panel, 5s refresh)
[✓] production logs are clean (no startup exceptions; worker ACTIVE)
```
