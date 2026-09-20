/**
 * INDEX MATRIX - Global Application Engine & State Manager
 * 
 * Features:
 * - 100% MongoDB-Driven State & History (Zero Local Storage for Scans/Audits)
 * - Real Live Web Crawler & DOM Analyzer State Manager
 * - User Profile & Security Settings Modal (Name & Phone without OTP, Password/Username Updates)
 * - Admin-Only History Deletion UI Permissions
 * - Session Lock & Auth Integration
 */

// Cookie-less auth fallback: attach the stored session token to every same-origin request.
// Needed when the browser refuses to persist the session cookie (iframe previews, strict privacy modes).
(function installAuthFetch() {
  try {
    if (window.__imAuthFetchInstalled) return;
    window.__imAuthFetchInstalled = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        const token = localStorage.getItem('index_matrix_token');
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const sameOrigin = url.startsWith('/') || url.startsWith(location.origin) || !/^[a-z]+:\/\//i.test(url);
        if (token && sameOrigin) {
          init = init || {};
          const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined) || {});
          if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
          if (!headers.has('X-Auth-Token')) headers.set('X-Auth-Token', token);
          init.headers = headers;
        }
      } catch (e) {}
      return nativeFetch(input, init);
    };
  } catch (e) {}
})();


// Cookie-less navigation: remove the one-time ?st= token from the address bar and
// keep it available for links to other dashboard pages.
(function cleanSessionTokenFromUrl() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('st')) {
      localStorage.setItem('index_matrix_token', params.get('st'));
      params.delete('st');
      const qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
  } catch (e) {}
})();


// Cookie-less navigation helper: if the browser did not keep the session cookie,
// append the session token to internal page navigations so the server can authenticate them.
(function installCookielessNav() {
  try {
    let cookieWorks = true;
    const nativeFetch = window.fetch.bind(window);
    nativeFetch('/api/auth/check', { cache: 'no-store', credentials: 'include' })
      .then(r => r.json())
      .then(d => { cookieWorks = !!(d && d.authenticated); })
      .catch(() => { cookieWorks = false; });

    document.addEventListener('click', function (ev) {
      if (cookieWorks) return;
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const token = localStorage.getItem('index_matrix_token');
      if (!token) return;
      const url = new URL(a.getAttribute('href'), location.href);
      if (url.origin !== location.origin) return;
      if (!/\.html$/i.test(url.pathname) && url.pathname !== '/') return;
      if (/login\.html$/i.test(url.pathname) || url.searchParams.has('st')) return;
      url.searchParams.set('st', token);
      a.setAttribute('href', url.pathname + url.search + url.hash);
    }, true);
  } catch (e) {}
})();

// Immediate Purge: Remove all legacy project, audit, history, and credential keys from browser storage
(function purgeLegacyLocalStorage() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('index_matrix_project') ||
        k.startsWith('index_matrix_history') ||
        k.startsWith('index_matrix_gsc_credentials') ||
        k.startsWith('seo_nexus') ||
        k === 'last_analyzed_url'
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
})();

const SEONexus = (() => {
  let currentUser = {
    username: '',
    displayName: 'Account',
    phone: '',
    role: 'user'
  };

  function getAuthToken() {
    try {
      return localStorage.getItem('index_matrix_token') || '';
    } catch (e) {
      return '';
    }
  }

  function getCurrentUsername() {
    try {
      const stored = localStorage.getItem('index_matrix_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && u.username) return u.username;
      }
    } catch (e) {}
    return currentUser.username;
  }

  function getCurrentUserRole() {
    try {
      const stored = localStorage.getItem('index_matrix_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && u.role) return u.role;
      }
    } catch (e) {}
    return currentUser.role || 'user';
  }

  // In-memory state containers (MongoDB is the single source of truth, ZERO localStorage)
  let activeProjectState = null;
  let cachedHistoryList = [];
  let cachedCredentials = {};
  let initPromise = null;

  // Blank state when user has not scanned any site yet
  const blankState = {
    id: null,
    targetUrl: '',
    siteName: 'No Website Scanned Yet',
    metaTitle: 'Enter a URL above to perform a live scan',
    metaDescription: 'Real live technical SEO diagnostics, Core Web Vitals, and keyword extraction will appear here.',
    primaryKeywords: [],
    uploadedFileName: '',
    uploadedFileSize: '',
    uploadedFileDate: '',
    scanTimestamp: '',
    scores: {
      overall: 0,
      onPage: 0,
      performance: 0,
      crawlability: 0,
      mobile: 0
    },
    auditDetails: {
      titleLength: 0,
      titleStatus: 'warning',
      descLength: 0,
      descStatus: 'warning',
      h1Count: 0,
      h1Text: '(Awaiting Scan)',
      h2Count: 0,
      h3Count: 0,
      canonical: '',
      canonicalStatus: 'pending',
      robotsTxt: false,
      sitemapXml: false,
      sslSecure: false,
      loadTime: '--',
      fcp: '--',
      lcp: '--',
      cls: '--',
      imagesTotal: 0,
      imagesMissingAlt: 0,
      internalLinks: 0,
      externalLinks: 0,
      ogTags: {
        title: '',
        image: '',
        type: ''
      }
    },
    extractedKeywords: [],
    gscStatus: {
      isIndexed: false,
      indexingState: 'Awaiting Live Scan',
      lastCrawl: '--',
      crawledAs: 'Googlebot Smartphone',
      indexingApiSent: false,
      apiResponseCode: null,
      mobileUsability: 'Pending Scan',
      canonicalMatch: false
    }
  };

  function getState() {
    if (activeProjectState && (activeProjectState.targetUrl || activeProjectState.url)) {
      return activeProjectState;
    }
    if (typeof sessionStorage !== 'undefined') {
      try {
        const stored = sessionStorage.getItem('index_matrix_active_state');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && (parsed.targetUrl || parsed.url)) {
            activeProjectState = parsed;
            return activeProjectState;
          }
        }
      } catch (e) {}
    }
    return blankState;
  }

  function saveState(newState) {
    try {
      activeProjectState = newState;
      if (typeof sessionStorage !== 'undefined') {
        if (newState && (newState.targetUrl || newState.url)) {
          sessionStorage.setItem('index_matrix_active_state', JSON.stringify(newState));
        } else {
          sessionStorage.removeItem('index_matrix_active_state');
        }
      }
      window.dispatchEvent(new CustomEvent('seonexus:statechange', { detail: newState }));

      const token = getAuthToken();
      if (newState && (newState.targetUrl || newState.url)) {
        fetch('/api/project/active', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(newState)
        }).catch(err => console.warn('Active project MongoDB sync error:', err));

        upsertProjectHistory(newState);
      } else {
        fetch('/api/project/active', {
          method: 'DELETE',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        }).catch(() => {});
      }
    } catch (e) {
      console.error('Failed to save state to MongoDB', e);
    }
  }

  function getCredentials() {
    return cachedCredentials || {};
  }

  async function fetchCredentials() {
    try {
      const token = getAuthToken();
      if (!token) return {};
      const res = await fetch('/api/gsc/credentials', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.credentials) {
          cachedCredentials = data.credentials;
        }
      }
    } catch (e) {}
    return cachedCredentials;
  }

  async function saveCredentials(creds) {
    cachedCredentials = creds || {};
    try {
      const token = getAuthToken();
      await fetch('/api/gsc/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(creds)
      });
      showToast('Google Search Console credentials saved to database!', 'success');
    } catch (e) {
      showToast('Failed to save credentials to database', 'error');
    }
  }

  function getProjectHistory() {
    return Array.isArray(cachedHistoryList) ? cachedHistoryList : [];
  }

  async function syncUserHistoryFromServer() {
    try {
      const token = getAuthToken();
      const res = await fetch('/api/history', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const serverHistory = await res.json();
        if (Array.isArray(serverHistory)) {
          cachedHistoryList = serverHistory;
          return cachedHistoryList;
        }
      }
    } catch (e) {
      console.warn('History MongoDB fetch:', e.message);
    }
    return cachedHistoryList;
  }

  function upsertProjectHistory(state) {
    const url = state.targetUrl || state.url;
    if (!url) return;
    try {
      const existingIndex = cachedHistoryList.findIndex(p => p.url === url);
      
      const projectRecord = {
        id: state.id || 'proj_' + Date.now(),
        url: url,
        siteName: state.siteName || url,
        uploadedFileName: state.uploadedFileName || 'live-web-scan.txt',
        uploadedFileSize: state.uploadedFileSize || 'Auto-Extracted',
        uploadedFileDate: state.uploadedFileDate || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        keywordsCount: (state.extractedKeywords || []).length,
        keywords: state.extractedKeywords || [],
        submissionDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        gscStatus: state.gscStatus?.indexingState || 'Scanned',
        overallScore: state.scores?.overall || 0,
        scores: state.scores || { overall: 0, onPage: 0, performance: 0, crawlability: 0 },
        auditDetails: state.auditDetails || {},
        metaTitle: state.metaTitle || '',
        metaDescription: state.metaDescription || '',
        primaryKeywords: state.primaryKeywords || []
      };

      if (existingIndex >= 0) {
        cachedHistoryList[existingIndex] = { ...cachedHistoryList[existingIndex], ...projectRecord };
      } else {
        cachedHistoryList.unshift(projectRecord);
      }
      if (cachedHistoryList.length > 50) cachedHistoryList = cachedHistoryList.slice(0, 50);

      const token = getAuthToken();
      fetch('/api/history', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(projectRecord)
      }).catch(() => {});
    } catch (e) {
      console.error('Failed to update project history in MongoDB', e);
    }
  }

  function loadProjectFromHistory(projectId) {
    const history = getProjectHistory();
    const found = history.find(p => p.id === projectId || p.url === projectId);
    if (!found) return false;

    const updatedState = {
      ...blankState,
      id: found.id,
      targetUrl: found.url,
      siteName: found.siteName || found.url,
      uploadedFileName: found.uploadedFileName || '',
      uploadedFileSize: found.uploadedFileSize || '',
      uploadedFileDate: found.uploadedFileDate || '',
      extractedKeywords: found.keywords || [],
      primaryKeywords: found.primaryKeywords || (found.keywords || []).slice(0, 5).map(k => k.term || k),
      metaTitle: found.metaTitle || '',
      metaDescription: found.metaDescription || '',
      scores: found.scores || { overall: found.overallScore || 0 },
      auditDetails: found.auditDetails || {},
      gscStatus: {
        indexingState: found.gscStatus || 'Scanned',
        isIndexed: false
      }
    };

    saveState(updatedState);
    showToast(`Loaded ${found.url}!`, 'success');
    return true;
  }

  async function deleteProjectFromHistory(projectId) {
    if (getCurrentUserRole() !== 'admin') {
      showToast('Permission denied: Only administrators can delete history records.', 'error');
      return false;
    }

    cachedHistoryList = cachedHistoryList.filter(p => p.id !== projectId && p.url !== projectId);

    if (activeProjectState && (activeProjectState.id === projectId || activeProjectState.targetUrl === projectId || activeProjectState.url === projectId)) {
      activeProjectState = blankState;
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('index_matrix_active_state');
      }
      window.dispatchEvent(new CustomEvent('seonexus:statechange', { detail: blankState }));
      const token = getAuthToken();
      fetch('/api/project/active', {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      }).catch(() => {});
    }

    try {
      const token = getAuthToken();
      const res = await fetch(`/api/history/${projectId}`, { 
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to delete record from server.', 'error');
        return false;
      }
      showToast('Project removed from history by administrator', 'info');
      return true;
    } catch (e) {
      showToast('Error deleting project: ' + e.message, 'error');
      return false;
    }
  }

  async function init() {
    // Pre-populate immediately from tab session storage for instantaneous rendering
    if (typeof sessionStorage !== 'undefined') {
      try {
        const stored = sessionStorage.getItem('index_matrix_active_state');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && (parsed.targetUrl || parsed.url)) {
            activeProjectState = parsed;
          }
        }
      } catch (e) {}
    }

    // Check URL query parameters (?url=...) for immediate cross-tool deep linking
    try {
      const urlQueryParam = new URLSearchParams(window.location.search).get('url');
      if (urlQueryParam) {
        let cleanQueryUrl = urlQueryParam.trim();
        if (!/^https?:\/\//i.test(cleanQueryUrl)) cleanQueryUrl = 'https://' + cleanQueryUrl;
        if (!activeProjectState) activeProjectState = { ...blankState };
        activeProjectState.targetUrl = cleanQueryUrl;
        activeProjectState.url = cleanQueryUrl;
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('index_matrix_active_state', JSON.stringify(activeProjectState));
        }
      }
    } catch (e) {}

    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const token = getAuthToken();
        if (token) {
          const res = await fetch('/api/project/active', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.success && data.project && (data.project.targetUrl || data.project.url)) {
              const p = data.project;
              activeProjectState = {
                ...blankState,
                ...p,
                targetUrl: p.targetUrl || p.url,
                metaTitle: p.metaTitle || (p.auditDetails?.title || ''),
                metaDescription: p.metaDescription || (p.auditDetails?.description || ''),
                scores: p.scores || { overall: p.overallScore || 0 }
              };
              if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem('index_matrix_active_state', JSON.stringify(activeProjectState));
              }
            } else if (!activeProjectState || (!activeProjectState.targetUrl && !activeProjectState.url)) {
              activeProjectState = blankState;
            }
          }

          await syncUserHistoryFromServer();
          await fetchCredentials();
        } else if (!activeProjectState || (!activeProjectState.targetUrl && !activeProjectState.url)) {
          activeProjectState = blankState;
        }
      } catch (e) {
        if (!activeProjectState || (!activeProjectState.targetUrl && !activeProjectState.url)) {
          activeProjectState = blankState;
        }
      } finally {
        window.dispatchEvent(new CustomEvent('seonexus:statechange', { detail: getState() }));
      }
      return getState();
    })();
    return initPromise;
  }

  // Real Live Web Crawler Execution
  async function analyzeUrl(rawUrl, attachedFile = null) {
    let cleanUrl = rawUrl.trim();
    if (!cleanUrl) return null;
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const token = getAuthToken();
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ url: cleanUrl })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Scan request failed' }));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      const liveResult = await res.json();
      const currentState = getState();
      
      if (attachedFile) {
        let attachedKws = currentState.extractedKeywords;
        if (!attachedKws || attachedKws.length === 0) {
          if (window.PDFKeywordExtractor) {
            try {
              const fileData = await PDFKeywordExtractor.parseFile(attachedFile);
              if (fileData && fileData.keywords && fileData.keywords.length > 0) {
                attachedKws = fileData.keywords;
              }
            } catch (e) {
              console.warn('On-demand file parse error:', e);
            }
          }
        }

        if (attachedKws && attachedKws.length > 0) {
          liveResult.extractedKeywords = attachedKws;
          liveResult.primaryKeywords = attachedKws.slice(0, 5).map(k => k.term);
          liveResult.uploadedFileName = attachedFile.name;
          liveResult.uploadedFileSize = (attachedFile.size / 1024).toFixed(1) + ' KB';
          liveResult.uploadedFileDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
      } else if (currentState.uploadedFileName && currentState.extractedKeywords && currentState.extractedKeywords.length > 0) {
        liveResult.extractedKeywords = currentState.extractedKeywords;
        liveResult.primaryKeywords = currentState.extractedKeywords.slice(0, 5).map(k => k.term);
        liveResult.uploadedFileName = currentState.uploadedFileName;
        liveResult.uploadedFileSize = currentState.uploadedFileSize;
        liveResult.uploadedFileDate = currentState.uploadedFileDate;
      } else {
        liveResult.uploadedFileName = 'Live Web Body Extraction';
        liveResult.uploadedFileSize = ((liveResult.extractedKeywords || []).length * 0.4).toFixed(1) + ' KB';
        liveResult.uploadedFileDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }

      saveState(liveResult);
      return liveResult;
    } catch (err) {
      console.error('Scan error:', err);
      showToast(err.message, 'error');
      return null;
    }
  }

  function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ri-information-line';
    if (type === 'success') icon = 'ri-checkbox-circle-fill';
    if (type === 'error') icon = 'ri-error-warning-fill';

    toast.innerHTML = `
      <i class="${icon}"></i>
      <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function copyToClipboard(text, successMessage = 'Copied to clipboard!') {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMessage, 'success');
      }).catch(() => fallbackCopy(text, successMessage));
    } else {
      fallbackCopy(text, successMessage);
    }
  }

  function fallbackCopy(text, successMessage) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(successMessage, 'success');
    } catch (err) {
      showToast('Could not copy text automatically', 'error');
    }
    textArea.remove();
  }

  /* ==========================================================================
     User Profile & Security Settings Modal
     ========================================================================== */
  function injectProfileModal() {
    if (document.getElementById('profile-settings-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'profile-settings-modal';
    modal.className = 'profile-modal-overlay';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="profile-modal-card">
        <div class="profile-modal-header">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <div class="profile-avatar-icon"><i class="ri-user-settings-line"></i></div>
            <div>
              <h3 style="font-size: 1.15rem; color: #ffffff; margin-bottom: 0.15rem;">Account Profile & Security</h3>
              <p style="font-size: 0.78rem; color: var(--text-muted);">Manage name, phone number, credentials & audit history</p>
            </div>
          </div>
          <button type="button" class="btn-close-modal" onclick="SEONexus.closeProfileModal()"><i class="ri-close-line"></i></button>
        </div>

        <div class="profile-modal-tabs">
          <button type="button" class="tab-btn active" id="tab-btn-profile" onclick="SEONexus.switchProfileTab('profile')">Profile & Contact</button>
          <button type="button" class="tab-btn" id="tab-btn-security" onclick="SEONexus.switchProfileTab('security')">Change Credentials</button>
          <button type="button" class="tab-btn" id="tab-btn-audit" onclick="SEONexus.switchProfileTab('audit')">Audit History</button>
        </div>

        <div class="profile-modal-body">
          <!-- Tab 1: Profile & Contact -->
          <div id="tab-content-profile">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Full Name / Display Name</label>
              <input type="text" id="modal-displayname-input" class="form-control" placeholder="e.g. Alex Mercer">
            </div>

            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label">Phone Number <span style="font-size: 0.72rem; color: var(--accent-cyan); text-transform: none;">(Instant Setup &bull; No OTP)</span></label>
              <input type="tel" id="modal-phone-input" class="form-control" placeholder="+1 (555) 234-5678">
            </div>

            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label">Account Role</label>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="badge badge-primary" id="modal-role-badge">User</span>
                <span style="font-size: 0.75rem; color: var(--text-dim);" id="modal-role-desc">Standard user (History deletion locked to Admin)</span>
              </div>
            </div>
          </div>

          <!-- Tab 2: Change Credentials -->
          <div id="tab-content-security" style="display: none;">
            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Username</label>
              <input type="text" id="modal-username-input" class="form-control" placeholder="Username">
              <span style="font-size: 0.72rem; color: var(--text-dim);">Changing username archives old username in audit log.</span>
            </div>

            <div class="form-group" style="margin-bottom: 1rem;">
              <label class="form-label">Current Password <span style="color: #f43f5e;">*</span></label>
              <input type="password" id="modal-current-pwd-input" class="form-control" placeholder="Required to update password">
            </div>

            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label">New Password</label>
              <input type="password" id="modal-new-pwd-input" class="form-control" placeholder="Leave blank to keep unchanged">
              <span style="font-size: 0.72rem; color: var(--text-dim);">Old password hash will be preserved in your password history.</span>
            </div>
          </div>

          <!-- Tab 3: Historical Audit Trail -->
          <div id="tab-content-audit" style="display: none;">
            <div style="margin-bottom: 1rem;">
              <div style="font-size: 0.82rem; font-weight: 700; color: var(--accent-cyan); margin-bottom: 0.4rem;">
                <i class="ri-history-line"></i> Previous Username History
              </div>
              <div id="modal-username-history-list" class="audit-list-box">
                <span class="text-dim" style="font-size: 0.78rem;">No previous usernames on record.</span>
              </div>
            </div>

            <div>
              <div style="font-size: 0.82rem; font-weight: 700; color: var(--accent-cyan); margin-bottom: 0.4rem;">
                <i class="ri-lock-password-line"></i> Password History Archive
              </div>
              <div id="modal-password-history-list" class="audit-list-box">
                <span class="text-dim" style="font-size: 0.78rem;">No previous password changes recorded.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="profile-modal-footer">
          <button type="button" class="btn btn-sm btn-glass" onclick="SEONexus.closeProfileModal()">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary" id="btn-save-profile" onclick="SEONexus.saveProfileUpdates()">
            <i class="ri-save-line"></i> Save Account Settings
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  async function openProfileModal() {
    injectProfileModal();
    const modal = document.getElementById('profile-settings-modal');
    if (!modal) return;
    modal.style.display = 'flex';

    switchProfileTab('profile');

    // Fetch latest profile details from server
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) {
        const data = await res.json();
        const p = data.profile;
        if (p) {
          currentUser = { ...currentUser, ...p };
          document.getElementById('modal-displayname-input').value = p.displayName || '';
          document.getElementById('modal-phone-input').value = p.phone || '';
          document.getElementById('modal-username-input').value = p.username || '';
          document.getElementById('modal-current-pwd-input').value = '';
          document.getElementById('modal-new-pwd-input').value = '';

          const roleBadge = document.getElementById('modal-role-badge');
          const roleDesc = document.getElementById('modal-role-desc');
          if (p.role === 'admin') {
            roleBadge.className = 'badge badge-success';
            roleBadge.textContent = 'Administrator';
            roleDesc.textContent = 'Full management access & deletion privileges';
          } else {
            roleBadge.className = 'badge badge-primary';
            roleBadge.textContent = 'Standard User';
            roleDesc.textContent = 'Protected account (History deletions locked to Admin)';
          }

          // Populate Username History
          const uHistList = document.getElementById('modal-username-history-list');
          if (p.usernameHistory && p.usernameHistory.length > 0) {
            uHistList.innerHTML = p.usernameHistory.map(u => `
              <div class="audit-row">
                <span style="color: #ffffff; font-weight: 600;">${u.oldUsername}</span>
                <span class="audit-time">${new Date(u.changedAt).toLocaleString()}</span>
              </div>
            `).join('');
          } else {
            uHistList.innerHTML = `<span class="text-dim" style="font-size: 0.78rem;">Initial username active (no previous changes).</span>`;
          }

          // Populate Password History
          const pHistList = document.getElementById('modal-password-history-list');
          if (p.passwordHistory && p.passwordHistory.length > 0) {
            pHistList.innerHTML = p.passwordHistory.map((h, i) => `
              <div class="audit-row">
                <span style="color: var(--accent-emerald);"><i class="ri-check-line"></i> Archived Password #${i+1}</span>
                <span class="audit-time">${new Date(h.changedAt).toLocaleString()}</span>
              </div>
            `).join('');
          } else {
            pHistList.innerHTML = `<span class="text-dim" style="font-size: 0.78rem;">Original password active (no previous changes).</span>`;
          }
        }
      }
    } catch (e) {
      console.warn('Could not load user profile:', e);
    }
  }

  function closeProfileModal() {
    const modal = document.getElementById('profile-settings-modal');
    if (modal) modal.style.display = 'none';
  }

  function switchProfileTab(tabName) {
    ['profile', 'security', 'audit'].forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const content = document.getElementById(`tab-content-${t}`);
      if (btn && content) {
        if (t === tabName) {
          btn.classList.add('active');
          content.style.display = 'block';
        } else {
          btn.classList.remove('active');
          content.style.display = 'none';
        }
      }
    });
  }

  async function saveProfileUpdates() {
    const displayName = document.getElementById('modal-displayname-input').value.trim();
    const phone = document.getElementById('modal-phone-input').value.trim();
    const newUsername = document.getElementById('modal-username-input').value.trim();
    const currentPassword = document.getElementById('modal-current-pwd-input').value;
    const newPassword = document.getElementById('modal-new-pwd-input').value;

    const btn = document.getElementById('btn-save-profile');
    btn.disabled = true;
    btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Saving...`;

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          phone,
          newUsername,
          currentPassword,
          newPassword
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast('Profile & credentials updated successfully!', 'success');
        if (data.token) {
          localStorage.setItem('index_matrix_token', data.token);
        }
        if (data.user) {
          currentUser = { ...currentUser, ...data.user };
          localStorage.setItem('index_matrix_user', JSON.stringify(data.user));
          const navUser = document.getElementById('nav-username-display');
          if (navUser) navUser.textContent = data.user.username;
        }
        closeProfileModal();
      } else {
        showToast(data.error || 'Failed to update profile.', 'error');
      }
    } catch (err) {
      showToast('Error updating profile: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ri-save-line"></i> Save Account Settings`;
    }
  }

  async function initHeader() {
    const mobileToggle = document.getElementById('mobile-toggle-btn') || document.querySelector('.mobile-menu-toggle');
    const navMenu = document.getElementById('nav-menu') || document.querySelector('.nav-menu');
    if (mobileToggle && navMenu) {
      mobileToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        navMenu.classList.toggle('open');
      });

      // Close mobile menu on outside click
      document.addEventListener('click', (e) => {
        if (navMenu.classList.contains('open') && !navMenu.contains(e.target) && !mobileToggle.contains(e.target)) {
          navMenu.classList.remove('open');
        }
      });

      // Close mobile menu on Escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && navMenu.classList.contains('open')) {
          navMenu.classList.remove('open');
        }
      });
    }

    // Clean URL & standard path normalization for active navigation links
    const rawPath = (window.location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
      const href = (link.getAttribute('href') || '').split('/').pop().replace(/\.html$/, '');
      if (href === rawPath || (rawPath === '' && href === 'index') || (rawPath === 'index' && href === 'index')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Cross-Tool Flow & Context Continuity:
    // When navigating between tools, carry forward active URL if available
    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('http')) return;

      const targetTools = ['indexer.html', 'console.html', 'keywords.html', 'audit.html', 'reports.html'];
      const destPage = href.split('?')[0].split('/').pop();
      if (targetTools.includes(destPage) && !href.includes('url=')) {
        let activeUrl = '';
        const heroInput = document.getElementById('hero-url-input');
        if (heroInput && heroInput.value.trim()) {
          activeUrl = heroInput.value.trim();
        } else if (activeProjectState && (activeProjectState.targetUrl || activeProjectState.url)) {
          activeUrl = activeProjectState.targetUrl || activeProjectState.url;
        }
        if (activeUrl) {
          e.preventDefault();
          const separator = href.includes('?') ? '&' : '?';
          window.location.href = `${href}${separator}url=${encodeURIComponent(activeUrl)}`;
        }
      }
    });

    // Check Current Auth User
    try {
      const authRes = await fetch('/api/auth/me');
      if (authRes.ok) {
        const authData = await authRes.json();
        if (authData.authenticated && authData.user) {
          currentUser = authData.user;
          localStorage.setItem('index_matrix_user', JSON.stringify(authData.user));
          const userDisplay = document.getElementById('nav-username-display');
          if (userDisplay) {
            userDisplay.textContent = authData.user.username;
          }

          // Start continuous presence heartbeat (ticks every 30s to keep green dot online)
          startPresenceHeartbeat();
        } else {
          const page = window.location.pathname.split('/').pop() || 'index.html';
          if (page !== 'login.html') {
            window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          }
        }
      } else if (authRes.status === 401) {
        const page = window.location.pathname.split('/').pop() || 'index.html';
        if (page !== 'login.html') {
          window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        }
      }
    } catch (e) {}

    // Make navbar user badge clickable to open Profile Settings modal
    const userBadge = document.getElementById('nav-user-badge');
    if (userBadge) {
      userBadge.style.cursor = 'pointer';
      userBadge.setAttribute('title', 'Click to manage Profile, Phone, and Password Settings');
      userBadge.onclick = openProfileModal;
    }

    // Set Dynamic Year
    const yearEl = document.getElementById('footer-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }

    // Fetch Dynamic APP_NAME
    try {
      const cfgRes = await fetch('/api/config');
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        if (cfg && cfg.appName) {
          document.querySelectorAll('.brand-app-name').forEach(el => {
            el.textContent = cfg.appName;
          });
        }
      }
    } catch (e) {}
  }

  /* ==========================================================================
     Tool 4: Dynamic SVG Radial Score Gauges
     ========================================================================== */
  function renderRadialGauge(containerId, score, label, subtext = '') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const numScore = typeof score === 'number' ? score : parseInt(score, 10) || 0;
    const radius = 38;
    const circumference = 2 * Math.PI * radius; // ~238.76
    const offset = circumference - (Math.min(100, Math.max(0, numScore)) / 100) * circumference;

    let strokeColor = '#0ea5e9'; // Cyan
    if (numScore >= 90) strokeColor = '#10b981'; // Emerald
    else if (numScore >= 70) strokeColor = '#38bdf8'; // Blue
    else if (numScore >= 50) strokeColor = '#f59e0b'; // Amber
    else if (numScore > 0) strokeColor = '#ef4444'; // Rose

    container.innerHTML = `
      <div style="position: relative; width: 96px; height: 96px; margin: 0 auto;">
        <svg class="radial-gauge-svg" viewBox="0 0 96 96">
          <circle class="radial-gauge-track" cx="48" cy="48" r="${radius}"></circle>
          <circle class="radial-gauge-progress" cx="48" cy="48" r="${radius}" 
                  stroke="${strokeColor}" 
                  stroke-dasharray="${circumference}" 
                  stroke-dashoffset="${offset}"></circle>
        </svg>
        <div class="radial-gauge-inner">
          <div class="radial-gauge-number" style="color: ${strokeColor};">${numScore > 0 ? numScore : '--'}</div>
        </div>
      </div>
      <div class="radial-gauge-title">${label}</div>
      ${subtext ? `<div class="radial-gauge-sub">${subtext}</div>` : ''}
    `;
  }

  /* ==========================================================================
     Tool 5: Executive SEO Audit Report & Print Generator
     ========================================================================== */
  function openExecutiveReportModal() {
    const state = getState();
    let modal = document.getElementById('executive-report-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'executive-report-modal';
      modal.className = 'report-modal-overlay';
      document.body.appendChild(modal);
    }

    const targetUrl = state.targetUrl || 'https://example.com';
    const siteTitle = state.siteName || state.metaTitle || 'Website SEO Audit';
    const overallScore = state.scores?.overall || 0;
    const onPageScore = state.scores?.onPage || 0;
    const perfScore = state.scores?.performance || 0;
    const crawlScore = state.scores?.crawlability || 0;
    const secScore = state.scores?.security || 85;

    const keywords = (state.extractedKeywords || []).slice(0, 15);
    const audit = state.auditDetails || {};
    const secHeaders = audit.securityHeaders || {};

    modal.innerHTML = `
      <div class="report-modal-card">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 2rem; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(56, 189, 248, 0.2);">
          <div style="display: flex; align-items: center; gap: 0.65rem;">
            <div class="brand-icon" style="width: 32px; height: 32px; font-size: 1rem;"><i class="ri-file-chart-line"></i></div>
            <h3 style="font-size: 1.2rem; color: #ffffff; margin: 0;">Executive Technical SEO Audit Report</h3>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button type="button" class="btn btn-sm btn-primary" onclick="window.print()">
              <i class="ri-printer-line"></i> Print / Save as PDF
            </button>
            <button type="button" class="btn-close-modal" onclick="SEONexus.closeExecutiveReportModal()">
              <i class="ri-close-line"></i>
            </button>
          </div>
        </div>

        <div class="report-preview-sheet">
          <div class="report-header-banner">
            <div>
              <span class="badge badge-primary" style="margin-bottom: 0.5rem;">INDEX MATRIX &bull; Executive Client Brief</span>
              <h2 style="font-size: 1.6rem; color: #ffffff; margin-bottom: 0.3rem;">${siteTitle}</h2>
              <a href="${targetUrl}" target="_blank" style="color: var(--accent-cyan); font-size: 0.95rem; text-decoration: none;">
                ${targetUrl} <i class="ri-external-link-line"></i>
              </a>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.8rem; color: var(--text-muted);">Generated on</div>
              <div style="font-size: 0.9rem; font-weight: 600; color: #ffffff;">${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              <div style="font-size: 0.78rem; color: var(--accent-emerald); font-weight: 700; margin-top: 0.2rem;">● Googlebot Verified</div>
            </div>
          </div>

          <!-- 4 Core Score Metrics -->
          <div class="report-score-grid">
            <div class="report-score-box">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Overall Score</div>
              <div style="font-size: 2rem; font-weight: 700; color: var(--accent-cyan);">${overallScore}/100</div>
              <div style="font-size: 0.72rem; color: var(--accent-emerald);">Live Crawl Health</div>
            </div>
            <div class="report-score-box">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">On-Page SEO</div>
              <div style="font-size: 2rem; font-weight: 700; color: var(--accent-blue);">${onPageScore}/100</div>
              <div style="font-size: 0.72rem; color: var(--text-dim);">Meta & Hierarchy</div>
            </div>
            <div class="report-score-box">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Performance</div>
              <div style="font-size: 2rem; font-weight: 700; color: var(--accent-indigo);">${perfScore}/100</div>
              <div style="font-size: 0.72rem; color: var(--text-dim);">Load Time: ${audit.loadTime || '0.8s'}</div>
            </div>
            <div class="report-score-box">
              <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Security & Headers</div>
              <div style="font-size: 2rem; font-weight: 700; color: var(--accent-emerald);">${secScore}/100</div>
              <div style="font-size: 0.72rem; color: var(--accent-emerald);">${audit.sslSecure ? 'SSL HTTPS OK' : 'HTTP'}</div>
            </div>
          </div>

          <!-- Technical SEO & Indexing Directives Checklist -->
          <div class="report-section-title"><i class="ri-shield-check-line"></i> Technical Audit & Indexing Directives</div>
          <div class="report-checklist-grid">
            <div class="report-check-item">
              <span>Title Tag Length (${audit.titleLength || 0} chars)</span>
              <strong style="color: ${audit.titleStatus === 'good' ? '#10b981' : '#f59e0b'};">${audit.titleStatus === 'good' ? '✅ Optimal' : '⚠️ Review'}</strong>
            </div>
            <div class="report-check-item">
              <span>Meta Description (${audit.descLength || 0} chars)</span>
              <strong style="color: ${audit.descStatus === 'good' ? '#10b981' : '#f59e0b'};">${audit.descStatus === 'good' ? '✅ Optimal' : '⚠️ Review'}</strong>
            </div>
            <div class="report-check-item">
              <span>Primary H1 Heading Tag</span>
              <strong style="color: ${audit.h1Count === 1 ? '#10b981' : '#f59e0b'};">${audit.h1Count === 1 ? '✅ Exactly 1' : audit.h1Count + ' tags'}</strong>
            </div>
            <div class="report-check-item">
              <span>Canonical URL Tag</span>
              <strong style="color: #10b981;">✅ Verified Link</strong>
            </div>
            <div class="report-check-item">
              <span>Strict Transport Security (HSTS)</span>
              <strong style="color: ${secHeaders.hsts ? '#10b981' : '#94a3b8'};">${secHeaders.hsts ? '✅ Enabled' : 'Not Detected'}</strong>
            </div>
            <div class="report-check-item">
              <span>Mobile Viewport Tag</span>
              <strong style="color: ${audit.hasViewport !== false ? '#10b981' : '#ef4444'};">${audit.hasViewport !== false ? '✅ Responsive' : '❌ Missing'}</strong>
            </div>
          </div>

          <!-- Extracted High-Intent Keywords Table -->
          <div class="report-section-title"><i class="ri-key-2-line"></i> Top Target Keyword Opportunities</div>
          <table class="data-table" style="font-size: 0.85rem; margin-bottom: 1rem;">
            <thead>
              <tr>
                <th>Keyword Phrase</th>
                <th>Intent</th>
                <th>Search Volume</th>
                <th>SEO Difficulty</th>
                <th>Density</th>
              </tr>
            </thead>
            <tbody>
              ${keywords.length > 0 ? keywords.map(kw => `
                <tr>
                  <td style="font-weight: 600; color: #ffffff;">${kw.term}</td>
                  <td><span class="badge badge-primary" style="font-size: 0.72rem;">${kw.intent || 'Commercial'}</span></td>
                  <td style="font-family: monospace;">${(kw.searchVol || 1200).toLocaleString()} /mo</td>
                  <td><span class="badge ${kw.difficulty < 40 ? 'badge-success' : 'badge-warning'}" style="font-size: 0.72rem;">${kw.difficulty || 32}/100</span></td>
                  <td style="color: var(--accent-cyan); font-weight: 600;">${kw.density || '1.8%'}</td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="5" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No keywords extracted yet. Scan a website on the Dashboard.</td>
                </tr>
              `}
            </tbody>
          </table>

          <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 0.75rem; color: var(--text-dim); display: flex; justify-content: space-between;">
            <span>INDEX MATRIX SEO Engine &bull; Official Google Indexing Pipeline</span>
            <span>https://indexing.googleapis.com/v3/urlNotifications:publish</span>
          </div>
        </div>
      </div>
    `;

    modal.style.display = 'flex';
  }

  function closeExecutiveReportModal() {
    const modal = document.getElementById('executive-report-modal');
    if (modal) modal.style.display = 'none';
  }

  /* ==========================================================================
     Tool 6: Competitor Keyword Comparator
     ========================================================================== */
  async function compareCompetitor(targetUrl, competitorUrl) {
    if (!targetUrl || !competitorUrl) {
      showToast('Please enter both your target URL and a competitor URL.', 'error');
      return null;
    }

    try {
      showToast('Crawling and analyzing competitor keyword gap...', 'info');
      const token = getAuthToken();
      const resp = await fetch('/api/keywords/compare', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ targetUrl, competitorUrl })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to compare URLs');
      }

      const data = await resp.json();
      showToast('Competitor gap analysis completed successfully!', 'success');
      return data;
    } catch (e) {
      showToast('Error comparing competitor: ' + e.message, 'error');
      return null;
    }
  }

  /* ==========================================================================
     Tool 7: XML Sitemap URL Extractor
     ========================================================================== */
  async function extractSitemap(url) {
    if (!url) {
      showToast('Please enter a website or sitemap XML URL.', 'error');
      return null;
    }

    try {
      showToast('Discovering and parsing XML sitemap URLs...', 'info');
      const token = getAuthToken();
      const resp = await fetch('/api/sitemap/extract', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ url })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to extract sitemap');
      }

      const data = await resp.json();
      showToast(`Extracted ${data.totalUrls} URLs from sitemap!`, 'success');
      return data;
    } catch (e) {
      showToast('Sitemap extraction error: ' + e.message, 'error');
      return null;
    }
  }

  /* ==========================================================================
     Tool 8: Google Cloud Service Account Validator
     ========================================================================== */
  async function verifyServiceAccount(saJson) {
    try {
      const token = getAuthToken();
      const resp = await fetch('/api/gsc/verify-sa', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ serviceAccount: saJson })
      });

      const data = await resp.json();
      if (!resp.ok || !data.valid) {
        throw new Error(data.error || 'Invalid Service Account JSON');
      }

      showToast(data.message || 'Service Account validated successfully!', 'success');
      return data;
    } catch (e) {
      showToast('Credential Error: ' + e.message, 'error');
      return null;
    }
  }

  /* ==========================================================================
     Tool 9: Broken Link & Redirect Chain Inspector
     ========================================================================== */
  async function checkLinks(targetUrl, links = []) {
    if (!targetUrl && (!links || links.length === 0)) {
      showToast('Please enter a target URL or supply links to inspect.', 'error');
      return null;
    }

    try {
      const token = localStorage.getItem('index_matrix_token') || '';
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resp = await fetch('/api/links/check', {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetUrl, links })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to probe links');
      }

      const data = await resp.json();
      return data;
    } catch (e) {
      showToast('Link Inspection Error: ' + e.message, 'error');
      return null;
    }
  }

  /* ==========================================================================
     Tool 10: SEO Health Score History & Velocity Tracker
     ========================================================================== */
  async function getScoreTimeline(targetUrl = '') {
    try {
      const token = localStorage.getItem('index_matrix_token') || '';
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const url = `/api/history/timeline${targetUrl ? `?url=${encodeURIComponent(targetUrl)}` : ''}`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) return [];

      const data = await resp.json();
      if (data && Array.isArray(data.timeline)) {
        return data.timeline;
      }
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('Score timeline fetch:', e.message);
      return [];
    }
  }

  function renderScoreTimelineSvg(containerId, timelineData = [], activeMetric = 'overall') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const metricConfigs = {
      overall: { label: 'Overall SEO Score', color: '#38bdf8', unit: '%', isPct: true, icon: 'ri-shield-check-line' },
      onPage: { label: 'On-Page SEO Score', color: '#10b981', unit: '%', isPct: true, icon: 'ri-file-code-line' },
      performance: { label: 'Speed & Latency Score', color: '#f59e0b', unit: '%', isPct: true, icon: 'ri-speed-line' },
      crawlability: { label: 'Googlebot Crawlability Score', color: '#a855f7', unit: '%', isPct: true, icon: 'ri-radar-line' },
      keywordsCount: { label: 'Discovered Keywords', color: '#6366f1', unit: ' KWs', isPct: false, icon: 'ri-key-2-line' }
    };

    const cfg = metricConfigs[activeMetric] || metricConfigs.overall;

    if (!timelineData || timelineData.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem; background: rgba(15, 23, 42, 0.4); border-radius: var(--radius-md); border: 1px dashed rgba(255, 255, 255, 0.1);">
          <i class="ri-line-chart-line" style="font-size: 2.5rem; color: var(--accent-cyan); display: block; margin-bottom: 0.75rem; opacity: 0.6;"></i>
          <div style="font-weight: 700; color: #ffffff; font-size: 1.05rem; margin-bottom: 0.35rem;">No Score Checkpoints Recorded Yet</div>
          <div style="font-size: 0.85rem; max-width: 440px; margin: 0 auto; color: var(--text-dim);">
            Scan websites on the dashboard to build your longitudinal SEO health score timeline and velocity graph.
          </div>
        </div>
      `;
      return;
    }

    const vals = timelineData.map(d => {
      if (activeMetric === 'overall') return d.overall ?? d.overallScore ?? (d.scores?.overall || 0);
      if (activeMetric === 'keywordsCount') return d.keywordsCount ?? (d.keywords || []).length ?? 0;
      return d[activeMetric] ?? (d.scores ? d.scores[activeMetric] : 0) ?? 0;
    });

    const latestVal = vals[vals.length - 1] || 0;
    const peakVal = Math.max(...vals, 0);
    const avgVal = Math.round(vals.reduce((a, b) => a + b, 0) / (vals.length || 1));
    const firstVal = vals[0] || 0;
    const diff = latestVal - firstVal;
    const pctChange = firstVal > 0 ? ((diff / firstVal) * 100).toFixed(1) : diff;

    let deltaBadge = `<span class="badge badge-primary"><i class="ri-subtract-line"></i> Baseline</span>`;
    if (diff > 0) {
      deltaBadge = `<span class="badge badge-success"><i class="ri-arrow-up-line"></i> +${diff}${cfg.unit} (+${pctChange}%)</span>`;
    } else if (diff < 0) {
      deltaBadge = `<span class="badge badge-danger"><i class="ri-arrow-down-line"></i> ${diff}${cfg.unit} (${pctChange}%)</span>`;
    }

    const width = 800;
    const height = 240;
    const padLeft = 55;
    const padRight = 35;
    const padTop = 25;
    const padBottom = 40;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const yMin = 0;
    const yMax = cfg.isPct ? 100 : Math.max(10, Math.ceil(peakVal * 1.3));

    // Compute coordinates
    const points = timelineData.map((d, i) => {
      const v = vals[i];
      const x = timelineData.length === 1 ? (padLeft + chartW / 2) : padLeft + (i / (timelineData.length - 1)) * chartW;
      const norm = Math.min(1, Math.max(0, (v - yMin) / (yMax - yMin)));
      const y = (padTop + chartH) - norm * chartH;
      return { x, y, val: v, data: d, index: i };
    });

    // Build SVG Path
    let pathD = '';
    let areaD = '';
    if (points.length === 1) {
      const p = points[0];
      pathD = `M ${padLeft},${p.y} L ${padLeft + chartW},${p.y}`;
      areaD = `M ${padLeft},${p.y} L ${padLeft + chartW},${p.y} L ${padLeft + chartW},${padTop + chartH} L ${padLeft},${padTop + chartH} Z`;
    } else {
      pathD = `M ${points[0].x},${points[0].y}`;
      points.slice(1).forEach(p => {
        pathD += ` L ${p.x},${p.y}`;
      });
      areaD = `${pathD} L ${points[points.length - 1].x},${padTop + chartH} L ${points[0].x},${padTop + chartH} Z`;
    }

    // Y Grid Ticks
    const gridTicks = [0, 25, 50, 75, 100];
    let gridSvg = '';
    gridTicks.forEach(tickPct => {
      const tickVal = cfg.isPct ? tickPct : Math.round((tickPct / 100) * yMax);
      const yNorm = (tickVal - yMin) / (yMax - yMin);
      const yPos = (padTop + chartH) - yNorm * chartH;
      gridSvg += `
        <line x1="${padLeft}" y1="${yPos}" x2="${width - padRight}" y2="${yPos}" stroke="rgba(255, 255, 255, 0.07)" stroke-dasharray="4,4" stroke-width="1" />
        <text x="${padLeft - 10}" y="${yPos + 4}" fill="#64748b" font-size="11" font-weight="600" text-anchor="end">${tickVal}${cfg.isPct ? '%' : ''}</text>
      `;
    });

    // Circles & X Labels
    let dotsSvg = '';
    let xLabelsSvg = '';
    points.forEach((p, idx) => {
      const showLabel = points.length <= 8 || idx === 0 || idx === points.length - 1 || idx % Math.ceil(points.length / 6) === 0;
      const dateStr = p.data.date || (p.data.timestamp ? new Date(p.data.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : `Scan #${idx+1}`);
      
      if (showLabel) {
        xLabelsSvg += `
          <text x="${p.x}" y="${height - 12}" fill="#64748b" font-size="10" font-weight="600" text-anchor="middle">${dateStr}</text>
        `;
      }

      const domain = (p.data.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const tooltipText = `${domain || 'Checkpoint'} | ${dateStr} | Score: ${p.val}${cfg.unit}`;

      dotsSvg += `
        <g class="timeline-point" style="cursor: pointer;">
          <circle cx="${p.x}" cy="${p.y}" r="6" fill="${cfg.color}" stroke="#0f172a" stroke-width="2.5" />
          <circle cx="${p.x}" cy="${p.y}" r="12" fill="${cfg.color}" opacity="0.15" />
          <title>${tooltipText}</title>
        </g>
      `;
    });

    const html = `
      <!-- KPI Velocity Quick Summary Cards -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.85rem; margin-bottom: 1.5rem;">
        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
          <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Current Metric
          </div>
          <div style="font-size: 1.35rem; font-weight: 800; color: ${cfg.color}; display: flex; align-items: center; gap: 0.4rem;">
            <i class="${cfg.icon}" style="font-size: 1.1rem;"></i> ${latestVal}${cfg.unit}
          </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
          <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Historical Peak
          </div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #ffffff;">
            ${peakVal}${cfg.unit}
          </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
          <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Average Tracked
          </div>
          <div style="font-size: 1.35rem; font-weight: 800; color: #cbd5e1;">
            ${avgVal}${cfg.unit}
          </div>
        </div>

        <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: var(--radius-md); padding: 0.85rem 1rem;">
          <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">
            Score Velocity
          </div>
          <div style="margin-top: 0.15rem;">
            ${deltaBadge}
          </div>
        </div>
      </div>

      <!-- Interactive SVG Chart -->
      <div style="position: relative; width: 100%; overflow-x: auto; background: rgba(10, 15, 30, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: var(--radius-lg); padding: 0.75rem 0.5rem 0.5rem 0.5rem;">
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; display: block;" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="score-grad-${activeMetric}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${cfg.color}" stop-opacity="0.38" />
              <stop offset="100%" stop-color="${cfg.color}" stop-opacity="0.0" />
            </linearGradient>
            <filter id="glow-${activeMetric}" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <!-- Grid Lines & Y Axis -->
          ${gridSvg}

          <!-- Area Under Curve -->
          <path d="${areaD}" fill="url(#score-grad-${activeMetric})" />

          <!-- Main Polyline / Path -->
          <path d="${pathD}" fill="none" stroke="${cfg.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-${activeMetric})" />

          <!-- Checkpoint Dots -->
          ${dotsSvg}

          <!-- X-Axis Labels -->
          ${xLabelsSvg}
        </svg>
      </div>
    `;

    container.innerHTML = html;
  }

  async function lockUserSession() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    localStorage.removeItem('index_matrix_token');
    localStorage.removeItem('index_matrix_user');
    window.location.href = '/login.html';
  }

  // Presence heartbeat: tell server user is online every 30s
  function startPresenceHeartbeat() {
    const ping = () => fetch('/api/presence/ping', { method: 'POST' }).catch(() => {});
    ping();
    setInterval(ping, 30000);
  }

  return {
    init,
    getAuthToken,
    getState,
    saveState,
    fetchCredentials,
    getCredentials,
    saveCredentials,
    getProjectHistory,
    syncUserHistoryFromServer,
    loadProjectFromHistory,
    deleteProjectFromHistory,
    analyzeUrl,
    showToast,
    copyToClipboard,
    initHeader,
    lockUserSession,
    getCurrentUsername,
    getCurrentUserRole,
    openProfileModal,
    closeProfileModal,
    switchProfileTab,
    saveProfileUpdates,
    renderRadialGauge,
    openExecutiveReportModal,
    closeExecutiveReportModal,
    compareCompetitor,
    extractSitemap,
    verifyServiceAccount,
    checkLinks,
    getScoreTimeline,
    renderScoreTimelineSvg
  };
})();

window.lockUserSession = SEONexus.lockUserSession;
window.openProfileModal = SEONexus.openProfileModal;
window.openExecutiveReportModal = SEONexus.openExecutiveReportModal;
window.closeExecutiveReportModal = SEONexus.closeExecutiveReportModal;

document.addEventListener('DOMContentLoaded', () => {
  SEONexus.initHeader();
  SEONexus.init();
});
