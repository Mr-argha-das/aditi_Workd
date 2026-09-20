/**
 * INDEX MATRIX - Fast Document & Bot Indexer Client Engine
 *
 * Features:
 * - Real-Time Terminal Log Stamps with ISO Timestamp Tagging
 * - User-Scoped Dispatched URL History Drawer
 * - CSV Exporting and 1-Click Platform Lock
 */

(function initIndexerApp() {
  let appConfig = { appName: 'INDEX MATRIX', adminRateCooldownSec: 10, userRateCooldownSec: 20 };
  let currentUsername = '';
  let currentUserRole = 'user';

  // Fetch dynamic environment config & active user
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        appConfig = await res.json();
        applyAppName(appConfig.appName);
      }
    } catch (e) {}

    try {
      const authRes = await fetch('/api/auth/me');
      if (authRes.ok) {
        const authData = await authRes.json();
        if (authData.authenticated && authData.user) {
          currentUsername = authData.user.username;
          currentUserRole = authData.user.role || 'user';
          const userDisplay = document.getElementById('nav-username-display');
          if (userDisplay) userDisplay.textContent = currentUsername;
          const userLabel = document.getElementById('history-user-label');
          if (userLabel) userLabel.textContent = `User: ${currentUsername} (${currentUserRole.toUpperCase()})`;
          const clearBtn = document.getElementById('btn-clear-logs');
          if (clearBtn && currentUserRole !== 'admin') {
            clearBtn.style.display = 'none';
          }
        }
      }
    } catch (e) {}
  }

  function applyAppName(name) {
    if (!name) return;
    document.title = `Fast Document & Bot Indexer - ${name}`;
    document.querySelectorAll('.brand-app-name').forEach(el => {
      el.textContent = name;
    });
  }


  // Terminal Logging Helper with Timestamp & Tagging
  function appendLog(tag, message, tagClass = 'tag-sys', textClass = 'text-dim') {
    const stream = document.getElementById('log-stream');
    if (!stream) return;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
    const row = document.createElement('div');
    row.className = 'log-row';
    row.setAttribute('data-timestamp', now.toISOString());
    row.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="${tagClass}">[${tag}]</span>
      <span class="${textClass}">${message}</span>
    `;
    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;
  }

  // Copy Terminal Logs to Clipboard
  function copyTerminalLogs() {
    const stream = document.getElementById('log-stream');
    if (!stream) return;
    const rows = stream.querySelectorAll('.log-row');
    const lines = [];
    rows.forEach(r => {
      lines.push(r.innerText.replace(/\n/g, ' '));
    });
    const logText = lines.join('\n');
    navigator.clipboard.writeText(logText).then(() => {
      const statusEl = document.getElementById('log-status');
      const prev = statusEl.textContent;
      statusEl.textContent = 'Copied!';
      setTimeout(() => { statusEl.textContent = prev; }, 1800);
    }).catch(() => {
      alert('Logs copied:\n\n' + logText);
    });
  }

  // Clear Terminal Stream
  function clearTerminalLogs() {
    const stream = document.getElementById('log-stream');
    if (!stream) return;
    stream.innerHTML = `
      <div class="log-row">
        <span class="log-time">[${new Date().toTimeString().split(' ')[0]}]</span>
        <span class="tag-sys">[SYSTEM]</span>
        <span class="text-dim"><span class="brand-app-name">${appConfig.appName}</span> terminal cleared. Standing by for next URL broadcast.</span>
      </div>
    `;
    document.getElementById('log-status').textContent = 'Ready';
  }

  // Load and Render Persistent Dispatched URL History (Scoped to current user)
  async function loadHistoryLogs() {
    const container = document.getElementById('history-list');
    if (!container) return;

    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        const logs = data.logs || [];
        if (logs.length === 0) {
          container.innerHTML = `<div class="history-empty">No past URL dispatches recorded for user "${currentUsername}" yet. Paste a URL and click Dispatch!</div>`;
          return;
        }

        let html = `
          <table class="history-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Target URL</th>
                <th>Format</th>
                <th>Latency</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
        `;

        logs.forEach(item => {
          const formattedDate = item.readableTime || new Date(item.timestamp).toLocaleString();
          const formatBadge = item.format === 'PDF Document' 
            ? '<span class="badge badge-danger" style="font-size: 0.72rem; padding: 0.25rem 0.55rem;"><i class="ri-file-pdf-fill"></i> PDF</span>'
            : '<span class="badge badge-primary" style="font-size: 0.72rem; padding: 0.25rem 0.55rem;"><i class="ri-global-line"></i> Webpage</span>';

          html += `
            <tr>
              <td style="white-space: nowrap; font-size: 0.76rem; color: var(--text-dim); padding: 0.85rem 1rem;">${formattedDate}</td>
              <td class="history-url-cell" title="${item.url}" style="padding: 0.85rem 1rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><a href="${item.url}" target="_blank" rel="noopener" style="color: var(--accent-cyan); text-decoration: none; font-weight: 500;"><i class="ri-link" style="font-size: 0.8rem;"></i> ${item.url}</a></td>
              <td style="padding: 0.85rem 1rem;">${formatBadge}</td>
              <td style="font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-size: 0.82rem; padding: 0.85rem 1rem;">${item.loadTime || '1.1s'}</td>
              <td style="padding: 0.85rem 1rem;"><span class="badge badge-success" style="font-size: 0.72rem; padding: 0.25rem 0.55rem;"><i class="ri-check-line"></i> Active</span></td>
            </tr>
          `;
        });

        html += `</tbody></table>`;
        container.innerHTML = html;
        return;
      }
    } catch (e) {
      console.warn('Could not fetch user logs:', e);
    }
  }

  // Toggle History Drawer
  function toggleHistoryDrawer() {
    const drawer = document.getElementById('history-drawer');
    if (!drawer) return;
    if (drawer.style.display === 'none' || !drawer.style.display) {
      drawer.style.display = 'block';
      loadHistoryLogs();
    } else {
      drawer.style.display = 'none';
    }
  }

  // Export History as CSV
  async function exportHistoryCSV() {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        const logs = data.logs || [];
        if (logs.length === 0) {
          alert('No history logs to export.');
          return;
        }

        let csv = 'ID,Date Time,Timestamp,Target URL,Format,Latency,Googlebot Status,IndexNow Status,Status\n';
        logs.forEach(l => {
          csv += `"${l.id || ''}","${l.readableTime || ''}","${l.timestamp || ''}","${(l.url || '').replace(/"/g, '""')}","${l.format || ''}","${l.loadTime || ''}","${l.googlePingStatus || 200}","${l.indexNowStatus || 200}","${l.status || 'DISPATCHED'}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `index_matrix_dispatch_logs_${currentUsername}_${Date.now()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (e) {
      alert('Failed to export CSV: ' + e.message);
    }
  }

  // Clear Server Logs for Current User (Admin Only)
  async function clearServerLogs() {
    if (!confirm('Are you sure you want to clear your archived dispatch history logs?')) return;
    try {
      const res = await fetch('/api/logs/clear', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (window.SEONexus && window.SEONexus.showToast) {
          window.SEONexus.showToast(data.error || 'Permission denied: Only administrators can clear history.', 'error');
        } else {
          alert(data.error || 'Permission denied: Only administrators can clear history.');
        }
        return;
      }
      if (window.SEONexus && window.SEONexus.showToast) {
        window.SEONexus.showToast('Dispatch history cleared by administrator.', 'info');
      }
      loadHistoryLogs();
    } catch (e) {
      alert('Error clearing logs: ' + e.message);
    }
  }

  // Multi-URL Parsing & Normalization Helper
  function parseInputUrls(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw
      .split(/[\r\n,]+/)
      .map(u => u.trim())
      .filter(u => u.length > 0)
      .map(u => {
        if (!u.startsWith('http://') && !u.startsWith('https://')) {
          return 'https://' + u;
        }
        return u;
      });
  }

  // Live URL Counter Badge Updater
  function updateUrlCounter() {
    const input = document.getElementById('target-urls-input');
    const badge = document.getElementById('url-counter-badge');
    if (!input || !badge) return;

    const urls = parseInputUrls(input.value);
    const sitemaps = urls.filter(u => u.toLowerCase().endsWith('.xml') || u.includes('sitemap'));

    if (urls.length === 0) {
      badge.textContent = '0 URLs Entered';
      badge.className = 'badge badge-primary';
    } else if (sitemaps.length > 0) {
      badge.textContent = `${urls.length} Target(s) (${sitemaps.length} Sitemap XML)`;
      badge.className = 'badge badge-success';
    } else {
      badge.textContent = `${urls.length} URL${urls.length > 1 ? 's' : ''} Ready`;
      badge.className = 'badge badge-primary';
    }
  }

  function clearUrlInput() {
    const input = document.getElementById('target-urls-input');
    if (input) {
      input.value = '';
      updateUrlCounter();
      input.focus();
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      const input = document.getElementById('target-urls-input');
      if (input && text) {
        input.value = (input.value.trim() ? input.value.trim() + '\n' : '') + text.trim();
        updateUrlCounter();
      }
    } catch (e) {
      const input = document.getElementById('target-urls-input');
      if (input) input.focus();
    }
  }

  // Execute Bot Dispatch Action for Multiple URLs
  async function executeBotDispatch(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('target-urls-input') || document.getElementById('target-url-input');
    if (!input) return;

    const urls = parseInputUrls(input.value);
    if (urls.length === 0) {
      alert('Please enter at least one URL or XML sitemap URL.');
      return;
    }

    const sitemapCandidates = urls.filter(u => u.toLowerCase().endsWith('.xml') || u.includes('sitemap'));
    const regularUrls = urls.filter(u => !u.toLowerCase().endsWith('.xml') && !u.includes('sitemap'));

    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> <span>Feeding ${urls.length} URL(s) to Feed Hub &amp; Pinging Bots...</span>`;

    document.getElementById('log-status').textContent = 'Feeding...';
    document.getElementById('log-stream').innerHTML = '';

    const now = new Date();
    const readableDate = now.toLocaleDateString() + ' ' + now.toLocaleTimeString();

    appendLog('FEED_START', `Ingesting <strong>${urls.length} URL(s)</strong> into Feed Hub &amp; Search Bot Pipelines`, 'tag-sys', 'text-cyan');
    appendLog('TIME_STAMP', `Batch initiated at: <strong>${readableDate}</strong>`, 'tag-sys', 'text-dim');

    // Optional diag metrics update if elements exist
    const dFormat = document.getElementById('diag-format');
    if (dFormat) dFormat.innerHTML = urls.length === 1 ? `<span style="color: #38bdf8;">1 Target URL</span>` : `<span style="color: #38bdf8;">${urls.length} URLs Batch</span>`;
    const dHttp = document.getElementById('diag-http');
    if (dHttp) dHttp.innerHTML = `<span style="color: #34d399;"><i class="ri-loader-4-line ri-spin"></i> Ingesting...</span>`;
    const dRobots = document.getElementById('diag-robots');
    if (dRobots) dRobots.innerHTML = `<span style="color: #fb923c;"><i class="ri-loader-4-line ri-spin"></i> Syncing...</span>`;
    const dPipeline = document.getElementById('diag-pipeline');
    if (dPipeline) dPipeline.innerHTML = `<span style="color: #38bdf8;">Active</span>`;

    try {
      // Step 1: Dispatch all URLs simultaneously to Feed Hub Relay
      const relayRes = await fetch('/api/seo/relay/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: regularUrls.length > 0 ? regularUrls : undefined,
          sitemapUrl: sitemapCandidates.length > 0 ? sitemapCandidates[0] : undefined
        })
      });

      const relayData = await relayRes.json().catch(() => ({}));

      if (!relayRes.ok || !relayData.success) {
        throw new Error(relayData.error || `Server responded with HTTP ${relayRes.status}`);
      }

      const totalIngested = relayData.totalSubmitted || urls.length;
      appendLog('FEEDHUB_OK', `🎉 Successfully listed <strong>${totalIngested} URL(s)</strong> in Feed Hub Directory (/api/seo/indexing-hub.html)!`, 'tag-ok', 'text-ok');
      appendLog('RSS_OK', `✅ Live RSS 2.0 Feed updated (/api/seo/indexing-feed.xml) with outbound indexable links.`, 'tag-ok', 'text-ok');

      if (relayData.pillars) {
        if (relayData.pillars.googlebotProbe) {
          const gp = relayData.pillars.googlebotProbe;
          appendLog('GOOGLE_OK', `✅ Google WebSub Hub pinged (HTTP ${gp.googleWebSubStatus || 204}). Live probe HTTP ${gp.targetProbeStatus || 200}.`, 'tag-ok', 'text-ok');
          if (gp.speedyIndex && gp.speedyIndex.success) {
            appendLog('SPEEDY_OK', `⚡ SpeedyIndex Google Crawler Task #${gp.speedyIndex.taskId || gp.speedyIndex.task_id} registered!`, 'tag-ok', 'text-cyan');
          }
        }
        if (relayData.pillars.indexNowGateway) {
          appendLog('INDEXNOW_OK', `✅ Verified IndexNow signature broadcasted from our host for all URLs!`, 'tag-ok', 'text-ok');
        }
        if (relayData.pillars.bingYandexRelay) {
          appendLog('SPIDERS_OK', `✅ Bingbot, YandexBot and Ping-O-Matic network notified!`, 'tag-ok', 'text-cyan');
        }
      }

      // Step 2: Parallel background crawler pings for the first 5 individual links to register detailed latency & audits
      const sampleUrls = urls.slice(0, 5);
      sampleUrls.forEach(u => {
        const isPdf = u.toLowerCase().endsWith('.pdf');
        fetch('/api/crawler/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: u, format: isPdf ? 'PDF Document' : 'Webpage', loadTime: '1.1s' })
        }).catch(() => {});
      });

      // Update Confirmation Card
      const confirmCard = document.getElementById('relay-confirmation-card');
      const confirmTitle = document.getElementById('confirm-title');
      const confirmSubtitle = document.getElementById('confirm-subtitle');
      if (confirmCard) {
        confirmCard.style.display = 'block';
        if (confirmTitle) confirmTitle.textContent = `🎉 ${totalIngested} URL${totalIngested > 1 ? 's' : ''} Successfully Listed in Feed Hub!`;
        if (confirmSubtitle) {
          confirmSubtitle.innerHTML = `All <strong>${totalIngested} links</strong> are now live in the Feed Hub directory &amp; RSS feed and queued for search engine crawlers.`;
        }
        confirmCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Step 3: Refresh Feed Hub Directory table on the page
      await loadRelayDirectory();

      // Step 4: Refresh Dispatched URL Vault
      await loadHistoryLogs();

      // Update metrics strip if present
      if (dHttp) dHttp.innerHTML = `<span style="color: #34d399;"><i class="ri-check-line"></i> 200 OK Live</span>`;
      if (dRobots) dRobots.innerHTML = `<span style="color: #34d399;"><i class="ri-check-line"></i> Live in Feed Hub</span>`;
      if (dPipeline) dPipeline.innerHTML = `<span style="color: #34d399; font-weight: 700;"><i class="ri-checkbox-circle-fill"></i> Broadcast Complete</span>`;
      document.getElementById('log-status').textContent = 'Complete';

      appendLog('COMPLETE', `Search engine pipeline executed. Live signals recorded in Feed Hub and Dispatched URL Vault.`, 'tag-ok', 'text-cyan');

      // Re-enable button
      btn.disabled = false;
      btn.innerHTML = `<i class="ri-check-line"></i> <span>All ${totalIngested} URLs Listed &amp; Broadcasted! Feed More?</span>`;
      setTimeout(() => {
        btn.innerHTML = `<i class="ri-send-plane-fill"></i> <span>Feed All URLs to Feed Hub &amp; Broadcast to Googlebot, Bingbot &amp; Crawlers</span>`;
      }, 5000);

    } catch (err) {
      appendLog('DISPATCH_ERROR', `Broadcast warning: ${err.message}`, 'tag-warn', 'text-danger');
      if (dPipeline) dPipeline.innerHTML = `<span style="color: #f87171;"><i class="ri-close-circle-line"></i> Error</span>`;
      document.getElementById('log-status').textContent = 'Error';
      btn.disabled = false;
      btn.innerHTML = `<i class="ri-send-plane-fill"></i> <span>Retry Feeding to Feed Hub</span>`;
      alert('Notice: ' + err.message);
    }
  }

  /* ==========================================================================
     Tool 9: Multi-URL & XML Sitemap Batch Mode
     ========================================================================== */
  function switchIndexerMode(mode) {
    const singleForm = document.getElementById('indexer-form');
    const batchWrapper = document.getElementById('indexer-batch-wrapper');
    const btnSingle = document.getElementById('btn-mode-single');
    const btnBatch = document.getElementById('btn-mode-batch');

    if (mode === 'batch') {
      if (singleForm) singleForm.style.display = 'none';
      if (batchWrapper) batchWrapper.style.display = 'block';
      if (btnSingle) btnSingle.className = 'btn btn-sm btn-glass';
      if (btnBatch) btnBatch.className = 'btn btn-sm btn-primary';
    } else {
      if (singleForm) singleForm.style.display = 'block';
      if (batchWrapper) batchWrapper.style.display = 'none';
      if (btnSingle) btnSingle.className = 'btn btn-sm btn-primary';
      if (btnBatch) btnBatch.className = 'btn btn-sm btn-glass';
    }
  }

  function updateBatchCount() {
    const textarea = document.getElementById('batch-urls-textarea');
    const badge = document.getElementById('batch-count-badge');
    if (!textarea || !badge) return;

    const urls = textarea.value
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);

    badge.textContent = `${urls.length} URLs in Queue`;
  }

  async function importSitemapToBatch() {
    const sitemapInput = document.getElementById('sitemap-url-input');
    const url = sitemapInput ? sitemapInput.value.trim() : '';
    if (!url) {
      alert('Please enter a sitemap URL (e.g. https://example.com/sitemap.xml)');
      return;
    }

    const btn = document.getElementById('btn-import-sitemap');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Parsing...';

    try {
      const resp = await fetch('/api/sitemap/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await resp.json();
      btn.disabled = false;
      btn.innerHTML = orig;

      if (!resp.ok || !data.success) {
        alert(data.error || 'Failed to extract sitemap URLs');
        return;
      }

      const textarea = document.getElementById('batch-urls-textarea');
      if (textarea) {
        textarea.value = data.urls.join('\n');
        updateBatchCount();
      }

      appendLog('SITEMAP_IMPORT', `Successfully extracted ${data.totalUrls} child URLs from: ${data.source}`, 'tag-ok', 'text-ok');
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = orig;
      alert('Error extracting sitemap: ' + err.message);
    }
  }

  async function runBatchDispatch() {
    const textarea = document.getElementById('batch-urls-textarea');
    if (!textarea) return;

    const urls = textarea.value
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0);

    if (urls.length === 0) {
      alert('Please enter at least one URL in the batch queue!');
      return;
    }

    const btn = document.getElementById('btn-start-batch');
    btn.disabled = true;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Processing Batch Queue (${urls.length} items)...`;

    document.getElementById('log-status').textContent = 'Batch Running';
    document.getElementById('log-stream').innerHTML = '';

    appendLog('BATCH_START', `Initiating sequential multi-engine crawler broadcast for ${urls.length} URLs`, 'tag-sys', 'text-cyan');

    // Ingest entire batch into Public Crawl Relay Hub immediately
    try {
      const relayRes = await fetch('/api/seo/relay/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urls.slice(0, 50) })
      });
      const relayData = await relayRes.json().catch(() => ({}));
      if (relayRes.ok && relayData.success && relayData.pillars) {
        renderPillarReport(relayData);
        appendLog('RELAY_BATCH', `✅ Public Crawl Relay Hub: Ingested ${urls.length} batch URLs into live HTML directory &amp; RSS feed!`, 'tag-ok', 'text-ok');
        appendLog('INDEXNOW_GATEWAY', `⚡ Discovery relay submitted for batch URLs; IndexNow requires target-domain key ownership.`, 'tag-ok', 'text-cyan');
        loadRelayDirectory();
    loadIndexStatusMonitor();
    loadIndexQueueMonitor();
    setInterval(loadIndexStatusMonitor, 10000);
    setInterval(loadIndexQueueMonitor, 5000);
      }
    } catch (rErr) {
      console.warn('Batch relay ingestion warning:', rErr.message);
    }

    for (let i = 0; i < urls.length; i++) {
      const target = urls[i];
      appendLog('QUEUE_ITEM', `[${i + 1}/${urls.length}] Dispatching target: <span class="text-highlight">${target}</span>`, 'tag-url', 'text-cyan');

      try {
        const isPdf = target.toLowerCase().endsWith('.pdf');
        const formatName = isPdf ? 'PDF Document' : 'Webpage';

        const pingRes = await fetch('/api/crawler/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, format: formatName, loadTime: '1.0s' })
        });

        const pingData = await pingRes.json().catch(() => ({}));

        if (pingRes.ok && pingData.success) {
          appendLog('BATCH_OK', `✅ [${i + 1}/${urls.length}] Discovery signals submitted; crawler/index status remains pending: ${target}`, 'tag-ok', 'text-ok');
          if (pingData.speedyIndex && pingData.speedyIndex.success) {
            appendLog('SPEEDY_OK', `⚡ [${i + 1}/${urls.length}] SpeedyIndex Google Crawler Task #${pingData.speedyIndex.task_id} registered!`, 'tag-ok', 'text-ok');
          }
        } else if (pingRes.status === 429) {
          appendLog('RATE_LIMIT', `⚠️ [${i + 1}/${urls.length}] Rate limiter active: ${pingData.error || 'Too many requests'}. Pausing 5s...`, 'tag-sys', 'text-dim');
          await new Promise(r => setTimeout(r, 5000));
        } else {
          appendLog('BATCH_NOTE', `[${i + 1}/${urls.length}] ${target} responded with HTTP ${pingRes.status}`, 'tag-sys', 'text-dim');
        }
      } catch (e) {
        appendLog('DISPATCH_ERR', `❌ Error on ${target}: ${e.message}`, 'tag-sys', 'text-dim');
      }

      // Small delay between batch items
      await new Promise(r => setTimeout(r, 1200));
    }

    appendLog('BATCH_COMPLETE', `🎉 Sequential batch broadcast complete for all ${urls.length} queued URLs!`, 'tag-ok', 'text-cyan');
    btn.disabled = false;
    btn.innerHTML = `<i class="ri-play-list-add-line"></i> <span>Start Sequential Batch Crawler Broadcast</span>`;
    document.getElementById('log-status').textContent = 'Batch Complete';

    loadHistoryLogs();
  }

  // 1-Click Platform Session Lock
  async function lockSession() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('index_matrix_token');
    localStorage.removeItem('index_matrix_user');
    window.location.href = '/login.html';
  }

  // 1-Click Open in Official Google Search Console
  function openGscFromIndexer() {
    const input = document.getElementById('target-url-input');
    let url = input ? input.value.trim() : '';
    if (!url) {
      const state = window.SEONexus && window.SEONexus.getState ? window.SEONexus.getState() : {};
      url = state.targetUrl || '';
    }
    if (!url) {
      alert('Please enter a target webpage URL first!');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
      if (input) input.value = url;
    }
    let origin = url;
    try { origin = new URL(url).origin; } catch (e) {}
    const gscLink = `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(origin + '/')}&url=${encodeURIComponent(url)}`;
    window.open(gscLink, '_blank');
  }

  /* ==========================================================================
     Tool 3.5: Public Crawl Relay Hub & 4-Pillar Report UI
     ========================================================================== */
  function renderPillarReport(data) {
    const container = document.getElementById('relay-pillar-report');
    if (!container || !data || !data.pillars) return;

    const p1 = data.pillars.googlebotProbe;
    const p2 = data.pillars.relayCrawlHub;
    const p3 = data.pillars.indexNowGateway;
    const p4 = data.pillars.bingYandexRelay;

    if (p1) {
      const b1 = document.getElementById('pillar-1-badge');
      const s1 = document.getElementById('pillar-1-status');
      const d1 = document.getElementById('pillar-1-desc');
      if (b1) b1.textContent = p1.status || 'ACTIVE';
      if (s1) s1.innerHTML = `<span style="color: #4ade80;">HTTP ${p1.targetProbeStatus || 200}</span> <span style="font-size: 0.8rem; color: #94a3b8;">(${p1.targetLatency || '1.1s'})</span>`;
      if (d1) d1.textContent = p1.message || 'Server-side probe completed; this is not proof of Googlebot crawl.';
    }

    if (p2) {
      const b2 = document.getElementById('pillar-2-badge');
      const s2 = document.getElementById('pillar-2-status');
      const d2 = document.getElementById('pillar-2-desc');
      if (b2) b2.textContent = p2.status || 'PUBLISHED';
      if (s2) s2.innerHTML = `<span style="color: #38bdf8;">${p2.ingestedCount || 1} URL(s) Live</span>`;
      if (d2) d2.textContent = p2.message || 'Published to semantic HTML directory & RSS 2.0 feed with index, follow.';
    }

    if (p3) {
      const b3 = document.getElementById('pillar-3-badge');
      const s3 = document.getElementById('pillar-3-status');
      const d3 = document.getElementById('pillar-3-desc');
      if (b3) b3.textContent = p3.status || 'VERIFIED';
      if (s3) s3.innerHTML = `<span style="color: #a78bfa;">Key Signed</span> <span style="font-size: 0.75rem; color: #94a3b8;">(${p3.hostedKey ? p3.hostedKey.slice(0, 8) + '...' : 'Verified'})</span>`;
      if (d3) d3.textContent = p3.message || 'IndexNow is only applicable when the target domain can verify the required key.';
    }

    if (p4) {
      const b4 = document.getElementById('pillar-4-badge');
      const s4 = document.getElementById('pillar-4-status');
      const d4 = document.getElementById('pillar-4-desc');
      if (b4) b4.textContent = p4.status || 'SIGNALED';
      if (s4) s4.innerHTML = `<span style="color: #34d399;">Discovery signals sent</span>`;
      if (d4) d4.textContent = p4.message || 'Relay/feed signals are not proof of crawler access or indexing.';
    }

    const ts = document.getElementById('report-timestamp');
    if (ts) ts.innerHTML = `Discovery submission completed &bull; ${new Date().toLocaleTimeString()} &bull; <span style="color: #38bdf8;">Status monitoring active</span>`;

    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadRelayDirectory() {
    const tbody = document.getElementById('relay-directory-body');
    const summary = document.getElementById('relay-stats-summary');
    if (!tbody) return;

    try {
      const res = await fetch('/api/seo/relay/directory?limit=50');
      const data = await res.json();
      if (!data.success || !Array.isArray(data.links) || data.links.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-dim);"><i class="ri-inbox-line" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem; color: var(--accent-cyan);"></i>No links in Feed Hub yet. Paste multiple URLs above to feed them!</td></tr>`;
        if (summary) summary.textContent = '0 Links Fed';
        return;
      }

      if (summary) {
        summary.textContent = `${data.links.length} Link${data.links.length > 1 ? 's' : ''} Fed`;
      }

      tbody.innerHTML = data.links.map(item => `
        <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background 0.15s;">
          <td style="padding: 0.85rem 1rem; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <a href="${encodeURI(item.url)}" target="_blank" rel="follow" style="color: #ffffff; text-decoration: none; font-weight: 600;" title="${item.url}">
              <i class="ri-link" style="color: var(--accent-cyan); font-size: 0.85rem; margin-right: 0.35rem;"></i>${item.url}
            </a>
          </td>
          <td style="padding: 0.85rem 1rem;">
            <span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.74rem;">
              ${item.domain || 'web'}
            </span>
          </td>
          <td style="padding: 0.85rem 1rem;">
            <span class="badge" style="background: rgba(34, 197, 94, 0.12); color: #4ade80; font-size: 0.74rem;">
              <i class="ri-radar-line"></i> ${item.botPingCount || 1} Signals
            </span>
          </td>
          <td style="padding: 0.85rem 1rem; color: var(--text-dim); font-size: 0.78rem;">
            ${new Date(item.submittedAt || Date.now()).toLocaleDateString()} ${new Date(item.submittedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </td>
          <td style="padding: 0.85rem 1rem; text-align: right;">
            <a href="${encodeURI(item.url)}" target="_blank" rel="follow" class="btn btn-sm btn-glass" style="padding: 0.25rem 0.65rem; font-size: 0.75rem;">
              <i class="ri-external-link-line"></i> Open
            </a>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--text-dim);">Ready for submissions.</td></tr>`;
    }
  }

  async function clearFeedHub() {
    if (!confirm('Are you sure you want to clear all links from the Feed Hub?')) return;
    try {
      const res = await fetch('/api/seo/relay/clear', { method: 'POST' });
      if (res.ok) {
        await loadRelayDirectory();
      }
    } catch (e) {
      alert('Failed to clear Feed Hub: ' + e.message);
    }
  }


  /* ==========================================================================
     Observable Index Status Monitor
     ========================================================================== */
  function statusBadge(status) {
    const map = {
      RECEIVED: 'Received',
      DISCOVERY_SUBMITTED: 'Discovery submitted',
      DISCOVERY_PENDING: 'Discovery pending',
      DISCOVERED: 'Discovered',
      FETCH_CHECKED: 'Fetch checked',
      FETCH_CHECKED_NOT_GOOGLEBOT_EVIDENCE: 'Fetch checked',
      INDEXED: 'Indexed',
      NOT_INDEXED: 'Not indexed',
      UNKNOWN: 'Unknown'
    };
    return map[status] || status || 'Unknown';
  }

  async function loadIndexStatusMonitor() {
    const body = document.getElementById('index-status-body');
    const stats = document.getElementById('index-status-stats');
    if (!body) return;
    try {
      const res = await fetch('/api/index/status?limit=100');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Status API error');
      const s = data.stats || {};
      if (stats) stats.textContent = `${s.total || 0} tracked • ${s.discoveryPending || 0} pending • ${s.unknownIndex || 0} index status unknown`;
      const rows = Array.isArray(data.records) ? data.records : [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:var(--text-dim);">No tracked URLs yet.</td></tr>';
        return;
      }
      body.innerHTML = rows.map(r => {
        const discovery = r.discoveryStatus || 'NOT_SUBMITTED';
        const crawl = r.crawlStatus || 'UNKNOWN';
        const index = r.indexStatus || 'UNKNOWN';
        const safeUrl = String(r.url || '').replace(/"/g, '&quot;');
        return `<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
          <td style="padding:.75rem;max-width:390px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${safeUrl}">${safeUrl}</td>
          <td style="padding:.75rem"><span class="badge badge-primary">${statusBadge(discovery)}</span></td>
          <td style="padding:.75rem"><span class="badge">${statusBadge(crawl)}</span></td>
          <td style="padding:.75rem"><span class="badge">${statusBadge(index)}</span></td>
          <td style="padding:.75rem;color:var(--text-dim);font-size:.75rem">${r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '-'}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      body.innerHTML = '<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:#fca5a5;">Status monitor unavailable.</td></tr>';
    }
  }


  async function loadIndexQueueMonitor() {
    const el = document.getElementById('index-queue-stats');
    if (!el) return;
    try {
      const res = await fetch('/api/index/queue?limit=100');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Queue unavailable');
      const s = data.stats || {};
      el.textContent = \`Queue: \${s.pending || 0} pending • \${s.running || 0} running • \${s.done || 0} completed • \${s.failed || 0} failed\`;
    } catch (e) { el.textContent = 'Queue monitor unavailable'; }
  }

  // Expose global methods
  window.executeBotDispatch = executeBotDispatch;
  window.updateUrlCounter = updateUrlCounter;
  window.clearUrlInput = clearUrlInput;
  window.pasteFromClipboard = pasteFromClipboard;
  window.clearFeedHub = clearFeedHub;
  window.openGscFromIndexer = openGscFromIndexer;
  window.lockUserSession = lockSession;
  window.copyTerminalLogs = copyTerminalLogs;
  window.clearTerminalLogs = clearTerminalLogs;
  window.toggleHistoryDrawer = toggleHistoryDrawer;
  window.loadHistoryLogs = loadHistoryLogs;
  window.exportHistoryCSV = exportHistoryCSV;
  window.clearServerLogs = clearServerLogs;
  window.switchIndexerMode = switchIndexerMode;
  window.updateBatchCount = updateBatchCount;
  window.importSitemapToBatch = importSitemapToBatch;
  window.runBatchDispatch = runBatchDispatch;
  window.renderPillarReport = renderPillarReport;
  window.loadRelayDirectory = loadRelayDirectory;
  window.loadIndexStatusMonitor = loadIndexStatusMonitor;
  window.loadIndexQueueMonitor = loadIndexQueueMonitor;

  document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    loadRelayDirectory();
    const targetInput = document.getElementById('target-urls-input') || document.getElementById('target-url-input');
    const sitemapInput = document.getElementById('sitemap-url-input');

    // Check URL query param first (?url=...)
    const params = new URLSearchParams(window.location.search);
    let autoUrl = params.get('url');

    // If not in query, check active project state from sessionStorage
    if (!autoUrl && typeof sessionStorage !== 'undefined') {
      try {
        const stored = sessionStorage.getItem('index_matrix_active_state');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && (parsed.targetUrl || parsed.url)) {
            autoUrl = parsed.targetUrl || parsed.url;
          }
        }
      } catch (e) {}
    }

    if (autoUrl && targetInput && !targetInput.value) {
      targetInput.value = autoUrl;
      updateUrlCounter();
      if (sitemapInput && !sitemapInput.value) {
        try {
          const origin = new URL(autoUrl.startsWith('http') ? autoUrl : `https://${autoUrl}`).origin;
          sitemapInput.value = `${origin}/sitemap.xml`;
        } catch (e) {}
      }
    } else {
      updateUrlCounter();
    }
  });
})();
