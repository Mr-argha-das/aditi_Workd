# PROJECT PROMPT — INDEX MATRIX (index-matrix v2.0.0)

> Copy-paste this entire document as context to any AI assistant or developer to make them instantly productive on this project.

---

## 1. What is this project?

**INDEX MATRIX** is a self-hosted, single-port (8080) **technical SEO automation suite + search-engine bot indexer**, built with **Node.js + Express (CommonJS) serving static HTML/CSS/JS pages**. It combines two product lines in one dashboard:

1. **SEO Audit Toolkit** — live web crawler, broken-link checker, keyword/PDF extractor, competitor gap analyzer, SEO health tracker, client reports.
2. **Bot Indexer / Dispatch Engine** — submits URLs to search-engine notification channels (Google Indexing API via service account, IndexNow, WebSub hubs, sitemap pings, SpeedyIndex third-party API) and tracks dispatch history.

**Brand/UI:** dark cyberpunk glassmorphism interface, Three.js cosmic login animation, SVG radial score gauges. All UI text is English; the end user communicates in Hinglish (Hindi + English).

## 2. What does the project want to achieve? (Goal / Vision)

- Give a single operator (and their clients) one login where they can **audit any website's SEO health** and **push URLs toward fast discovery/indexing by search engines**.
- Persist everything (users, scan history, dispatch logs, login events, relay/feed links) in **MongoDB Atlas when configured, else local JSON files** — the app must never crash for lack of a database.
- Provide an **Admin Control Center** with cross-user visibility (who scanned what, who dispatched what, who is online).
- Provide a **1-line JS pixel** (`seo-nexus-pixel.js`) that external sites embed to auto-inject Schema.org JSON-LD + meta tags served by this server.
- Provide a **CLI automation script** (`gsc-indexer-automation.js`) for headless Indexing API submissions.

## 3. Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, CommonJS (`"type": "commonjs"`) |
| Server | Express 5, single file `server.js` (~3200 lines) |
| DB | Mongoose 9 (optional `MONGO_URI`); fallback local JSON in `data/` — never hard-required |
| HTML parsing | cheerio; file upload: multer; PDF text: pdf-parse v2 |
| Security | HMAC-SHA256 signed session cookies + Bearer tokens, rate limiting (`express-rate-limit`), IP brute-force lock (5 fails → 15 min), localhost-only admin gate |
| Frontend | Vanilla HTML + CSS + JS, no framework, no build step |
| Deploy | `node server.js` locally / VPS; `vercel.json` + `api/index.js` stub exists for serverless (secondary) |
| Tests | `npm test` → `test/test-api.js` + `test/test-pdf-scan.js` + `test/test-ui-pages.js` (plain Node scripts) |

## 4. Repository map (all paths relative to repo root)

```
server.js                    # ENTIRE backend: middleware, auth, all /api routes, page serving (~3200 lines)
db.js                        # Persistence layer: Mongoose models + JSON-mirror fallback (~1100 lines)
login.html                   # Portal gatekeeper login/register (Three.js animation)
index.html                   # Main hub: live crawler + audit entry
indexer.html                 # BOT INDEXER UI: batch URL dispatch, relay feed hub, terminal log, history drawer
console.html                 # Google Search Console & Indexing API feeder (service-account key)
keywords.html                # Keyword extractor + PDF/document parser UI
audit.html                   # Technical SEO audit + Googlebot diagnostics
reports.html                 # SEO tag/schema/JSON-LD export center + printable client report
about.html                   # Platform info page
admin/admin.html             # Admin Control Center (users, activity, logs, presence)
device-restricted.html       # Shown when device gate blocks access
js/app.js                    # Shared frontend: auth fetch wrapper, session restore, cookieless nav (?st= token)
js/indexer.js                # Bot indexer frontend logic (~783 lines)
js/device-gatekeeper.js      # Device restriction enforcement
js/console-feeder.js         # GSC feeder frontend logic
js/pdf-parser.js             # Client-side PDF helpers
css/style.css                # Global styles
partials/footer.html         # Shared footer
gsc-indexer-automation.js    # CLI: node gsc-indexer-automation.js <URL> [URL_UPDATED|URL_DELETED]
seo-nexus-pixel.js           # Embeddable 1-line SEO injector for external sites
data/users.json              # User accounts (JSON fallback vault)
data/history.json            # Scan/audit history
data/dispatch-logs.json      # Bot dispatch logs
data/relay-links.json        # Relay feed-hub links (max 500, botPingCount tracked)
data/login-events.json       # Login/logout events
test/test-api.js | test-pdf-scan.js | test-ui-pages.js
.env.example / .env          # Env template + local secrets (MONGO_URI, SPEEDYINDEX_API_KEY, etc.)
vercel.json / api/index.js   # Serverless adapter (stub)
sitemap.xml / robots.txt     # Self SEO files; <md5>.txt = IndexNow key file served at /:key.txt
```

## 5. Backend API surface (all in `server.js`)

**Auth & users:** `POST /api/auth/login|register|logout`, `GET /api/auth/me|check`, `GET|PUT /api/user/profile`
**Audit toolkit:** `POST /api/scan` (live crawler), `POST /api/links/check` (broken links), `POST /api/upload-file` (PDF/DOCX/TXT/CSV/JSON keyword NLP extract), `POST /api/keywords/compare` (competitor gap), `POST /api/sitemap/extract` (child-URL extractor)
**Indexing/dispatch:** `POST /api/crawler/ping` (per-URL multi-pillar broadcast), `POST /api/gsc/publish` (real OAuth2 service-account → Google Indexing API), `POST /api/gsc/inspect` (URL inspection), `POST /api/indexnow/publish`, `POST /api/seo/relay/dispatch` (main batch broadcast: WebSub + SpeedyIndex + Googlebot probe + IndexNow + Bing/Yandex/Ping-O-Matic fire-and-forget; writes relay hub + dispatch log), `GET /api/seo/relay/directory`, `POST /api/seo/relay/clear`, public `GET /api/seo/indexing-hub.html` (link directory) + `/api/seo/indexing-feed.xml` (RSS feed)
**GSC config:** `POST /api/gsc/verify-sa`, `GET|POST /api/gsc/credentials`, `GET|POST|DELETE /api/project/active`
**History/logs:** `GET|POST /api/history`, `DELETE /api/history/:id`, `POST /api/history/clear-all`, `GET /api/history/timeline`, `GET /api/logs`, `POST /api/logs/clear`
**Admin (localhost + admin role):** `/admin/*` pages + `/admin/api/users|activity|logs|history`
**Pixel/presence:** `GET /seo-nexus-pixel.js`, `GET /api/pixel/config`, `POST /api/presence/ping`, `GET /api/config`

## 6. Auth model (IMPORTANT — recently fixed)

- Sessions = HMAC-signed tokens. Server sets cookie via `buildSessionCookie()` helper.
- **Cookie-less fallback (`?st=` token):** because the app preview runs in a cross-site iframe where cookies are blocked, login redirects to `/index.html?st=<token>`; `getAuthenticatedUser()` accepts the token from query string on GET; `js/app.js` strips it, stores in `localStorage`, attaches `Authorization: Bearer` on API calls, and re-appends `?st=` to internal links when cookies are unavailable (`cleanSessionTokenFromUrl`, `installCookielessNav`).
- Never break this flow: any new protected page must work with both cookie AND `?st=`/Bearer auth.

## 7. Data layer (`db.js`)

- Mongoose models: `User, History, DispatchLog, LoginEvent, RelayLink`. Every write also mirrors to `data/*.json` (RelayLink capped at 500, deduped with `botPingCount++`).
- `MONGO_URI` absent/offline → app runs fully on JSON vault. Code must keep this dual-write behavior.

## 8. How to run

```bash
cd /home/user/aditi_Workd
npm install
PORT=8080 node server.js      # → http://localhost:8080
npm test                      # api + pdf + ui page tests
```

- Test account: `demo_user` / `demo1234` (role `user`). (README's `matrix_master/nexus2026` does NOT exist — do not rely on it.)
- Env knobs: `PORT`, `MONGO_URI`, `SPEEDYINDEX_API_KEY` (or `INDEXER_API_KEY`), `SESSION_SECRET`.

## 9. Current state & KNOWN ISSUES (do not regress; fix only when asked)

1. **Dead pillar — Google sitemap ping:** `https://www.google.com/ping?sitemap=...` was deprecated by Google end-2023 (returns 404, does nothing). Code still fires it in `broadcastQuickIndex()` and reports success. It also pings only a *guessed* `<origin>/sitemap.xml`, never the user's actual URL.
2. **Invalid IndexNow submissions:** key is `md5(hostname)` with `keyLocation` pointing to a key file that does not exist on the target domain → Bing/Yandex reject verification. Only works if the key file is genuinely hosted.
3. **Optimistic/false reporting:** several pillars are fire-and-forget (`.catch(()=>{})`, hardcoded `indexNowStatus: 200`, `bingPingSuccess = true` without reading responses). UI says "success" when only "request sent" is true. The Googlebot "probe" is just the server fetching the URL with a Googlebot UA — it notifies Google of nothing.
4. **Hardcoded SpeedyIndex API key** (`6bb27cdf…`) appears as fallback in ~3 places in `server.js` — should come only from env.
5. **WebSub/Superfeedr/Yandex-blogs/Ping-O-Matic** pings are meaningless for arbitrary PDF/URL indexing (no subscribers / blog-only services) but are reported as pillars.
6. No headless-browser testing available in sandbox (Playwright install fails); server has no outbound internet in sandbox (curl returns 000) — verify network-dependent code by reading, not by live fetch.
7. Dead legacy code in `js/indexer.js`: `switchIndexerMode` / `runBatchDispatch` (~lines 418–575) are unused.

## 10. Coding conventions for any AI working here

- Backend lives in ONE file (`server.js`); put new endpoints there following existing style (async handlers, JSON responses, `AbortSignal.timeout` on outbound fetch).
- Frontend is vanilla JS, no build; shared auth logic belongs in `js/app.js`.
- Keep Mongo ↔ JSON dual-write in `db.js` for any new persisted entity.
- All user-facing dashboard strings stay English; explain work to the operator in Hinglish.
- Do not add npm dependencies without asking. Do not commit secrets. Branch: `arena/01a0bb97-aditi-workd`.
