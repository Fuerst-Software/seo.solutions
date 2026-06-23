// =====================================================================
// seo.solutions — Frontend App
// Active pages: dashboard, search, firmen, settings
// =====================================================================

// ===== API CONFIG =====
// Auto-Detection: lokal/iMac -> relativ, sonst absolute URL zum Backend.
const API_BASE = (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.port === '3001' ||
  window.location.hostname === '10.0.0.230'
) ? '' : 'http://10.0.0.230:3001';

// ===== STATE =====
const state = {
  websites: load('seo_websites', []),
  activities: load('seo_activities', []),
  settings: load('seo_settings', {}),
  stats: load('seo_stats', {}),
  firmen: load('seo_firmen', []),
  searchHistory: load('seo_searchHistory', []),
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function saveState() {
  try {
    localStorage.setItem('seo_websites', JSON.stringify(state.websites));
    localStorage.setItem('seo_activities', JSON.stringify(state.activities));
    localStorage.setItem('seo_settings', JSON.stringify(state.settings));
    localStorage.setItem('seo_stats', JSON.stringify(state.stats));
    localStorage.setItem('seo_firmen', JSON.stringify(state.firmen));
    localStorage.setItem('seo_searchHistory', JSON.stringify(state.searchHistory));
  } catch (e) {
    console.warn('saveState fehlgeschlagen', e);
  }
}

// Firmen-Seite UI state
let firmenSort = 'date';     // 'name' | 'score' | 'date'
let firmenSearch = '';
let currentFilter = 'all';   // Suchergebnis-Filter

// =====================================================================
// HELPERS
// =====================================================================
function $(id) { return document.getElementById(id); }
function genId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function genApiKey() { return 'seo_' + Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join(''); }

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Sicher für Verwendung in JS-String innerhalb eines onclick-Attributs
function escAttr(s) { return escHtml(s); }
function jsArg(s) { return escHtml(JSON.stringify(s ?? '')); }

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'Gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `vor ${Math.floor(h / 24)} Tag(en)`;
}

function statusLabel(s) {
  return { success: 'Erfolgreich', pending: 'Ausstehend', running: 'Läuft', error: 'Fehler' }[s] || s || '';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('de-AT'); } catch { return '—'; }
}

// SEO Farbe / Badge aus Score
function scoreColorFor(s) {
  if (s === null || s === undefined || s === '') return 'var(--ff-muted)';
  return s >= 70 ? 'var(--ff-success)' : s >= 40 ? '#ea580c' : 'var(--ff-danger)';
}
function scoreBadgeClass(s) {
  if (s === null || s === undefined || s === '') return '';
  return s >= 70 ? 'badge-success' : s >= 40 ? 'badge-pending' : 'badge-error';
}

// Normalisiert beliebiges Suchergebnis/Analyse-Objekt zu seoData
function buildSeoData(src) {
  src = src || {};
  const url = src.website || src.url || '';
  const httpsGuess = url.startsWith('https://');
  return {
    online: src.siteOnline ?? src.online ?? (src.error ? false : undefined),
    siteTitle: src.siteTitle || src.title || '',
    metaDesc: src.metaDescription || src.metaDesc || '',
    h1: (src.h1Tags && src.h1Tags[0]) || src.h1 || '',
    title: src.title !== undefined ? !!src.title : (src.siteTitle ? true : undefined),
    metaDescription: src.metaDescription !== undefined ? !!src.metaDescription : undefined,
    hasH1: src.h1Tags ? src.h1Tags.length > 0 : (src.hasH1 ?? undefined),
    h1Count: src.h1Tags ? src.h1Tags.length : (src.h1Count ?? null),
    hasMobile: src.hasViewport ?? src.mobile ?? src.hasMobile ?? undefined,
    https: src.https ?? (url ? httpsGuess : undefined),
    loadTime: src.loadTime ?? null,
    wordCount: src.wordCount ?? null,
    hasSchema: src.hasSchema ?? undefined,
    images: src.images || null,
    internalLinks: src.internalLinks ?? null,
    externalLinks: src.externalLinks ?? null,
  };
}

// Textuelle Empfehlungen aus Analyse-Daten
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
  if (d.wordCount !== null && d.wordCount !== undefined && d.wordCount < 300) recs.push(`Mehr Inhalt erstellen (${d.wordCount} Wörter, mind. 300 empfohlen).`);
  if (d.hasSchema === false) recs.push('Strukturierte Daten (Schema.org) ergänzen für Rich Snippets.');
  if (d.images && d.images.withoutAlt > 0) recs.push(`${d.images.withoutAlt} Bilder ohne Alt-Text — für SEO & Barrierefreiheit ergänzen.`);
  return recs;
}

// Durchschnitts-Score über bewertete Firmen
function firmenAvgScore() {
  const scored = state.firmen.filter(f => typeof f.seoScore === 'number');
  if (!scored.length) return null;
  return Math.round(scored.reduce((a, f) => a + f.seoScore, 0) / scored.length);
}

// =====================================================================
// NAVIGATION
// =====================================================================
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  search: 'Firmensuche',
  firmen: 'Meine Firmen',
  settings: 'Einstellungen',
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  $('page-' + page)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  const titleEl = $('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;
  $('sidebar')?.classList.remove('open');
  renderPage(page);
}

function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  if (page === 'search') renderSearchPage();
  if (page === 'firmen') renderFirmenPage();
}

// =====================================================================
// TOAST
// =====================================================================
let toastTimer;
function showToast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  const icon = {
    success: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z',
    error: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  }[type] || '';
  t.querySelector('.toast-icon').innerHTML = `<path d="${icon}"/>`;
  $('toastMsg').textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

// =====================================================================
// MODALS
// =====================================================================
function openModal(id) { $(id)?.classList.add('open'); }
function closeModal(id) { $(id)?.classList.remove('open'); }

// =====================================================================
// ACTIVITIES
// =====================================================================
function addActivity(a) {
  state.activities.unshift({ ...a, time: new Date().toISOString() });
  if (state.activities.length > 100) state.activities = state.activities.slice(0, 100);
}

// =====================================================================
// DASHBOARD
// =====================================================================
function renderDashboard() {
  setText('statSearches', state.stats.searches || 0);
  setText('statFirmen', state.firmen.length);
  setText('statAnalyzed', state.stats.analyzed || 0);
  setText('statExported', state.stats.exported || 0);

  updateFirmenBadge();
  renderActivities();
  renderDashboardInsights();
  updateQuickstart();
}

function setText(id, v) { const el = $(id); if (el) el.textContent = v; }

// Letzte Suchen + Top/Schwächste Firmen
function renderDashboardInsights() {
  const page = $('page-dashboard');
  if (!page) return;
  let host = $('dashInsights');
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
    ? searches.map((s, i) => `
      <button class="activity-item" style="width:100%;text-align:left;border:none;background:none;cursor:pointer;padding:10px 0"
        onclick="repeatSearch(${i})">
        <div class="activity-dot" style="background:var(--ff-blue)"></div>
        <div class="activity-body">
          <div class="activity-title">${escHtml(s.location)}${s.query ? ' · ' + escHtml(s.query) : ''}</div>
          <div class="activity-meta">${s.count || 0} Firmen · ${escHtml(s.portals === 'all' ? 'Alle Portale' : (s.portals || '').toUpperCase())}</div>
        </div>
        <span class="activity-time">${timeAgo(s.time)}</span>
      </button>`).join('')
    : `<div style="color:var(--ff-muted);font-size:13px;padding:14px 0">Noch keine Suchen. Starte oben deine erste Firmensuche.</div>`;

  // Top / schwächste Firmen
  const scored = state.firmen.filter(f => typeof f.seoScore === 'number');
  let firmenHtml;
  if (!scored.length) {
    firmenHtml = `<div style="color:var(--ff-muted);font-size:13px;padding:14px 0">Noch keine bewerteten Firmen gespeichert.</div>`;
  } else {
    const sorted = [...scored].sort((a, b) => b.seoScore - a.seoScore);
    const top = sorted.slice(0, 3);
    const worst = sorted.slice(-3).reverse().filter(f => !top.includes(f));
    const row = (f, tag) => `
      <div class="activity-item" style="padding:10px 0;cursor:pointer" onclick='analyzeWebsite(${jsArg(f.website || '')})'>
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

function repeatSearch(index) {
  const s = state.searchHistory[index];
  if (!s) return;
  navigateTo('search');
  setTimeout(() => {
    if ($('searchLocation')) $('searchLocation').value = s.location || '';
    if ($('searchQuery')) $('searchQuery').value = s.query || '';
    if (s.portals && $('searchPortals')) $('searchPortals').value = s.portals;
    searchBusinesses();
  }, 80);
}

// Dashboard-Schnellsuche (HTML hat dashSearchQuery / dashSearchLocation)
function dashQuickSearch() {
  const q = $('dashSearchQuery')?.value.trim() || '';
  const loc = $('dashSearchLocation')?.value.trim() || '';
  if (!loc) { showToast('Bitte Ort eingeben.', 'error'); return; }
  navigateTo('search');
  setTimeout(() => {
    if ($('searchLocation')) $('searchLocation').value = loc;
    if ($('searchQuery')) $('searchQuery').value = q;
    searchBusinesses();
  }, 80);
}

function renderActivities() {
  const list = $('activityList');
  if (!list) return;
  if (!state.activities.length) {
    list.innerHTML = `<div class="empty-state" style="padding:28px">
      <svg viewBox="0 0 24 24"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
      <h4>Noch keine Aktivitäten</h4>
      <p>Sobald du suchst und analysierst, siehst du hier alle Aktionen.</p>
      <button class="btn btn-primary" onclick="navigateTo('search')">Erste Suche starten</button>
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
function markStep(id) { $(id)?.classList.add('done'); }

function updateFirmenBadge() {
  const badge = $('navBadgeFirmen');
  if (!badge) return;
  if (state.firmen.length > 0) { badge.textContent = state.firmen.length; badge.style.display = ''; }
  else badge.style.display = 'none';
}

// =====================================================================
// FIRMENSUCHE
// =====================================================================
function renderSearchPage() {
  const results = $('searchResults');
  if (!results) return;
  if (!results.querySelector('.search-result-item') && !results.querySelector('.search-loading')) {
    results.innerHTML = `<div class="card"><div class="empty-state" style="padding:28px">
      <svg viewBox="0 0 24 24" style="width:48px;height:48px"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
      <h4>Firmensuche</h4>
      <p>Gib einen Ort ein und starte die Suche. Optional nach Branche filtern.</p>
    </div></div>`;
  }
}

function filterResults(f) {
  currentFilter = f;
  document.querySelectorAll('#searchResultsHeader .btn').forEach(b => b.className = 'btn btn-sm btn-ghost');
  const map = { all: 'All', website: 'Website', nowebsite: 'NoWebsite', good: 'Good' };
  const btn = $('filter' + map[f]);
  if (btn) btn.className = 'btn btn-sm btn-secondary';
  document.querySelectorAll('.search-result-item').forEach(el => {
    const hasWeb = el.dataset.haswebsite === 'true';
    const score = parseInt(el.dataset.score || '0', 10);
    let show = true;
    if (f === 'website') show = hasWeb;
    if (f === 'nowebsite') show = !hasWeb;
    if (f === 'good') show = score >= 70;
    el.style.display = show ? '' : 'none';
  });
}

function searchLoadingHtml(phase, sub) {
  return `<div class="card search-loading"><div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px;color:var(--ff-blue)">
    <div class="spinner" style="width:26px;height:26px;border-width:3px;border-color:rgba(11,92,255,.2);border-top-color:var(--ff-blue)"></div>
    <strong id="searchPhase" style="font-size:15px">${escHtml(phase)}</strong>
    <span id="searchPhaseSub" style="font-size:12px;color:var(--ff-muted)">${escHtml(sub || '')}</span>
  </div></div>`;
}
function setSearchPhase(phase, sub) {
  const p = $('searchPhase'); if (p) p.textContent = phase;
  const s = $('searchPhaseSub'); if (s !== null && sub !== undefined && $('searchPhaseSub')) $('searchPhaseSub').textContent = sub;
}

async function searchBusinesses() {
  const query = $('searchQuery')?.value.trim() || '';
  const location = $('searchLocation')?.value.trim() || '';
  const radiusKm = parseInt($('searchRadius')?.value, 10) || 10;
  const maxResults = parseInt($('searchMaxResults')?.value, 10) || 50;
  const portals = $('searchPortals')?.value || 'all';
  const doAnalyze = $('searchAnalyze')?.checked ?? true;
  const doDiscover = $('searchDiscover')?.checked ?? true;
  if (!location) { showToast('Bitte Ort / Stadt eingeben.', 'error'); return; }

  const results = $('searchResults');
  const header = $('searchResultsHeader');
  if (header) header.style.display = 'none';
  results.innerHTML = searchLoadingHtml('Portale werden abgefragt...',
    `Portale: ${portals === 'all' ? 'Alle' : portals.toUpperCase()} · Umkreis: ${radiusKm}km · Max: ${maxResults}`);

  // Phasen-Animation als Hinweis während Backend arbeitet
  const phaseTimer = setTimeout(() => setSearchPhase('Firmen werden gesammelt...'), 1400);

  try {
    const res = await fetch(API_BASE + '/api/search/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location, radius: radiusKm * 1000, maxResults, portals, analyze: doAnalyze, discover: doDiscover }),
    });
    clearTimeout(phaseTimer);
    if (!res.ok) throw new Error('Server-Fehler (' + res.status + ')');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const businesses = data.businesses || data.results || [];
    if (!businesses.length) {
      results.innerHTML = `<div class="card"><div class="empty-state" style="padding:28px">
        <svg viewBox="0 0 24 24" style="width:48px;height:48px"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
        <h4>Keine Ergebnisse</h4>
        <p>Für "${escHtml(query || 'alle Branchen')}" in "${escHtml(location)}" wurden keine Firmen gefunden.</p>
      </div></div>`;
      return;
    }

    setSearchPhase(`${businesses.length} Firmen gefunden, analysiere Websites...`);
    window._lastSearchResults = businesses;

    const sources = data.sources || [];
    const sourceInfo = sources.length ? `<div class="info-box" style="margin-bottom:12px;font-size:12px">
      <strong>Quellen:</strong> ${sources.map(s => escHtml(s)).join(' · ')} — ${businesses.length} Ergebnisse
    </div>` : '';

    results.innerHTML = sourceInfo + businesses.map((biz, i) => renderResultCard(biz, i)).join('');

    // Info-Leiste
    const withSite = businesses.filter(b => b.siteOnline).length;
    const noSite = businesses.filter(b => !b.hasWebsite).length;
    const good = businesses.filter(b => (b.seoScore || 0) >= 70).length;
    const discovered = businesses.filter(b => b.websiteDiscovered).length;
    if (header) header.style.display = '';
    const info = $('searchResultsInfo');
    if (info) info.innerHTML = `
      <strong>${businesses.length}</strong> Firmen ·
      <span style="color:var(--ff-success)">${withSite} mit Website</span> ·
      <span style="color:var(--ff-danger)">${noSite} ohne</span> ·
      <span style="color:var(--ff-blue)">${good} SEO 70+</span>
      ${discovered ? ` · <span style="color:var(--ff-blue)">${discovered} entdeckt</span>` : ''}
      ${(data.count && data.showing && data.showing < data.count) ? ` · <span style="color:var(--ff-muted)">${data.count} total, ${data.showing} angezeigt</span>` : ''}`;
    filterResults('all');

    // Stats + History
    state.stats.searches = (state.stats.searches || 0) + 1;
    state.stats.analyzed = (state.stats.analyzed || 0) + withSite;
    state.searchHistory.unshift({ location, query, portals, count: businesses.length, time: new Date().toISOString() });
    if (state.searchHistory.length > 30) state.searchHistory = state.searchHistory.slice(0, 30);
    addActivity({ title: `Firmensuche: ${location}${query ? ' · ' + query : ''}`, meta: `${businesses.length} Firmen, ${withSite} mit Website`, status: 'success', color: '#0b5cff' });
    saveState();
    showToast(`${businesses.length} Firmen gefunden!`, 'success');
  } catch (e) {
    clearTimeout(phaseTimer);
    results.innerHTML = `<div class="card"><div class="seo-check-item fail" style="margin:8px"><span>Fehler bei der Suche: ${escHtml(e.message)}</span></div></div>`;
    showToast('Fehler bei der Suche: ' + e.message, 'error');
  }
}

function renderResultCard(biz, i) {
  const saved = state.firmen.some(f => f.name.toLowerCase() === (biz.name || '').toLowerCase());
  const hasWeb = !!(biz.hasWebsite && biz.website);
  const online = !!biz.siteOnline;
  const seo = biz.seoScore || 0;
  const usable = hasWeb && online;
  const scoreColor = !hasWeb ? '#8895b0' : !online ? 'var(--ff-danger)' : scoreColorFor(seo);

  const pills = usable ? [
    biz.https ? '🔒 HTTPS' : '⚠️ HTTP',
    biz.mobile ? '📱 Mobil' : '❌ Nicht mobil',
    biz.loadTime ? `⚡ ${biz.loadTime}s` : '',
    biz.wordCount ? `📝 ${biz.wordCount} W` : '',
    biz.hasSchema ? '✅ Schema' : '',
  ].filter(Boolean) : [];

  return `<div class="search-result-item" id="search-result-${i}" data-haswebsite="${usable}" data-score="${seo}" style="${!hasWeb ? 'opacity:.55' : ''}">
    <div class="search-result-favicon" style="background:${scoreColor}">
      ${usable ? seo : escHtml((biz.name || '?')[0].toUpperCase())}
    </div>
    <div class="search-result-body">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="search-result-name">${escHtml(biz.name)}</div>
        ${biz.category ? `<span class="search-result-category">${escHtml(biz.category)}</span>` : ''}
        ${biz.source ? `<span class="badge badge-blue">${escHtml(biz.source)}</span>` : ''}
        ${!hasWeb ? `<span class="badge badge-error" style="font-size:9px">Potentieller Neukunde</span>` : ''}
      </div>

      ${usable
        ? `<div style="margin:6px 0 4px;display:flex;gap:4px;flex-wrap:wrap">${pills.map(p => `<span class="badge" style="font-size:10px;background:var(--ff-bg-soft,#f5f5f7);color:var(--ff-text-soft,#333);border:.5px solid var(--ff-line,rgba(0,0,0,.08))">${p}</span>`).join('')}</div>`
        : hasWeb
        ? '<div style="margin:4px 0;font-size:11px;color:#ff9f0a;font-weight:600">⚠️ Website nicht erreichbar</div>'
        : '<div style="margin:4px 0;font-size:11px;color:var(--ff-danger);font-weight:600">Keine Website — potentieller Neukunde</div>'}
      ${biz.siteTitle && online ? `<div style="font-size:11px;color:var(--ff-muted);margin-bottom:3px">${escHtml(biz.siteTitle)}</div>` : ''}
      ${biz.websiteDiscovered ? '<span class="badge badge-blue" style="font-size:9px">Website via Recherche gefunden</span>' : ''}

      <div class="search-result-meta">
        ${biz.address ? `<span>📍 ${escHtml(biz.address)}</span>` : ''}
        ${biz.phone ? `<span>📞 <a href="tel:${escAttr(biz.phone)}">${escHtml(biz.phone)}</a></span>` : ''}
        ${biz.email ? `<span>✉ <a href="mailto:${escAttr(biz.email)}">${escHtml(biz.email)}</a></span>` : ''}
        ${biz.website ? `<span>🌐 <a href="${escAttr(biz.website)}" target="_blank" rel="noopener">${escHtml(biz.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 35))}</a></span>` : ''}
      </div>
    </div>
    <div class="search-result-actions">
      <button class="btn btn-sm ${saved ? 'btn-success' : 'btn-primary'}" id="save-btn-${i}"
        onclick="saveFirma(${i})" ${saved ? 'disabled' : ''}>
        ${saved ? '✓ Gespeichert' : '★ Speichern'}
      </button>
      ${biz.website ? `<button class="btn btn-sm btn-secondary" onclick='analyzeWebsite(${jsArg(biz.website)})'>SEO Details</button>` : ''}
    </div>
  </div>`;
}

// =====================================================================
// WEBSITE ANALYSE MODAL
// =====================================================================
async function analyzeWebsite(url) {
  if (!url) { showToast('Keine Website-URL vorhanden.', 'error'); return; }
  openModal('analyzeModal');
  setText('analyzeModalTitle', `Analyse: ${url}`);
  $('analyzeModalBody').innerHTML = `<div style="display:flex;justify-content:center;align-items:center;gap:12px;padding:40px;color:var(--ff-blue)">
    <div class="spinner" style="border-color:rgba(11,92,255,.3);border-top-color:var(--ff-blue)"></div>
    Website wird analysiert...
  </div>`;

  try {
    const res = await fetch(API_BASE + '/api/websites/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error('Server-Fehler (' + res.status + ')');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const s = data.seoScore || 0;
    const scoreColor = scoreColorFor(s);
    const imgs = data.images || {};
    const https = data.https ?? url.startsWith('https://');

    const checks = [
      { ok: !!data.title, label: data.title ? `Title: "${escHtml(data.title.slice(0, 60))}"` : 'Kein <title>-Tag' },
      { ok: !!data.metaDescription, label: data.metaDescription ? `Meta: "${escHtml(data.metaDescription.slice(0, 80))}"` : 'Keine Meta Description' },
      { ok: data.h1Tags?.length === 1, label: data.h1Tags?.length ? `${data.h1Tags.length} H1-Tag(s): "${escHtml((data.h1Tags[0] || '').slice(0, 50))}"` : 'Kein H1-Tag' },
      { ok: !!https, label: https ? 'HTTPS aktiv (SSL)' : 'Kein HTTPS — auf SSL umstellen' },
      { ok: !!data.hasViewport, label: data.hasViewport ? 'Mobile-optimiert (Viewport)' : 'Kein Viewport — nicht mobil-optimiert' },
      { ok: (data.wordCount || 0) >= 300, label: `${data.wordCount || 0} Wörter` + ((data.wordCount || 0) < 300 ? ' (mind. 300 empfohlen)' : '') },
      { ok: imgs.withoutAlt === 0, label: `${imgs.total || 0} Bilder, ${imgs.withoutAlt || 0} ohne Alt-Text` },
      { ok: (data.loadTime || 0) < 3 && data.loadTime != null, label: `Ladezeit: ${data.loadTime ?? '?'}s` },
    ];

    const recs = seoRecommendations(buildSeoData({ ...data, url, https }));
    const recsHtml = (s < 70 && recs.length) ? `
      <div style="margin-top:18px">
        <div style="font-size:13px;font-weight:900;color:var(--ff-navy);margin-bottom:8px">Empfehlungen</div>
        <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px">
          ${recs.map(r => `<li style="font-size:13px;color:var(--ff-text-soft)">${escHtml(r)}</li>`).join('')}
        </ul>
      </div>` : '';

    // Daten für "Firma speichern" aus dem Modal verfügbar machen
    window._lastAnalysis = { url, data, score: s, https };

    $('analyzeModalBody').innerHTML = `
      <div style="display:flex;align-items:center;gap:24px;margin-bottom:20px;flex-wrap:wrap">
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
        <div style="flex:1;min-width:200px">
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
      </div>
      ${recsHtml}
      <div style="display:flex;gap:8px;margin-top:18px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="closeModal('analyzeModal')">Schließen</button>
        <button class="btn btn-primary" onclick="saveFirmaFromAnalysis()">★ Firma speichern</button>
      </div>`;

    state.stats.analyzed = (state.stats.analyzed || 0) + 1;
    addActivity({ title: `Website analysiert: ${data.title || url}`, meta: `Score: ${s}/100`, status: s >= 50 ? 'success' : 'error', color: scoreColor });
    saveState();
    showToast(`Analyse abgeschlossen! Score: ${s}/100`, 'success');
  } catch (e) {
    $('analyzeModalBody').innerHTML = `<div class="seo-check-item fail" style="margin:8px"><span>Fehler: ${escHtml(e.message)}</span></div>`;
    showToast('Analyse-Fehler: ' + e.message, 'error');
  }
}

function saveFirmaFromAnalysis() {
  const a = window._lastAnalysis;
  if (!a) { showToast('Keine Analysedaten vorhanden.', 'error'); return; }
  const d = a.data;
  const name = d.title || a.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  if (state.firmen.some(f => f.name.toLowerCase() === name.toLowerCase())) {
    showToast('Firma bereits gespeichert.', 'info');
    return;
  }
  const sd = buildSeoData({ ...d, url: a.url, https: a.https });
  const firma = {
    id: genId(),
    name,
    address: '',
    phone: '',
    email: '',
    website: a.url,
    category: '',
    source: 'Analyse',
    seoScore: typeof a.score === 'number' ? a.score : null,
    seoData: sd,
    savedAt: new Date().toISOString(),
    notes: '',
  };
  state.firmen.push(firma);
  addActivity({ title: `Firma "${firma.name}" gespeichert`, meta: 'aus Analyse', status: 'success', color: '#087a43' });
  saveState();
  updateFirmenBadge();
  showToast(`"${firma.name}" gespeichert!`, 'success');
}

// =====================================================================
// FIRMA SPEICHERN (aus Suchergebnis)
// =====================================================================
function saveFirma(index) {
  const biz = window._lastSearchResults?.[index];
  if (!biz) return;
  if (state.firmen.some(f => f.name.toLowerCase() === (biz.name || '').toLowerCase())) {
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
    seoScore: typeof biz.seoScore === 'number' ? biz.seoScore : (biz._seoScore ?? null),
    // ALLE verfügbaren Daten übernehmen
    seoData: {
      online: biz.siteOnline ?? false,
      siteTitle: biz.siteTitle || '',
      metaDesc: biz.metaDescription || biz.metaDesc || '',
      h1: biz.h1 || '',
      title: !!biz.siteTitle,
      metaDescription: biz.metaDescription !== undefined ? !!biz.metaDescription : (biz.seoScore > 20),
      hasH1: biz.h1 ? true : (biz.seoScore > 35),
      hasMobile: biz.mobile ?? (biz.seoScore > 50),
      https: biz.https ?? (biz.website || '').startsWith('https://'),
      loadTime: biz.loadTime ?? null,
      wordCount: biz.wordCount ?? null,
      hasSchema: biz.hasSchema ?? undefined,
      ...(biz._seoData ? buildSeoData(biz._seoData) : {}),
    },
    savedAt: new Date().toISOString(),
    notes: '',
  };
  state.firmen.push(firma);
  const btn = $(`save-btn-${index}`);
  if (btn) { btn.textContent = '✓ Gespeichert'; btn.className = 'btn btn-sm btn-success'; btn.disabled = true; }
  updateFirmenBadge();
  addActivity({ title: `Firma "${firma.name}" gespeichert`, meta: firma.category, status: 'success', color: '#087a43' });
  saveState();
  showToast(`"${firma.name}" gespeichert!`, 'success');
}

// Aus Firma eine verbundene Website machen (Legacy-Funktion, von Firmen-Karte genutzt)
function addBusinessAsWebsite(biz) {
  if (!biz || !biz.website) return;
  if (state.websites.find(w => w.url === biz.website)) {
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
  addActivity({ title: `Website "${w.name}" hinzugefügt`, meta: w.url, status: 'success', color: '#087a43' });
  saveState();
  showToast(`"${w.name}" als Website hinzugefügt!`, 'success');
}

// =====================================================================
// FIRMEN SEITE
// =====================================================================
function renderFirmenPage() {
  updateFirmenBadge();
  const container = $('firmenList');
  if (!container) return;

  if (!state.firmen.length) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z"/></svg>
      <h4>Noch keine Firmen gespeichert</h4>
      <p>Suche nach Unternehmen und speichere interessante Firmen hier.</p>
      <button class="btn btn-primary" onclick="navigateTo('search')">Firmensuche starten</button>
    </div>`;
    return;
  }

  // Zusammenfassung
  const total = state.firmen.length;
  const withWeb = state.firmen.filter(f => f.website).length;
  const avg = firmenAvgScore();

  // Filtern + Sortieren
  let list = state.firmen.slice();
  if (firmenSearch) {
    const q = firmenSearch.toLowerCase();
    list = list.filter(f =>
      (f.name || '').toLowerCase().includes(q) ||
      (f.category || '').toLowerCase().includes(q) ||
      (f.address || '').toLowerCase().includes(q) ||
      (f.website || '').toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    if (firmenSort === 'name') return (a.name || '').localeCompare(b.name || '', 'de');
    if (firmenSort === 'score') return (b.seoScore ?? -1) - (a.seoScore ?? -1);
    return new Date(b.savedAt || 0) - new Date(a.savedAt || 0); // date
  });

  const opt = (val, label) => `<option value="${val}" ${firmenSort === val ? 'selected' : ''}>${label}</option>`;

  const toolbar = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:22px;font-weight:950;color:var(--ff-navy)">${total}</span><span style="font-size:12px;color:var(--ff-muted)">Firmen</span></div>
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:22px;font-weight:950;color:var(--ff-success)">${withWeb}</span><span style="font-size:12px;color:var(--ff-muted)">mit Website</span></div>
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:22px;font-weight:950;color:${scoreColorFor(avg)}">${avg ?? '—'}</span><span style="font-size:12px;color:var(--ff-muted)">Ø SEO Score</span></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <input type="text" class="form-input" id="firmenSearchInput" placeholder="Firmen filtern..." value="${escAttr(firmenSearch)}"
        oninput="onFirmenSearch(this.value)" style="flex:1;min-width:200px;margin:0" />
      <select class="form-input" id="firmenSortSelect" onchange="onFirmenSort(this.value)" style="max-width:200px;margin:0">
        ${opt('date', 'Datum ↓ (neueste)')}
        ${opt('score', 'SEO Score ↓')}
        ${opt('name', 'Name A–Z')}
      </select>
      <button class="btn btn-secondary" onclick="exportFirmen()">CSV</button>
      <button class="btn btn-secondary" onclick="exportFirmenJSON()">JSON</button>
    </div>`;

  const cards = list.length
    ? list.map(f => renderFirmaCard(f)).join('')
    : `<div class="empty-state" style="padding:32px"><h4>Keine Treffer</h4><p>Kein Ergebnis für "${escHtml(firmenSearch)}".</p></div>`;

  container.innerHTML = toolbar + cards;
}

function onFirmenSearch(v) {
  firmenSearch = v;
  // Nur Karten neu rendern, Fokus im Suchfeld behalten
  const container = $('firmenList');
  const input = $('firmenSearchInput');
  const pos = input ? input.selectionStart : null;
  renderFirmenPage();
  const newInput = $('firmenSearchInput');
  if (newInput) { newInput.focus(); if (pos != null) newInput.setSelectionRange(pos, pos); }
}
function onFirmenSort(v) { firmenSort = v; renderFirmenPage(); }

function renderFirmaCard(f) {
  const s = f.seoScore;
  const hasWeb = !!f.website;
  const online = f.seoData?.online !== false && hasWeb;
  const sd = f.seoData || {};
  const scoreColor = hasWeb ? scoreColorFor(s) : 'var(--ff-muted)';

  const pill = (ok, on, off) => ok
    ? `<span class="badge badge-success" style="font-size:9px">✓ ${on}</span>`
    : `<span class="badge badge-error" style="font-size:9px">✗ ${off}</span>`;

  return `<div class="website-item" style="align-items:flex-start;padding:20px;margin-bottom:12px">
    <div style="width:56px;height:56px;border-radius:14px;background:${scoreColor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${typeof s === 'number' ? '18px' : '22px'};font-weight:950;flex-shrink:0">
      ${typeof s === 'number' ? s : escHtml((f.name || '?')[0])}
    </div>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
        <strong style="font-size:16px;color:var(--ff-navy)">${escHtml(f.name)}</strong>
        ${f.category ? `<span class="search-result-category">${escHtml(f.category)}</span>` : ''}
        ${f.source ? `<span class="badge badge-blue" style="font-size:9px">${escHtml(f.source)}</span>` : ''}
        <span class="badge ${typeof s === 'number' ? scoreBadgeClass(s) : ''}" style="font-size:10px">
          ${hasWeb ? (online ? `SEO ${typeof s === 'number' ? s : '?'}/100` : '⚠️ Offline') : '🚫 Keine Website'}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px;font-size:13px;margin-bottom:8px">
        ${f.address ? `<div style="display:flex;gap:6px;align-items:flex-start"><span style="color:var(--ff-muted);flex-shrink:0">📍</span><span>${escHtml(f.address)}</span></div>` : ''}
        ${f.phone ? `<div><span style="color:var(--ff-muted)">📞</span> <a href="tel:${escAttr(f.phone)}" style="font-weight:750">${escHtml(f.phone)}</a></div>` : '<div><span style="color:var(--ff-muted)">📞</span> <span style="color:var(--ff-danger);font-size:12px">Nicht verfügbar</span></div>'}
        ${f.email ? `<div><span style="color:var(--ff-muted)">✉</span> <a href="mailto:${escAttr(f.email)}" style="font-weight:750">${escHtml(f.email)}</a></div>` : '<div><span style="color:var(--ff-muted)">✉</span> <span style="color:var(--ff-danger);font-size:12px">Nicht verfügbar</span></div>'}
        ${f.website ? `<div><span style="color:var(--ff-muted)">🌐</span> <a href="${escAttr(f.website)}" target="_blank" rel="noopener" style="font-weight:750;word-break:break-all">${escHtml(f.website.replace(/^https?:\/\//, ''))}</a></div>` : '<div><span style="color:var(--ff-muted)">🌐</span> <span style="color:var(--ff-danger);font-size:12px">Keine Website</span></div>'}
      </div>

      ${hasWeb ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        ${pill(sd.title, 'Title', 'Kein Title')}
        ${pill(sd.metaDescription, 'Meta', 'Keine Meta')}
        ${pill(sd.hasH1, 'H1', 'Kein H1')}
        ${pill(sd.https, 'HTTPS', 'Kein HTTPS')}
        ${pill(sd.hasMobile, 'Mobil', 'Nicht mobil')}
        ${sd.loadTime != null ? `<span class="badge badge-blue" style="font-size:9px">⚡ ${sd.loadTime}s</span>` : ''}
        ${sd.wordCount != null ? `<span class="badge badge-blue" style="font-size:9px">${sd.wordCount} Wörter</span>` : ''}
      </div>` : ''}

      ${sd.siteTitle ? `<div style="font-size:11px;color:var(--ff-muted);font-style:italic">Seitentitel: "${escHtml(sd.siteTitle)}"</div>` : ''}
      <div style="font-size:11px;color:var(--ff-muted);margin-top:4px">Gespeichert: ${fmtDate(f.savedAt)} · Quelle: ${escHtml(f.source || '—')}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      ${f.website ? `<button class="btn btn-sm btn-secondary" onclick='analyzeWebsite(${jsArg(f.website)})'>SEO Details</button>` : ''}
      ${f.website ? `<button class="btn btn-sm btn-primary" onclick='addBusinessAsWebsite(${jsArg({ name: f.name, website: f.website, category: f.category })})'>→ Website</button>` : ''}
      <button class="btn btn-sm btn-danger" onclick="deleteFirma('${escAttr(f.id)}')">Entfernen</button>
    </div>
  </div>`;
}

function deleteFirma(id) {
  state.firmen = state.firmen.filter(f => f.id !== id);
  saveState();
  renderFirmenPage();
  updateFirmenBadge();
  showToast('Firma entfernt.', 'success');
}

// =====================================================================
// EXPORT
// =====================================================================
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportFirmen() {
  if (!state.firmen.length) { showToast('Keine Firmen zum Exportieren.', 'error'); return; }
  const header = ['Name', 'Branche', 'Adresse', 'Telefon', 'Email', 'Website', 'SEO Score', 'HTTPS', 'Mobile', 'Ladezeit', 'Wörter', 'Quelle', 'Gespeichert'].join(';');
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const yn = b => b === true ? 'Ja' : b === false ? 'Nein' : '';
  const rows = state.firmen.map(f => {
    const sd = f.seoData || {};
    return [
      f.name, f.category, f.address, f.phone, f.email, f.website,
      f.seoScore ?? '', yn(sd.https), yn(sd.hasMobile),
      sd.loadTime != null ? sd.loadTime + 's' : '', sd.wordCount ?? '',
      f.source, fmtDate(f.savedAt),
    ].map(cell).join(';');
  });
  const csv = '﻿' + header + '\n' + rows.join('\n');
  downloadBlob(csv, `seo-solutions-firmen-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
  state.stats.exported = (state.stats.exported || 0) + 1;
  saveState();
  showToast(`${state.firmen.length} Firmen als CSV exportiert!`, 'success');
}

function exportFirmenJSON() {
  if (!state.firmen.length) { showToast('Keine Firmen zum Exportieren.', 'error'); return; }
  const json = JSON.stringify(state.firmen, null, 2);
  downloadBlob(json, `seo-solutions-firmen-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  state.stats.exported = (state.stats.exported || 0) + 1;
  saveState();
  showToast(`${state.firmen.length} Firmen als JSON exportiert!`, 'success');
}

// =====================================================================
// SETTINGS
// =====================================================================
function saveApiKey() {
  const key = $('anthropicKey')?.value.trim();
  if (!key) { showToast('Bitte API Key eingeben.', 'error'); return; }
  state.settings.anthropicKey = key;
  saveState();
  showToast('API Key gespeichert!', 'success');
  updateAiEngineStatus();
}

async function testApiKey() {
  const box = $('apiStatusBox');
  if (!box) return;
  const key = state.settings.anthropicKey || $('anthropicKey')?.value.trim();
  if (!key) {
    box.textContent = 'Bitte zuerst einen API Key eingeben.';
    box.style.borderLeftColor = 'var(--ff-danger)';
    return;
  }
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
  if ($('aiModel')) state.settings.aiModel = $('aiModel').value;
  if ($('thinkingMode')) state.settings.thinkingMode = $('thinkingMode').value;
  if ($('defaultInterval')) state.settings.defaultInterval = $('defaultInterval').value;
  if ($('maxJobs')) state.settings.maxJobs = parseInt($('maxJobs').value, 10);
  if ($('autoApprove')) state.settings.autoApprove = $('autoApprove').classList.contains('on');
  if ($('seoTracking')) state.settings.seoTracking = $('seoTracking').classList.contains('on');
  if ($('saveVersions')) state.settings.saveVersions = $('saveVersions').classList.contains('on');
  if ($('defaultLang')) state.settings.defaultLang = $('defaultLang').value;
  saveState();
  showToast('Einstellungen gespeichert!', 'success');
  updateAiEngineStatus();
}

function loadSettings() {
  if (state.settings.aiModel && $('aiModel')) $('aiModel').value = state.settings.aiModel;
  if (state.settings.thinkingMode && $('thinkingMode')) $('thinkingMode').value = state.settings.thinkingMode;
  if (state.settings.defaultInterval && $('defaultInterval')) $('defaultInterval').value = state.settings.defaultInterval;
  if (state.settings.maxJobs && $('maxJobs')) $('maxJobs').value = state.settings.maxJobs;
  if (state.settings.defaultLang && $('defaultLang')) $('defaultLang').value = state.settings.defaultLang;
  if (state.settings.anthropicKey && $('anthropicKey')) $('anthropicKey').value = state.settings.anthropicKey;
  if (state.settings.autoApprove === false && $('autoApprove')) $('autoApprove').classList.remove('on');
  updateAiEngineStatus();
}

function updateAiEngineStatus() {
  setText('aiEngineModel', state.settings.aiModel || 'claude-opus-4-8');
}

// =====================================================================
// EVENT LISTENERS
// =====================================================================
function initEventListeners() {
  // Mobile Sidebar
  $('menuToggle')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));

  // Nav Links
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // Modal overlay schließen bei Klick auf Hintergrund
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });

  // Topbar "AI starten" -> zur Firmensuche
  $('runAiBtn')?.addEventListener('click', () => navigateTo('search'));

  // Enter-Taste startet Suche
  ['searchLocation', 'searchQuery'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchBusinesses(); } });
  });
  ['dashSearchQuery', 'dashSearchLocation'].forEach(id => {
    $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); dashQuickSearch(); } });
  });

  // ESC schließt offene Modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  });
}

// =====================================================================
// INIT
// =====================================================================
function init() {
  initEventListeners();
  loadSettings();
  renderDashboard();
  updateFirmenBadge();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
