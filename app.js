// ===== API CONFIG =====
// Automatische Erkennung: wenn vom iMac geladen → relativ, sonst absolute URL
const API_BASE = window.location.hostname === 'localhost' || window.location.port === '3001' || window.location.hostname === '10.0.0.230'
  ? ''
  : 'http://10.0.0.230:3001';

// ===== STATE =====
// Active pages in this build: dashboard, search, firmen, settings.
const state = {
  websites: JSON.parse(localStorage.getItem('seo_websites') || '[]'),
  activities: JSON.parse(localStorage.getItem('seo_activities') || '[]'),
  settings: JSON.parse(localStorage.getItem('seo_settings') || '{}'),
  stats: JSON.parse(localStorage.getItem('seo_stats') || '{}'),
  firmen: JSON.parse(localStorage.getItem('seo_firmen') || '[]'),
  searchHistory: JSON.parse(localStorage.getItem('seo_searchHistory') || '[]'),
};

// Firmen-Seite UI state
let firmenSort = 'date';
let firmenSearch = '';

function saveState() {
  localStorage.setItem('seo_websites', JSON.stringify(state.websites));
  localStorage.setItem('seo_activities', JSON.stringify(state.activities));
  localStorage.setItem('seo_settings', JSON.stringify(state.settings));
  localStorage.setItem('seo_stats', JSON.stringify(state.stats));
  localStorage.setItem('seo_firmen', JSON.stringify(state.firmen));
  localStorage.setItem('seo_searchHistory', JSON.stringify(state.searchHistory));
}

// ===== NAVIGATION =====
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  settings: 'Einstellungen',
  search: 'Firmensuche',
  firmen: 'Meine Firmen',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.getElementById('pageTitle').textContent = PAGE_TITLES[page] || page;
  document.getElementById('sidebar').classList.remove('open');
  renderPage(page);
}

function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  if (page === 'search') renderSearchPage();
  if (page === 'firmen') renderFirmenPage();
}

// ===== MOBILE SIDEBAR =====
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ===== NAV LINKS =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

// ===== DASHBOARD =====
function renderDashboard() {
  document.getElementById('statSearches').textContent = state.stats.searches || 0;
  document.getElementById('statFirmen').textContent = state.firmen.length;
  document.getElementById('statAnalyzed').textContent = state.stats.analyzed || 0;
  document.getElementById('statExported').textContent = state.stats.exported || 0;

  updateFirmenBadge();
  renderActivities();
  renderDashboardInsights();
  updateQuickstart();
}

// Letzte Suchen + Top/Schwächste Firmen als zusätzlicher Block
function renderDashboardInsights() {
  const page = document.getElementById('page-dashboard');
  if (!page) return;
  let host = document.getElementById('dashInsights');
  if (!host) {
    host = document.createElement('div');
    host.id = 'dashInsights';
    host.className = 'dashboard-grid';
    host.style.marginTop = '16px';
    const grid = page.querySelector('.dashboard-grid');
    if (grid && grid.parentNode) grid.parentNode.insertBefore(host, grid);
    else page.appendChild(host);
  }

  // Letzte 3 Suchen
  const searches = (state.searchHistory || []).slice(0, 3);
  const searchesHtml = searches.length
    ? searches.map(s => `
      <button class="activity-item" style="width:100%;text-align:left;border:none;background:none;cursor:pointer;padding:10px 0"
        onclick="repeatSearch(${JSON.stringify(s).replace(/"/g, '&quot;')})">
        <div class="activity-dot" style="background:var(--ff-blue)"></div>
        <div class="activity-body">
          <div class="activity-title">${escHtml(s.location)}${s.query ? ' · ' + escHtml(s.query) : ''}</div>
          <div class="activity-meta">${s.count || 0} Firmen · ${escHtml(s.portals === 'all' ? 'Alle Portale' : (s.portals || '').toUpperCase())}</div>
        </div>
        <span class="activity-time">${timeAgo(s.time)}</span>
      </button>`).join('')
    : `<div style="color:var(--ff-muted);font-size:13px;padding:14px 0">Noch keine Suchen. Starte oben deine erste Firmensuche.</div>`;

  // Top / schwächste Firmen nach Score
  const scored = state.firmen.filter(f => typeof f.seoScore === 'number');
  let firmenHtml;
  if (!scored.length) {
    firmenHtml = `<div style="color:var(--ff-muted);font-size:13px;padding:14px 0">Noch keine bewerteten Firmen gespeichert.</div>`;
  } else {
    const sorted = [...scored].sort((a, b) => b.seoScore - a.seoScore);
    const top = sorted.slice(0, 3);
    const worst = sorted.slice(-3).reverse().filter(f => !top.includes(f));
    const row = (f, tag) => `
      <div class="activity-item" style="padding:10px 0;cursor:pointer" onclick='analyzeWebsite(${JSON.stringify(f.website || '')})'>
        <div style="width:34px;height:34px;border-radius:9px;background:${scoreColorFor(f.seoScore)};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;flex-shrink:0">${f.seoScore}</div>
        <div class="activity-body">
          <div class="activity-title">${escHtml(f.name)}</div>
          <div class="activity-meta">${escHtml(f.category || f.source || '')}</div>
        </div>
        <span class="badge ${tag === 'top' ? 'badge-success' : 'badge-error'}" style="font-size:9px">${tag === 'top' ? 'Top' : 'Potenzial'}</span>
      </div>`;
    firmenHtml = top.map(f => row(f, 'top')).join('') + worst.map(f => row(f, 'low')).join('');
  }

  host.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Letzte Suchen</h3><span class="badge badge-blue">Quick-Links</span></div>
      <div class="activity-list">${searchesHtml}</div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Firmen-Ranking</h3><span class="badge badge-blue">SEO Score</span></div>
      <div class="activity-list">${firmenHtml}</div>
    </div>`;
}

function repeatSearch(s) {
  navigateTo('search');
  setTimeout(() => {
    document.getElementById('searchLocation').value = s.location || '';
    document.getElementById('searchQuery').value = s.query || '';
    if (s.portals) document.getElementById('searchPortals').value = s.portals;
    searchBusinesses();
  }, 80);
}

function dashQuickSearch() {
  const q = document.getElementById('dashSearchQuery')?.value.trim() || '';
  const loc = document.getElementById('dashSearchLocation')?.value.trim() || '';
  if (!loc) { showToast('Bitte Ort eingeben.', 'error'); return; }
  navigateTo('search');
  setTimeout(() => {
    document.getElementById('searchLocation').value = loc;
    document.getElementById('searchQuery').value = q;
    searchBusinesses();
  }, 80);
}

function updateNavBadges() {
  const wBadge = document.getElementById('navBadgeWebsites');
  const zBadge = document.getElementById('navBadgeZones');
  if (state.websites.length > 0) { wBadge.textContent = state.websites.length; wBadge.style.display = ''; }
  else wBadge.style.display = 'none';
  if (state.zones.length > 0) { zBadge.textContent = state.zones.length; zBadge.style.display = ''; }
  else zBadge.style.display = 'none';
}

function renderActivities() {
  const list = document.getElementById('activityList');
  if (!state.activities.length) {
    list.innerHTML = `<div class="empty-state" style="padding:28px">
      <svg viewBox="0 0 24 24"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
      <h4>Noch keine Aktivitäten</h4>
      <p>Sobald die AI arbeitet, siehst du hier alle Aktionen in Echtzeit.</p>
    </div>`;
    return;
  }
  list.innerHTML = state.activities.slice(0, 10).map(a => `
    <div class="activity-item">
      <div class="activity-dot" style="background:${a.color || 'var(--ff-blue)'}"></div>
      <div class="activity-body">
        <div class="activity-title">${escHtml(a.title)}</div>
        <div class="activity-meta">${escHtml(a.meta || '')}</div>
      </div>
      <span class="activity-time">${timeAgo(a.time)}</span>
      <span class="badge badge-${a.status || 'success'}">${statusLabel(a.status)}</span>
    </div>`).join('');
}

function updateQuickstart() {
  if ((state.stats.searches || 0) > 0) markStep('step1');
  if ((state.stats.analyzed || 0) > 0) markStep('step2');
  if (state.firmen.length > 0) markStep('step3');
  if ((state.stats.exported || 0) > 0) markStep('step4');
}

function markStep(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('done');
}

// ===== SETTINGS =====
function saveApiKey() {
  const key = document.getElementById('anthropicKey').value.trim();
  if (!key) { showToast('Bitte API Key eingeben.', 'error'); return; }
  state.settings.anthropicKey = key;
  saveState();
  showToast('API Key gespeichert!', 'success');
  updateAiEngineStatus();
}

async function testApiKey() {
  const box = document.getElementById('apiStatusBox');
  const key = state.settings.anthropicKey || document.getElementById('anthropicKey').value.trim();
  if (!key) { box.textContent = 'Bitte zuerst einen API Key eingeben.'; box.style.borderLeftColor = 'var(--ff-danger)'; return; }
  box.innerHTML = '<span class="spinner" style="border-color:rgba(11,92,255,.3);border-top-color:var(--ff-blue)"></span> Verbindung wird getestet...';
  try {
    const res = await fetch(API_BASE + '/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneType: 'text', prompt: 'Antworte nur mit: OK', currentContent: '', apiKey: key, model: 'claude-haiku-4-5' }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    box.innerHTML = '✓ Verbindung erfolgreich! Claude AI ist einsatzbereit.';
    box.style.borderLeftColor = 'var(--ff-success)';
    box.style.background = 'var(--ff-success-bg)';
    box.style.color = 'var(--ff-success)';
  } catch (e) {
    box.innerHTML = '✗ Verbindungsfehler: ' + escHtml(e.message);
    box.style.borderLeftColor = 'var(--ff-danger)';
    box.style.background = 'var(--ff-danger-bg)';
    box.style.color = 'var(--ff-danger)';
  }
}

function saveSettings() {
  state.settings.aiModel = document.getElementById('aiModel').value;
  state.settings.thinkingMode = document.getElementById('thinkingMode').value;
  state.settings.defaultInterval = document.getElementById('defaultInterval').value;
  state.settings.maxJobs = parseInt(document.getElementById('maxJobs').value, 10);
  state.settings.autoApprove = document.getElementById('autoApprove').classList.contains('on');
  state.settings.seoTracking = document.getElementById('seoTracking').classList.contains('on');
  state.settings.saveVersions = document.getElementById('saveVersions').classList.contains('on');
  state.settings.defaultLang = document.getElementById('defaultLang').value;
  saveState();
  showToast('Einstellungen gespeichert!', 'success');
  updateAiEngineStatus();
}

function loadSettings() {
  if (state.settings.aiModel) document.getElementById('aiModel').value = state.settings.aiModel;
  if (state.settings.defaultInterval) document.getElementById('defaultInterval').value = state.settings.defaultInterval;
  if (state.settings.maxJobs) document.getElementById('maxJobs').value = state.settings.maxJobs;
  if (state.settings.defaultLang) document.getElementById('defaultLang').value = state.settings.defaultLang;
  if (!state.settings.autoApprove) document.getElementById('autoApprove').classList.remove('on');
  updateAiEngineStatus();
}

function updateAiEngineStatus() {
  const el = document.getElementById('aiEngineModel');
  if (el) el.textContent = state.settings.aiModel || 'claude-opus-4-8';
}

// ===== MODALS =====
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// ===== ACTIVITIES =====
function addActivity(a) {
  state.activities.unshift({ ...a, time: new Date().toISOString() });
  if (state.activities.length > 100) state.activities = state.activities.slice(0, 100);
}

// ===== TOAST =====
let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const icon = { success: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z', error: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z', info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z' }[type] || '';
  t.querySelector('.toast-icon').innerHTML = `<path d="${icon}"/>`;
  document.getElementById('toastMsg').textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

// ===== HELPERS =====
function genId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function genApiKey() { return 'seo_' + Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join(''); }
function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'Gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `vor ${Math.floor(h/24)} Tag(en)`;
}
function statusLabel(s) { return { success:'Erfolgreich', pending:'Ausstehend', running:'Läuft', error:'Fehler' }[s] || s; }
function jobTypeLabel(t) { return { optimize:'SEO Optimieren', rewrite:'Neuschreiben', expand:'Erweitern', shorten:'Kürzen', refresh:'Auffrischen' }[t] || t; }
function zoneTypeLabel(t) { return { text:'Text', headline:'Headline', meta:'Meta', alt:'Alt-Text', title:'Titel' }[t] || t; }
function scheduleLabel(s) { return { once:'Einmalig', daily:'Täglich', weekly:'Wöchentlich', manual:'Manuell' }[s] || s; }

// SEO color from score
function scoreColorFor(s) {
  if (s === null || s === undefined || s === '') return 'var(--ff-muted)';
  return s >= 70 ? 'var(--ff-success)' : s >= 40 ? '#ea580c' : 'var(--ff-danger)';
}
function scoreBadgeClass(s) {
  if (s === null || s === undefined || s === '') return '';
  return s >= 70 ? 'badge-success' : s >= 40 ? 'badge-pending' : 'badge-error';
}

// Build a normalized seoData object from any business/analysis payload
function buildSeoData(src) {
  src = src || {};
  return {
    online: src.siteOnline ?? src.online ?? (src.error ? false : undefined),
    siteTitle: src.siteTitle || src.title || '',
    title: src.title !== undefined ? !!src.title : (src.siteTitle ? true : undefined),
    metaDescription: src.metaDescription !== undefined ? !!src.metaDescription : undefined,
    hasH1: src.h1Tags ? src.h1Tags.length > 0 : (src.hasH1 ?? undefined),
    h1Count: src.h1Tags ? src.h1Tags.length : (src.h1Count ?? null),
    hasMobile: src.hasViewport ?? src.mobile ?? src.hasMobile ?? undefined,
    https: src.https ?? (src.website || src.url || '').startsWith('https://') || undefined,
    loadTime: src.loadTime ?? null,
    wordCount: src.wordCount ?? null,
    hasSchema: src.hasSchema ?? undefined,
    images: src.images || null,
    internalLinks: src.internalLinks ?? null,
    externalLinks: src.externalLinks ?? null,
  };
}

// Generate textual recommendations from analysis data
function seoRecommendations(d) {
  const recs = [];
  if (!d) return recs;
  if (d.online === false) { recs.push('Website ist nicht erreichbar — Erreichbarkeit/Hosting prüfen.'); return recs; }
  if (!d.title && !d.siteTitle) recs.push('Es fehlt ein <title>-Tag — wichtigster SEO-Faktor.');
  if (d.metaDescription === false) recs.push('Meta Description hinzufügen (120–160 Zeichen) für bessere Klickrate.');
  if (d.hasH1 === false || d.h1Count === 0) recs.push('Eine eindeutige H1-Überschrift einfügen.');
  if (d.h1Count > 1) recs.push(`${d.h1Count} H1-Tags gefunden — auf genau eine reduzieren.`);
  if (d.hasMobile === false) recs.push('Viewport-Meta-Tag setzen für mobile Optimierung.');
  if (d.https === false) recs.push('Auf HTTPS umstellen (SSL-Zertifikat) — Vertrauen & Ranking.');
  if (d.loadTime && d.loadTime >= 3) recs.push(`Ladezeit (${d.loadTime}s) reduzieren — Bilder/Code optimieren.`);
  if (d.wordCount !== null && d.wordCount < 300) recs.push(`Mehr Inhalt erstellen (${d.wordCount} Wörter, mind. 300 empfohlen).`);
  if (d.hasSchema === false) recs.push('Strukturierte Daten (Schema.org) ergänzen für Rich Snippets.');
  if (d.images && d.images.withoutAlt > 0) recs.push(`${d.images.withoutAlt} Bilder ohne Alt-Text — für SEO & Barrierefreiheit ergänzen.`);
  return recs;
}

// Average SEO score over firmen that have a website with a score
function firmenAvgScore() {
  const scored = state.firmen.filter(f => typeof f.seoScore === 'number');
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, f) => a + f.seoScore, 0) / scored.length);
}

// Shimmer/skeleton loader markup
function skeletonLoader(rows = 4, label = 'Wird geladen...') {
  const bars = Array.from({ length: rows }, () => `
    <div style="display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--ff-line,rgba(0,0,0,.06))">
      <div class="sk-shimmer" style="width:48px;height:48px;border-radius:12px;flex-shrink:0"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px">
        <div class="sk-shimmer" style="height:13px;width:45%;border-radius:6px"></div>
        <div class="sk-shimmer" style="height:11px;width:75%;border-radius:6px"></div>
      </div>
    </div>`).join('');
  return `<div class="card">
    <style>
      @keyframes skShimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
      .sk-shimmer{background:linear-gradient(90deg,rgba(0,0,0,.05) 25%,rgba(0,0,0,.10) 37%,rgba(0,0,0,.05) 63%);background-size:800px 100%;animation:skShimmer 1.3s ease infinite}
    </style>
    <div style="display:flex;align-items:center;gap:10px;color:var(--ff-blue);font-weight:800;font-size:14px;margin-bottom:6px" id="loaderLabel">
      <div class="spinner" style="width:18px;height:18px;border-width:3px;border-color:rgba(11,92,255,.2);border-top-color:var(--ff-blue)"></div>
      <span id="loaderLabelText">${escHtml(label)}</span>
    </div>
    ${bars}
  </div>`;
}

// ===== FIRMENSUCHE =====
function renderSearchPage() {
  const results = document.getElementById('searchResults');
  if (!results.querySelector('.search-result-item')) {
    results.innerHTML = `<div class="empty-state" style="padding:28px">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      <h4>Noch keine Suche</h4>
      <p>Gib eine Branche und einen Ort ein, um Unternehmen in der Nähe zu finden.</p>
    </div>`;
  }
}

let currentFilter = 'all';
function filterResults(f) {
  currentFilter = f;
  document.querySelectorAll('#searchResultsHeader .btn').forEach(b => b.className = 'btn btn-sm btn-ghost');
  document.getElementById('filter' + {all:'All',website:'Website',nowebsite:'NoWebsite',good:'Good'}[f]).className = 'btn btn-sm btn-secondary';
  const items = document.querySelectorAll('.search-result-item');
  items.forEach(el => {
    const hasWeb = el.dataset.haswebsite === 'true';
    const score = parseInt(el.dataset.score || '0', 10);
    let show = true;
    if (f === 'website') show = hasWeb;
    if (f === 'nowebsite') show = !hasWeb;
    if (f === 'good') show = score >= 70;
    el.style.display = show ? '' : 'none';
  });
}

async function searchBusinesses() {
  const query = document.getElementById('searchQuery').value.trim();
  const location = document.getElementById('searchLocation').value.trim();
  const radiusKm = parseInt(document.getElementById('searchRadius').value, 10) || 10;
  const maxResults = parseInt(document.getElementById('searchMaxResults').value, 10) || 50;
  const portals = document.getElementById('searchPortals').value;
  const doAnalyze = document.getElementById('searchAnalyze').checked;
  const doDiscover = document.getElementById('searchDiscover').checked;
  if (!location) { showToast('Bitte Ort / Stadt eingeben.', 'error'); return; }

  const results = document.getElementById('searchResults');
  document.getElementById('searchResultsHeader').style.display = 'none';
  results.innerHTML = `<div class="card"><div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px;color:var(--ff-blue)">
    <div class="spinner" style="width:24px;height:24px;border-width:3px;border-color:rgba(11,92,255,.2);border-top-color:var(--ff-blue)"></div>
    <strong style="font-size:15px">Firmen werden gesucht...</strong>
    <span style="font-size:12px;color:var(--ff-muted)">Portale: ${portals === 'all' ? 'Alle' : portals.toUpperCase()} · Umkreis: ${radiusKm}km · Max: ${maxResults}</span>
  </div></div>
  </div>`;

  try {
    const res = await fetch(API_BASE + '/api/search/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location, radius: radiusKm * 1000, maxResults, portals, analyze: doAnalyze, discover: doDiscover }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const businesses = data.businesses || data.results || [];
    if (!businesses.length) {
      results.innerHTML = `<div class="empty-state" style="padding:28px">
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <h4>Keine Ergebnisse</h4>
        <p>Für "${escHtml(query)}" in "${escHtml(location)}" wurden keine Firmen gefunden.</p>
      </div>`;
      return;
    }

    const sources = data.sources || [];
    const sourceInfo = sources.length ? `<div class="info-box" style="margin-bottom:12px;font-size:12px">
      <strong>Quellen:</strong> ${sources.map(s => escHtml(s)).join(' · ')} — ${businesses.length} Ergebnisse
    </div>` : '';

    // Store businesses globally for save/analyze
    window._lastSearchResults = businesses;

    results.innerHTML = sourceInfo + businesses.map((biz, i) => {
      const saved = state.firmen.some(f => f.name.toLowerCase() === biz.name.toLowerCase());
      const hasWeb = biz.hasWebsite && biz.website;
      const online = biz.siteOnline;
      const seo = biz.seoScore || 0;
      const scoreColor = !hasWeb ? '#8895b0' : !online ? 'var(--red,#ff453a)' : seo >= 70 ? 'var(--green,#30d158)' : seo >= 40 ? 'var(--orange,#ff9f0a)' : 'var(--red,#ff453a)';

      // SEO detail pills
      const pills = hasWeb && online ? [
        biz.https ? '🔒 HTTPS' : '⚠️ HTTP',
        biz.mobile ? '📱 Mobil' : '❌ Nicht mobil',
        biz.loadTime ? `⚡ ${biz.loadTime}s` : '',
        biz.wordCount ? `📝 ${biz.wordCount}W` : '',
        biz.hasSchema ? '✅ Schema' : '',
      ].filter(Boolean) : [];

      return `<div class="search-result-item" id="search-result-${i}" data-haswebsite="${hasWeb && online}" data-score="${seo}" style="${!hasWeb ? 'opacity:0.5' : ''}">
        <div class="search-result-favicon" style="background:${scoreColor}">
          ${hasWeb && online ? seo : (biz.name || '?')[0].toUpperCase()}
        </div>
        <div class="search-result-body">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="search-result-name">${escHtml(biz.name)}</div>
            ${biz.category ? `<span class="search-result-category">${escHtml(biz.category)}</span>` : ''}
            ${biz.source ? `<span class="badge badge-blue">${escHtml(biz.source)}</span>` : ''}
          </div>

          ${hasWeb && online
            ? `<div style="margin:6px 0 4px;display:flex;gap:4px;flex-wrap:wrap">${pills.map(p => `<span class="badge" style="font-size:10px;background:var(--fill,#f5f5f7);color:var(--label-2,#333);border:0.5px solid var(--line,rgba(0,0,0,0.08))">${p}</span>`).join('')}</div>`
            : hasWeb
            ? '<div style="margin:4px 0;font-size:11px;color:var(--orange,#ff9f0a);font-weight:600">⚠️ Website nicht erreichbar</div>'
            : '<div style="margin:4px 0;font-size:11px;color:var(--red,#ff453a);font-weight:600">Keine Website — potentieller Neukunde</div>'
          }
          ${biz.siteTitle && online ? `<div style="font-size:11px;color:var(--text-3,#666);margin-bottom:3px">${escHtml(biz.siteTitle)}</div>` : ''}
          ${biz.websiteDiscovered ? '<span class="badge badge-blue" style="font-size:9px">Website via Recherche gefunden</span>' : ''}

          <div class="search-result-meta">
            ${biz.address ? `<span>📍 ${escHtml(biz.address)}</span>` : ''}
            ${biz.phone ? `<span>📞 <a href="tel:${escHtml(biz.phone)}">${escHtml(biz.phone)}</a></span>` : ''}
            ${biz.email ? `<span>✉ <a href="mailto:${escHtml(biz.email)}">${escHtml(biz.email)}</a></span>` : ''}
            ${biz.website ? `<span>🌐 <a href="${escHtml(biz.website)}" target="_blank">${escHtml(biz.website.replace(/^https?:\/\/(www\.)?/,'').slice(0,35))}</a></span>` : ''}
          </div>
        </div>
        <div class="search-result-actions">
          <button class="btn btn-sm ${saved ? 'btn-success' : 'btn-primary'}" id="save-btn-${i}"
            onclick='saveFirma(${i})' ${saved ? 'disabled' : ''}>
            ${saved ? '✓ Gespeichert' : '★ Speichern'}
          </button>
          ${hasWeb && online ? `<button class="btn btn-sm btn-secondary" onclick='analyzeWebsite("${escHtml(biz.website)}")'>SEO Details</button>` : ''}
        </div>
      </div>`;
    }).join('');

    // Info-Leiste
    const withSite = businesses.filter(b => b.siteOnline).length;
    const noSite = businesses.filter(b => !b.hasWebsite).length;
    const good = businesses.filter(b => (b.seoScore||0) >= 70).length;
    const discovered = businesses.filter(b => b.websiteDiscovered).length;
    document.getElementById('searchResultsHeader').style.display = '';
    document.getElementById('searchResultsInfo').innerHTML = `
      <strong>${businesses.length}</strong> Firmen gefunden ·
      <span style="color:var(--ff-success)">${withSite} mit Website</span> ·
      <span style="color:var(--ff-danger)">${noSite} ohne</span> ·
      <span style="color:var(--ff-blue)">${good} SEO 70+</span>
      ${discovered ? ` · <span style="color:var(--ff-blue)">${discovered} entdeckt</span>` : ''}
      ${data.showing < data.count ? ` · <span style="color:var(--ff-muted)">${data.count} total, ${data.showing} angezeigt</span>` : ''}
    `;

    state.stats.searches = (state.stats.searches || 0) + 1;
    state.stats.analyzed = (state.stats.analyzed || 0) + withSite;
    addActivity({ title: `Firmensuche: ${location}${query ? ' · ' + query : ''}`, meta: `${businesses.length} Firmen, ${withSite} mit Website`, status: 'success', color: '#0b5cff' });
    saveState();
    showToast(`${businesses.length} Firmen gefunden!`, 'success');
  } catch (e) {
    results.innerHTML = `<div class="seo-check-item fail" style="margin:16px"><span>Fehler: ${escHtml(e.message)}</span></div>`;
    showToast('Fehler bei der Suche: ' + e.message, 'error');
  }
}

function addBusinessAsWebsite(biz) {
  const existing = state.websites.find(w => w.url === biz.website);
  if (existing) {
    showToast('Diese Website ist bereits verbunden.', 'info');
    return;
  }
  const w = {
    id: genId(),
    url: biz.website,
    name: biz.name || biz.website,
    keywords: biz.category || '',
    lang: 'de',
    industry: biz.category || '',
    apiKey: genApiKey(),
    createdAt: new Date().toISOString(),
  };
  state.websites.push(w);
  addActivity({ title: `Website "${w.name}" aus Firmensuche hinzugefügt`, meta: w.url, status: 'success', color: '#087a43' });
  saveState();
  renderDashboard();
  showToast(`"${w.name}" als Website hinzugefügt!`, 'success');
}

async function analyzeWebsite(url) {
  openModal('analyzeModal');
  document.getElementById('analyzeModalTitle').textContent = `Analyse: ${url}`;
  document.getElementById('analyzeModalBody').innerHTML = `<div style="display:flex;justify-content:center;align-items:center;gap:12px;padding:40px;color:var(--ff-blue)">
    <div class="spinner" style="border-color:rgba(11,92,255,.3);border-top-color:var(--ff-blue)"></div>
    Website wird analysiert...
  </div>`;
  try {
    const res = await fetch(API_BASE + '/api/websites/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const s = data.seoScore || 0;
    const scoreColor = s >= 70 ? 'var(--ff-success)' : s >= 40 ? '#ea580c' : 'var(--ff-danger)';
    const imgs = data.images || {};
    const checks = [
      { ok: !!data.title, label: data.title ? `Title: "${escHtml(data.title.slice(0, 60))}"` : 'Kein <title> Tag' },
      { ok: !!data.metaDescription, label: data.metaDescription ? `Meta: "${escHtml(data.metaDescription.slice(0, 80))}..."` : 'Keine Meta Description' },
      { ok: data.h1Tags?.length === 1, label: data.h1Tags?.length ? `${data.h1Tags.length} H1-Tag(s): "${escHtml((data.h1Tags[0]||'').slice(0,50))}"` : 'Kein H1-Tag' },
      { ok: data.hasViewport, label: data.hasViewport ? 'Mobile-optimiert (Viewport)' : 'Kein Viewport Meta — nicht mobil-optimiert' },
      { ok: data.wordCount >= 300, label: `${data.wordCount || 0} Wörter` + (data.wordCount < 300 ? ' (mind. 300 empfohlen)' : '') },
      { ok: imgs.withoutAlt === 0, label: `${imgs.total || 0} Bilder, ${imgs.withoutAlt || 0} ohne Alt-Text` },
      { ok: data.internalLinks >= 3, label: `${data.internalLinks || 0} interne / ${data.externalLinks || 0} externe Links` },
      { ok: data.loadTime < 3, label: `Ladezeit: ${data.loadTime || '?'}s` },
    ];

    document.getElementById('analyzeModalBody').innerHTML = `
      <div style="display:flex;align-items:center;gap:24px;margin-bottom:20px">
        <div class="score-ring" style="flex-shrink:0">
          <svg viewBox="0 0 110 110" width="100" height="100">
            <circle class="score-ring-track" cx="55" cy="55" r="44"/>
            <circle class="score-ring-fill" cx="55" cy="55" r="44"
              stroke-dasharray="276.46" stroke-dashoffset="${276.46 - (276.46 * s / 100)}"
              style="stroke:${scoreColor}"/>
          </svg>
          <div class="score-ring-value">
            <strong style="color:${scoreColor};font-size:22px">${s}</strong>
            <span>SEO</span>
          </div>
        </div>
        <div>
          <h3 style="font-size:16px;font-weight:950;color:var(--ff-navy);margin-bottom:4px">${escHtml(data.title || url)}</h3>
          <div style="font-size:12px;color:var(--ff-muted)">${escHtml(url)}</div>
        </div>
      </div>
      <div class="seo-check-list">
        ${checks.map(c => `<div class="seo-check-item ${c.ok ? 'pass' : 'fail'}">
          <svg class="seo-check-icon" viewBox="0 0 24 24" fill="currentColor">
            ${c.ok ? '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>' : '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'}
          </svg>
          ${c.label}
        </div>`).join('')}
      </div>`;

    state.stats.analyzed = (state.stats.analyzed || 0) + 1;
    addActivity({ title: `Website analysiert: ${data.title || url}`, meta: `Score: ${s}/100`, status: s >= 50 ? 'success' : 'error', color: scoreColor });
    saveState();
    showToast(`Analyse abgeschlossen! Score: ${s}/100`, 'success');
  } catch (e) {
    document.getElementById('analyzeModalBody').innerHTML = `<div class="seo-check-item fail" style="margin:16px"><span>Fehler: ${escHtml(e.message)}</span></div>`;
    showToast('Analyse-Fehler: ' + e.message, 'error');
  }
}

// ===== AUTO-ANALYSE bei Suchergebnissen =====
async function autoAnalyzeResults(businesses) {
  const withWebsite = businesses.filter(b => b.website).slice(0, 15);
  for (let i = 0; i < businesses.length; i++) {
    const biz = businesses[i];
    if (!biz.website) continue;
    const badge = document.getElementById(`seo-badge-${i}`);
    if (!badge) continue;
    badge.style.display = '';
    badge.className = 'badge badge-pending';
    badge.textContent = '⏳ Analyse...';
    try {
      const res = await fetch(API_BASE + '/api/websites/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: biz.website }),
      });
      const data = await res.json();
      if (data.error) {
        badge.className = 'badge badge-error';
        badge.textContent = '✗ Fehler';
        continue;
      }
      const s = data.seoScore || 0;
      biz._seoScore = s;
      biz._seoData = data;
      badge.className = `badge ${s >= 70 ? 'badge-success' : s >= 40 ? 'badge-pending' : 'badge-error'}`;
      badge.textContent = `SEO: ${s}/100`;
      state.stats.analyzed = (state.stats.analyzed || 0) + 1;
    } catch (e) {
      badge.className = 'badge badge-error';
      badge.textContent = '✗ Offline';
    }
  }
  saveState();
}

// ===== FIRMA SPEICHERN =====
function saveFirma(index) {
  const biz = window._lastSearchResults?.[index];
  if (!biz) return;
  if (state.firmen.some(f => f.name.toLowerCase() === biz.name.toLowerCase())) {
    showToast('Firma bereits gespeichert.', 'info');
    return;
  }
  const firma = {
    id: genId(),
    name: biz.name,
    address: biz.address || '',
    phone: biz.phone || '',
    email: biz.email || '',
    website: biz.website || '',
    category: biz.category || '',
    source: biz.source || '',
    seoScore: biz.seoScore || biz._seoScore || null,
    seoData: {
      online: biz.siteOnline || false,
      siteTitle: biz.siteTitle || '',
      title: !!biz.siteTitle,
      metaDescription: biz.seoScore > 20,
      hasH1: biz.seoScore > 35,
      hasMobile: biz.seoScore > 50,
      wordCount: null,
      ...(biz._seoData || {}),
    },
    savedAt: new Date().toISOString(),
    notes: '',
  };
  state.firmen.push(firma);
  saveState();
  const btn = document.getElementById(`save-btn-${index}`);
  if (btn) { btn.textContent = '✓ Gespeichert'; btn.className = 'btn btn-sm btn-success'; btn.disabled = true; }
  updateFirmenBadge();
  addActivity({ title: `Firma "${firma.name}" gespeichert`, meta: firma.category, status: 'success', color: '#087a43' });
  saveState();
  showToast(`"${firma.name}" gespeichert!`, 'success');
}

function updateFirmenBadge() {
  const badge = document.getElementById('navBadgeFirmen');
  if (badge) {
    if (state.firmen.length > 0) { badge.textContent = state.firmen.length; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
}

// ===== FIRMEN SEITE =====
function renderFirmenPage() {
  updateFirmenBadge();
  const container = document.getElementById('firmenList');
  if (!state.firmen.length) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z"/></svg>
      <h4>Noch keine Firmen gespeichert</h4>
      <p>Suche nach Unternehmen und speichere interessante Firmen hier.</p>
      <button class="btn btn-primary" onclick="navigateTo('search')">Firmensuche starten</button>
    </div>`;
    return;
  }
  container.innerHTML = state.firmen.map((f, i) => {
    const s = f.seoScore;
    const scoreColor = s ? (s >= 70 ? 'var(--ff-success)' : s >= 40 ? '#ea580c' : 'var(--ff-danger)') : 'var(--ff-muted)';
    const hasWeb = !!f.website;
    const online = f.seoData?.online !== false && hasWeb;
    return `<div class="website-item" style="align-items:flex-start;padding:20px;margin-bottom:12px">
      <div style="width:56px;height:56px;border-radius:14px;background:${hasWeb ? scoreColor : 'var(--ff-muted)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${s ? '18px' : '22px'};font-weight:950;flex-shrink:0">
        ${s ? s : escHtml((f.name||'?')[0])}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
          <strong style="font-size:16px;color:var(--ff-navy)">${escHtml(f.name)}</strong>
          ${f.category ? `<span class="search-result-category">${escHtml(f.category)}</span>` : ''}
          ${f.source ? `<span class="badge badge-blue" style="font-size:9px">${escHtml(f.source)}</span>` : ''}
          <span class="badge ${s ? (s >= 70 ? 'badge-success' : s >= 40 ? 'badge-pending' : 'badge-error') : ''}" style="font-size:10px">
            ${hasWeb ? (online ? `SEO ${s || '?'}/100` : '⚠️ Offline') : '🚫 Keine Website'}
          </span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px;font-size:13px;margin-bottom:8px">
          ${f.address ? `<div style="display:flex;gap:6px;align-items:flex-start"><span style="color:var(--ff-muted);flex-shrink:0">📍</span><span>${escHtml(f.address)}</span></div>` : ''}
          ${f.phone ? `<div><span style="color:var(--ff-muted)">📞</span> <a href="tel:${escHtml(f.phone)}" style="font-weight:750">${escHtml(f.phone)}</a></div>` : '<div><span style="color:var(--ff-muted)">📞</span> <span style="color:var(--ff-danger);font-size:12px">Nicht verfügbar</span></div>'}
          ${f.email ? `<div><span style="color:var(--ff-muted)">✉</span> <a href="mailto:${escHtml(f.email)}" style="font-weight:750">${escHtml(f.email)}</a></div>` : '<div><span style="color:var(--ff-muted)">✉</span> <span style="color:var(--ff-danger);font-size:12px">Nicht verfügbar</span></div>'}
          ${f.website ? `<div><span style="color:var(--ff-muted)">🌐</span> <a href="${escHtml(f.website)}" target="_blank" style="font-weight:750;word-break:break-all">${escHtml(f.website.replace(/^https?:\/\//, ''))}</a></div>` : '<div><span style="color:var(--ff-muted)">🌐</span> <span style="color:var(--ff-danger);font-size:12px">Keine Website</span></div>'}
        </div>

        ${hasWeb && f.seoData ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          ${f.seoData.title ? `<span class="badge badge-success" style="font-size:9px">✓ Title</span>` : '<span class="badge badge-error" style="font-size:9px">✗ Kein Title</span>'}
          ${f.seoData.metaDescription ? `<span class="badge badge-success" style="font-size:9px">✓ Meta</span>` : '<span class="badge badge-error" style="font-size:9px">✗ Keine Meta</span>'}
          ${f.seoData.hasH1 ? `<span class="badge badge-success" style="font-size:9px">✓ H1</span>` : '<span class="badge badge-error" style="font-size:9px">✗ Kein H1</span>'}
          ${f.seoData.hasMobile ? `<span class="badge badge-success" style="font-size:9px">✓ Mobil</span>` : '<span class="badge badge-error" style="font-size:9px">✗ Nicht mobil</span>'}
          ${f.seoData.wordCount ? `<span class="badge badge-blue" style="font-size:9px">${f.seoData.wordCount} Wörter</span>` : ''}
        </div>` : ''}

        ${f.seoData?.siteTitle ? `<div style="font-size:11px;color:var(--ff-muted);font-style:italic">Seitentitel: "${escHtml(f.seoData.siteTitle)}"</div>` : ''}
        <div style="font-size:11px;color:var(--ff-muted);margin-top:4px">Gespeichert: ${new Date(f.savedAt).toLocaleDateString('de-AT')} · Quelle: ${escHtml(f.source || '—')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        ${f.website ? `<button class="btn btn-sm btn-secondary" onclick='analyzeWebsite("${escHtml(f.website)}")'>SEO Details</button>` : ''}
        ${f.website ? `<button class="btn btn-sm btn-primary" onclick='addBusinessAsWebsite(${JSON.stringify({name:f.name,website:f.website,category:f.category}).replace(/'/g,"&#39;")})'>→ Website</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="deleteFirma('${f.id}')">Entfernen</button>
      </div>
    </div>`;
  }).join('');
}

function deleteFirma(id) {
  state.firmen = state.firmen.filter(f => f.id !== id);
  saveState();
  renderFirmenPage();
  updateFirmenBadge();
  showToast('Firma entfernt.', 'success');
}

function exportFirmen() {
  if (!state.firmen.length) { showToast('Keine Firmen zum Exportieren.', 'error'); return; }
  const header = 'Name;Branche;Adresse;Telefon;Email;Website;SEO Score;Quelle;Gespeichert';
  const rows = state.firmen.map(f =>
    [f.name, f.category, f.address, f.phone, f.email, f.website, f.seoScore || '', f.source, f.savedAt].map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')
  );
  const csv = '﻿' + header + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `seo-solutions-firmen-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  state.stats.exported = (state.stats.exported || 0) + 1;
  saveState();
  showToast(`${state.firmen.length} Firmen als CSV exportiert!`, 'success');
}

// ===== INIT =====
loadSettings();
renderDashboard();
updateFirmenBadge();
