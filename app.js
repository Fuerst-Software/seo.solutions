// ===== API CONFIG =====
// Automatische Erkennung: wenn vom iMac geladen → relativ, sonst absolute URL
const API_BASE = window.location.hostname === 'localhost' || window.location.port === '3001' || window.location.hostname === '10.0.0.230'
  ? ''
  : 'http://10.0.0.230:3001';

// ===== STATE =====
const state = {
  websites: JSON.parse(localStorage.getItem('seo_websites') || '[]'),
  zones: JSON.parse(localStorage.getItem('seo_zones') || '[]'),
  jobs: JSON.parse(localStorage.getItem('seo_jobs') || '[]'),
  activities: JSON.parse(localStorage.getItem('seo_activities') || '[]'),
  settings: JSON.parse(localStorage.getItem('seo_settings') || '{}'),
  stats: JSON.parse(localStorage.getItem('seo_stats') || '{"generated":0,"successJobs":0}'),
};

let currentViewZoneId = null;
let labSelectedType = 'text';
let labSelectedTone = 'professionell';
let lastLabResult = '';
let labHistory = [];

function saveState() {
  localStorage.setItem('seo_websites', JSON.stringify(state.websites));
  localStorage.setItem('seo_zones', JSON.stringify(state.zones));
  localStorage.setItem('seo_jobs', JSON.stringify(state.jobs));
  localStorage.setItem('seo_activities', JSON.stringify(state.activities));
  localStorage.setItem('seo_settings', JSON.stringify(state.settings));
  localStorage.setItem('seo_stats', JSON.stringify(state.stats));
}

// ===== NAVIGATION =====
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  websites: 'Websites',
  zones: 'Content Zones',
  'ai-lab': 'AI Labor',
  'ai-jobs': 'AI Jobs',
  analytics: 'Analytics',
  'seo-check': 'SEO Checker',
  snippet: 'Embed Snippet',
  settings: 'Einstellungen',
  search: 'Firmensuche',
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
  if (page === 'websites') renderWebsites();
  if (page === 'zones') renderZones();
  if (page === 'ai-jobs') renderJobs();
  if (page === 'analytics') renderAnalytics();
  if (page === 'snippet') renderSnippetPage();
  if (page === 'ai-lab') renderLabZoneSelect();
  if (page === 'search') renderSearchPage();
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
  document.getElementById('statWebsites').textContent = state.websites.length;
  document.getElementById('statSearches').textContent = state.stats.searches || 0;
  document.getElementById('statAnalyzed').textContent = state.stats.analyzed || 0;
  document.getElementById('statGenerated').textContent = state.stats.generated || 0;

  updateNavBadges();
  renderActivities();
  updateQuickstart();
}

function dashQuickSearch() {
  const q = document.getElementById('dashSearchQuery').value.trim();
  const loc = document.getElementById('dashSearchLocation').value.trim();
  if (!q || !loc) { showToast('Bitte Branche und Ort eingeben.', 'error'); return; }
  navigateTo('search');
  setTimeout(() => {
    document.getElementById('searchQuery').value = q;
    document.getElementById('searchLocation').value = loc;
    searchBusinesses();
  }, 50);
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
  if (state.websites.length > 0) markStep('step1');
  if (state.websites.length > 0) markStep('step2');
  if (state.zones.length > 0) markStep('step3');
  if (state.jobs.length > 0) markStep('step4');
}

function markStep(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('done');
}

// ===== WEBSITES =====
function renderWebsites() {
  const empty = document.getElementById('websitesEmpty');
  const list = document.getElementById('websitesList');
  if (!state.websites.length) {
    empty.style.display = '';
    list.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  list.style.display = '';
  list.innerHTML = state.websites.map(w => {
    const zones = state.zones.filter(z => z.websiteId === w.id).length;
    const jobs = state.jobs.filter(j => j.websiteId === w.id).length;
    return `<div class="website-item">
      <div class="website-favicon">${(w.name || w.url)[0].toUpperCase()}</div>
      <div class="website-info">
        <div class="website-name">${escHtml(w.name || w.url)}</div>
        <div class="website-url">${escHtml(w.url)}</div>
        <div class="website-stats">
          <span class="website-stat">${zones} Zones</span>
          <span class="website-stat">${jobs} Jobs</span>
          <span class="website-stat">API: <code>${w.apiKey.slice(0, 16)}…</code></span>
          ${w.industry ? `<span class="website-stat">${escHtml(w.industry)}</span>` : ''}
        </div>
        ${w.keywords ? `<div class="kw-tags" style="margin-top:6px">${w.keywords.split(',').map(k => `<span class="kw-tag">${escHtml(k.trim())}</span>`).join('')}</div>` : ''}
      </div>
      <div class="website-actions">
        <button class="btn btn-sm btn-secondary" onclick="viewSnippetForWebsite('${w.id}')">Snippet</button>
        <button class="btn btn-sm btn-primary" onclick="quickAddZone('${w.id}')">+ Zone</button>
        <button class="btn btn-sm btn-danger" onclick="deleteWebsite('${w.id}')">Löschen</button>
      </div>
    </div>`;
  }).join('');
}

function addWebsite() {
  const url = document.getElementById('websiteUrl').value.trim();
  const name = document.getElementById('websiteName').value.trim();
  const keywords = document.getElementById('websiteKeywords').value.trim();
  const lang = document.getElementById('websiteLang').value;
  const industry = document.getElementById('websiteIndustry').value.trim();
  if (!url) { showToast('Bitte URL eingeben.', 'error'); return; }
  const w = { id: genId(), url, name: name || url, keywords, lang, industry, apiKey: genApiKey(), createdAt: new Date().toISOString() };
  state.websites.push(w);
  addActivity({ title: `Website "${w.name}" verbunden`, meta: w.url, status: 'success', color: '#0b5cff' });
  saveState();
  closeModal('addWebsiteModal');
  document.getElementById('websiteUrl').value = '';
  document.getElementById('websiteName').value = '';
  document.getElementById('websiteKeywords').value = '';
  document.getElementById('websiteIndustry').value = '';
  showToast('Website erfolgreich hinzugefügt!', 'success');
  renderWebsites();
  renderDashboard();
}

function deleteWebsite(id) {
  if (!confirm('Website wirklich entfernen? Alle zugehörigen Zones und Jobs werden gelöscht.')) return;
  state.websites = state.websites.filter(w => w.id !== id);
  state.zones = state.zones.filter(z => z.websiteId !== id);
  state.jobs = state.jobs.filter(j => j.websiteId !== id);
  saveState();
  renderWebsites();
  renderDashboard();
  showToast('Website entfernt.', 'success');
}

function viewSnippetForWebsite(id) {
  const w = state.websites.find(x => x.id === id);
  if (!w) return;
  navigateTo('snippet');
  setTimeout(() => updateSnippetDisplay(w.apiKey), 80);
}

function quickAddZone(websiteId) {
  populateZoneWebsiteSelect(websiteId);
  openModal('addZoneModal');
}

// ===== ZONES =====
function renderZones() {
  const grid = document.getElementById('zonesGrid');
  if (!state.zones.length) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1">
      <div class="empty-state">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        <h4>Keine Content Zones</h4>
        <p>Füge zuerst eine Website hinzu und definiere dann Bereiche, die die KI verändern soll.</p>
      </div>
    </div>`;
    return;
  }
  grid.innerHTML = state.zones.map(z => {
    const w = state.websites.find(x => x.id === z.websiteId);
    const versions = z.versions?.length || 0;
    return `<div class="zone-card">
      <div class="zone-card-top">
        <span class="zone-type-badge">${zoneTypeLabel(z.type)}</span>
        <span class="badge badge-${versions > 0 ? 'success' : 'pending'}">${versions} Vers.</span>
      </div>
      <h4>${escHtml(z.zoneId)}</h4>
      <div class="zone-card-site">${escHtml(w?.name || 'Unbekannte Website')}</div>
      ${z.prompt ? `<div class="zone-card-prompt">${escHtml(z.prompt)}</div>` : ''}
      ${z.currentContent ? `<div class="zone-card-content">${escHtml(z.currentContent)}</div>` : ''}
      <div class="zone-actions">
        <button class="btn btn-sm btn-primary" onclick="runZoneJob('${z.id}')">
          <svg viewBox="0 0 24 24"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
          AI ausführen
        </button>
        <button class="btn btn-sm btn-secondary" onclick="openViewZone('${z.id}')">Details</button>
        <button class="btn btn-sm btn-danger" onclick="deleteZone('${z.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function openAddZoneModal() {
  populateZoneWebsiteSelect();
  openModal('addZoneModal');
}

function populateZoneWebsiteSelect(preselect) {
  const sel = document.getElementById('zoneWebsite');
  if (!state.websites.length) {
    sel.innerHTML = '<option value="">— Erst Website hinzufügen —</option>';
    return;
  }
  sel.innerHTML = state.websites.map(w =>
    `<option value="${w.id}" ${preselect === w.id ? 'selected' : ''}>${escHtml(w.name || w.url)}</option>`
  ).join('');
}

function addZone() {
  const websiteId = document.getElementById('zoneWebsite').value;
  const zoneId = document.getElementById('zoneId').value.trim();
  const type = document.getElementById('zoneType').value;
  const prompt = document.getElementById('zonePrompt').value.trim();
  const content = document.getElementById('zoneContent').value.trim();
  if (!websiteId) { showToast('Bitte Website wählen.', 'error'); return; }
  if (!zoneId) { showToast('Bitte Zone ID eingeben.', 'error'); return; }
  const zone = { id: genId(), websiteId, zoneId, type, prompt, currentContent: content, versions: [], createdAt: new Date().toISOString() };
  state.zones.push(zone);
  addActivity({ title: `Zone "${zoneId}" erstellt`, meta: zoneTypeLabel(type), status: 'success', color: '#0b5cff' });
  saveState();
  closeModal('addZoneModal');
  ['zoneId','zonePrompt','zoneContent'].forEach(id => document.getElementById(id).value = '');
  showToast('Content Zone gespeichert!', 'success');
  renderZones();
  renderDashboard();
}

function deleteZone(id) {
  if (!confirm('Zone wirklich löschen?')) return;
  state.zones = state.zones.filter(z => z.id !== id);
  state.jobs = state.jobs.filter(j => j.zoneId !== id);
  saveState();
  renderZones();
  renderDashboard();
  showToast('Zone gelöscht.', 'success');
}

function openViewZone(id) {
  const zone = state.zones.find(z => z.id === id);
  if (!zone) return;
  currentViewZoneId = id;
  document.getElementById('viewZoneTitle').textContent = `Zone: ${zone.zoneId}`;
  document.getElementById('viewZoneContent').textContent = zone.currentContent || '(noch kein Inhalt)';
  document.getElementById('viewZonePrompt').textContent = zone.prompt || '(keine Anweisung)';
  const timeline = document.getElementById('versionsTimeline');
  if (!zone.versions?.length) {
    timeline.innerHTML = `<div style="color:var(--ff-muted);font-size:13px;text-align:center;padding:20px">Noch keine Versionen vorhanden.</div>`;
  } else {
    timeline.innerHTML = zone.versions.slice(0, 10).map((v, i) => `
      <div class="version-item ${i===0?'active':''}">
        <div class="version-num">${zone.versions.length - i}</div>
        <div class="version-body">
          <div class="version-content">${escHtml(v.content)}</div>
          <div class="version-meta">${timeAgo(v.time)}</div>
        </div>
        <button class="btn btn-sm btn-secondary" onclick="restoreVersion('${id}',${i})">Wiederherstellen</button>
      </div>`).join('');
  }
  openModal('viewZoneModal');
}

function restoreVersion(zoneId, index) {
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone || !zone.versions[index]) return;
  zone.currentContent = zone.versions[index].content;
  saveState();
  renderZones();
  openViewZone(zoneId);
  showToast('Version wiederhergestellt!', 'success');
}

async function runZoneJobFromView() {
  closeModal('viewZoneModal');
  if (currentViewZoneId) await runZoneJob(currentViewZoneId);
}

// ===== AI CONTENT GENERATION =====
async function runZoneJob(zoneId) {
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone) return;
  if (!state.settings.anthropicKey) {
    showToast('Bitte Anthropic API Key in Einstellungen hinterlegen.', 'error');
    navigateTo('settings');
    return;
  }
  showAiRunning(true);
  try {
    const res = await fetch(API_BASE + '/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneId: zone.id,
        zoneType: zone.type,
        prompt: zone.prompt,
        currentContent: zone.currentContent,
        apiKey: state.settings.anthropicKey,
        model: state.settings.aiModel || 'claude-opus-4-8',
        keywords: (state.websites.find(w => w.id === zone.websiteId)?.keywords || ''),
        lang: state.settings.defaultLang || 'de',
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (data.content) {
      zone.currentContent = data.content;
      zone.versions = zone.versions || [];
      zone.versions.unshift({ content: data.content, time: new Date().toISOString() });
      state.stats.generated = (state.stats.generated || 0) + 1;
      state.stats.successJobs = (state.stats.successJobs || 0) + 1;
      addActivity({ title: `Zone "${zone.zoneId}" aktualisiert`, meta: zoneTypeLabel(zone.type), status: 'success', color: '#087a43' });
      saveState();
      renderZones();
      renderDashboard();
      showToast('Inhalt erfolgreich generiert!', 'success');
    }
  } catch (e) {
    addActivity({ title: `Fehler bei Zone "${zone.zoneId}"`, meta: e.message, status: 'error', color: '#c03434' });
    saveState();
    showToast('Fehler: ' + e.message, 'error');
  } finally {
    showAiRunning(false);
  }
}

function showAiRunning(show) {
  const banner = document.getElementById('aiRunningBanner');
  if (banner) banner.style.display = show ? 'flex' : 'none';
}

// ===== AI LABOR =====
function renderLabZoneSelect() {
  const sel = document.getElementById('labZoneSelect');
  sel.innerHTML = '<option value="">— Freie Eingabe —</option>' +
    state.zones.map(z => {
      const w = state.websites.find(x => x.id === z.websiteId);
      return `<option value="${z.id}">${escHtml((w?.name ? w.name + ' → ' : '') + z.zoneId)}</option>`;
    }).join('');
  sel.onchange = () => {
    const zone = state.zones.find(z => z.id === sel.value);
    if (zone) {
      document.getElementById('labPrompt').value = zone.prompt || '';
      document.getElementById('labCurrentContent').value = zone.currentContent || '';
      document.getElementById('labKeywords').value = state.websites.find(w => w.id === zone.websiteId)?.keywords || '';
      // Set content type
      document.querySelectorAll('#contentTypeSelector .tone-btn').forEach(b => b.classList.remove('active'));
      document.querySelector(`#contentTypeSelector [data-type="${zone.type}"]`)?.classList.add('active');
      labSelectedType = zone.type;
    }
  };
}

// Tone & type buttons
document.querySelectorAll('#contentTypeSelector .tone-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#contentTypeSelector .tone-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    labSelectedType = btn.dataset.type;
  });
});
document.querySelectorAll('#toneSelector .tone-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#toneSelector .tone-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    labSelectedTone = btn.dataset.tone;
  });
});

async function labGenerate() {
  if (!state.settings.anthropicKey) {
    showToast('Bitte API Key in Einstellungen eingeben.', 'error');
    navigateTo('settings');
    return;
  }
  const prompt = document.getElementById('labPrompt').value.trim();
  const currentContent = document.getElementById('labCurrentContent').value.trim();
  const keywords = document.getElementById('labKeywords').value.trim();
  const zoneId = document.getElementById('labZoneSelect').value;

  const fullPrompt = [
    prompt,
    `Ton: ${labSelectedTone}`,
    keywords ? `Keywords: ${keywords}` : '',
  ].filter(Boolean).join('\n');

  setLabResult('<div class="ai-thinking-anim"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span style="margin-left:4px">Claude AI denkt nach...</span></div>', true);
  document.getElementById('copyResultBtn').style.display = 'none';
  document.getElementById('applyResultBtn').style.display = 'none';

  try {
    const res = await fetch(API_BASE + '/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneId: zoneId || null,
        zoneType: labSelectedType,
        prompt: fullPrompt,
        currentContent,
        keywords,
        apiKey: state.settings.anthropicKey,
        model: state.settings.aiModel || 'claude-opus-4-8',
        lang: state.settings.defaultLang || 'de',
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    lastLabResult = data.content;
    setLabResult(escHtml(data.content), false);
    document.getElementById('copyResultBtn').style.display = '';
    if (zoneId) document.getElementById('applyResultBtn').style.display = '';

    state.stats.generated = (state.stats.generated || 0) + 1;
    saveState();

    // Add to history
    labHistory.unshift({ type: labSelectedType, prompt: fullPrompt, result: data.content, time: new Date().toISOString() });
    renderLabHistory();

    // Quick SEO check
    runQuickSeoCheck(data.content, keywords);

    addActivity({ title: `AI Labor: ${zoneTypeLabel(labSelectedType)} generiert`, meta: keywords || prompt, status: 'success', color: '#0b5cff' });
    saveState();
    showToast('Inhalt generiert!', 'success');
  } catch (e) {
    setLabResult(`<span style="color:var(--ff-danger)">Fehler: ${escHtml(e.message)}</span>`, false);
    showToast('Fehler: ' + e.message, 'error');
  }
}

function setLabResult(html, isLoading) {
  const box = document.getElementById('aiResultBox');
  box.innerHTML = isLoading ? html : `<div style="white-space:pre-wrap;word-break:break-word">${html}</div>`;
}

function copyResult() {
  navigator.clipboard.writeText(lastLabResult).then(() => showToast('Kopiert!', 'success'));
}

function applyResult() {
  const zoneId = document.getElementById('labZoneSelect').value;
  if (!zoneId || !lastLabResult) return;
  const zone = state.zones.find(z => z.id === zoneId);
  if (!zone) return;
  zone.versions = zone.versions || [];
  zone.versions.unshift({ content: lastLabResult, time: new Date().toISOString() });
  zone.currentContent = lastLabResult;
  saveState();
  renderZones();
  showToast('Inhalt auf Zone angewendet!', 'success');
}

function clearLabHistory() {
  labHistory = [];
  renderLabHistory();
}

function renderLabHistory() {
  const el = document.getElementById('labHistory');
  if (!labHistory.length) {
    el.innerHTML = `<div style="color:var(--ff-muted);font-size:13px;text-align:center;padding:20px">Noch keine Generierungen in dieser Sitzung.</div>`;
    return;
  }
  el.innerHTML = labHistory.slice(0, 10).map((h, i) => `
    <div class="version-item">
      <div class="version-num">${labHistory.length - i}</div>
      <div class="version-body">
        <div class="version-content">${escHtml(h.result)}</div>
        <div class="version-meta">${zoneTypeLabel(h.type)} · ${timeAgo(h.time)}</div>
      </div>
      <button class="btn btn-sm btn-secondary" onclick="reuseLabResult(${i})">Verwenden</button>
    </div>`).join('');
}

function reuseLabResult(i) {
  lastLabResult = labHistory[i].result;
  setLabResult(escHtml(lastLabResult), false);
  document.getElementById('copyResultBtn').style.display = '';
  document.getElementById('aiResultBox').scrollIntoView({ behavior: 'smooth' });
}

// ===== QUICK SEO CHECK =====
function runQuickSeoCheck(text, keywords) {
  const checks = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const kws = keywords ? keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean) : [];

  // Length check
  if (words.length < 20) checks.push({ ok: false, label: `Zu kurz (${words.length} Wörter, mind. 20)` });
  else if (words.length > 300) checks.push({ ok: 'warn', label: `Sehr lang (${words.length} Wörter)` });
  else checks.push({ ok: true, label: `Gute Länge (${words.length} Wörter)` });

  // Keyword presence
  if (kws.length > 0) {
    const lower = text.toLowerCase();
    const found = kws.filter(k => lower.includes(k));
    if (found.length === kws.length) checks.push({ ok: true, label: `Alle ${kws.length} Keywords enthalten` });
    else if (found.length > 0) checks.push({ ok: 'warn', label: `${found.length}/${kws.length} Keywords gefunden` });
    else checks.push({ ok: false, label: `Keine Keywords gefunden` });
  }

  // Sentence length
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const avgWords = sentences.length > 0 ? words.length / sentences.length : 0;
  if (avgWords > 30) checks.push({ ok: 'warn', label: `Lange Sätze (Ø ${avgWords.toFixed(0)} Wörter)` });
  else checks.push({ ok: true, label: `Gute Satzlänge (Ø ${avgWords.toFixed(0)} Wörter)` });

  // No repeated words (simplistic)
  const wordFreq = {};
  words.forEach(w => { const lw = w.toLowerCase().replace(/[^a-z]/g, ''); if (lw.length > 5) wordFreq[lw] = (wordFreq[lw] || 0) + 1; });
  const overused = Object.entries(wordFreq).filter(([, c]) => c > 5);
  if (overused.length > 0) checks.push({ ok: 'warn', label: `Überbenutzte Wörter: ${overused.map(([w]) => w).slice(0,3).join(', ')}` });
  else checks.push({ ok: true, label: 'Keine Wortwiederholungen' });

  // Uppercase start
  if (text[0] && text[0] === text[0].toUpperCase()) checks.push({ ok: true, label: 'Text beginnt mit Großbuchstaben' });

  const el = document.getElementById('quickSeoCheck');
  el.innerHTML = checks.map(c => `
    <div class="seo-check-item ${c.ok === true ? 'pass' : c.ok === 'warn' ? 'warn' : 'fail'}">
      <svg class="seo-check-icon" viewBox="0 0 24 24" fill="currentColor">
        ${c.ok === true
          ? '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>'
          : c.ok === 'warn'
          ? '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>'
          : '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>'}
      </svg>
      ${escHtml(c.label)}
    </div>`).join('');
}

// ===== SEO CHECKER PAGE =====
async function runSeoCheck() {
  const content = document.getElementById('seoCheckInput').value.trim();
  const keywords = document.getElementById('seoCheckKeywords').value.trim();
  if (!content) { showToast('Bitte Text eingeben.', 'error'); return; }
  if (!state.settings.anthropicKey) {
    showToast('Bitte API Key in Einstellungen eingeben.', 'error');
    navigateTo('settings');
    return;
  }

  document.getElementById('seoCheckResult').innerHTML = `
    <div style="display:flex;justify-content:center;align-items:center;gap:12px;padding:40px;color:var(--ff-blue)">
      <div class="spinner" style="border-color:rgba(11,92,255,.3);border-top-color:var(--ff-blue)"></div>
      Claude AI analysiert...
    </div>`;

  try {
    const res = await fetch(API_BASE + '/api/ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, keywords, apiKey: state.settings.anthropicKey, model: state.settings.aiModel || 'claude-opus-4-8' }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    document.getElementById('seoScoreBadge').textContent = `Score: ${data.score || '—'}/100`;
    document.getElementById('seoScoreBadge').className = `badge ${(data.score || 0) >= 70 ? 'badge-success' : (data.score || 0) >= 40 ? 'badge-pending' : 'badge-error'}`;

    document.getElementById('seoCheckResult').innerHTML = `
      <div style="margin-bottom:16px">
        <div class="score-ring" style="margin:0 auto 16px">
          <svg viewBox="0 0 110 110" width="110" height="110">
            <circle class="score-ring-track" cx="55" cy="55" r="44"/>
            <circle class="score-ring-fill" cx="55" cy="55" r="44"
              stroke-dasharray="276.46"
              stroke-dashoffset="${276.46 - (276.46 * (data.score || 0) / 100)}"
              style="stroke:${(data.score||0) >= 70 ? 'var(--ff-success)' : (data.score||0) >= 40 ? '#ea580c' : 'var(--ff-danger)'}"/>
          </svg>
          <div class="score-ring-value">
            <strong style="color:${(data.score||0) >= 70 ? 'var(--ff-success)' : (data.score||0) >= 40 ? '#ea580c' : 'var(--ff-danger)'}">${data.score || 0}</strong>
            <span>SEO</span>
          </div>
        </div>
      </div>
      ${data.suggestions?.length ? `
      <div class="form-group">
        <label class="form-label">Verbesserungsvorschläge</label>
        ${data.suggestions.map(s => `
          <div class="seo-check-item warn" style="margin-bottom:6px">
            <svg class="seo-check-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
            ${escHtml(s)}
          </div>`).join('')}
      </div>` : ''}
      ${data.improvedContent ? `
      <div class="form-group">
        <label class="form-label">Verbesserter Text</label>
        <div class="ai-result-box" style="white-space:pre-wrap">${escHtml(data.improvedContent)}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="navigator.clipboard.writeText(${JSON.stringify(data.improvedContent)}).then(()=>showToast('Kopiert!','success'))">Kopieren</button>
      </div>` : ''}`;

    // Update analytics score
    state.stats.lastSeoScore = data.score;
    saveState();
    updateScoreRing(data.score);
    showToast('SEO-Analyse abgeschlossen!', 'success');
  } catch (e) {
    document.getElementById('seoCheckResult').innerHTML = `<div class="seo-check-item fail"><span>Fehler: ${escHtml(e.message)}</span></div>`;
    showToast('Fehler bei der Analyse.', 'error');
  }
}

// ===== JOBS =====
function renderJobs() {
  const tbody = document.getElementById('jobsBody');
  if (!state.jobs.length) {
    tbody.innerHTML = '<tr class="empty-table-row"><td colspan="7">Noch keine AI Jobs konfiguriert.</td></tr>';
    return;
  }
  tbody.innerHTML = state.jobs.map(j => {
    const zone = state.zones.find(z => z.id === j.zoneId);
    const website = state.websites.find(w => w.id === j.websiteId);
    return `<tr>
      <td><strong>${escHtml(zone?.zoneId || '—')}</strong></td>
      <td>${escHtml(website?.name || '—')}</td>
      <td>${escHtml(jobTypeLabel(j.type))}</td>
      <td>${escHtml(scheduleLabel(j.schedule))}</td>
      <td><span class="badge badge-${j.status || 'pending'}">${statusLabel(j.status || 'pending')}</span></td>
      <td>${j.lastRun ? timeAgo(j.lastRun) : '—'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-sm btn-primary" onclick="runJob('${j.id}')">Ausführen</button>
        <button class="btn btn-sm btn-danger" onclick="deleteJob('${j.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}

function openCreateJobModal() {
  const sel = document.getElementById('jobZone');
  sel.innerHTML = !state.zones.length
    ? '<option value="">— Erst Zone anlegen —</option>'
    : state.zones.map(z => {
        const w = state.websites.find(x => x.id === z.websiteId);
        return `<option value="${z.id}">${escHtml((w?.name ? w.name + ' → ' : '') + z.zoneId)}</option>`;
      }).join('');
  openModal('createJobModal');
}

function createJob() {
  const zoneId = document.getElementById('jobZone').value;
  const type = document.getElementById('jobType').value;
  const schedule = document.getElementById('jobSchedule').value;
  if (!zoneId) { showToast('Bitte Zone wählen.', 'error'); return; }
  const zone = state.zones.find(z => z.id === zoneId);
  const job = { id: genId(), zoneId, websiteId: zone?.websiteId || null, type, schedule, status: 'pending', lastRun: null, createdAt: new Date().toISOString() };
  state.jobs.push(job);
  saveState();
  closeModal('createJobModal');
  showToast('AI Job erstellt!', 'success');
  renderJobs();
  renderDashboard();
}

async function runJob(jobId) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;
  job.status = 'running';
  renderJobs();
  await runZoneJob(job.zoneId);
  job.status = 'success';
  job.lastRun = new Date().toISOString();
  saveState();
  renderJobs();
}

function deleteJob(id) {
  state.jobs = state.jobs.filter(j => j.id !== id);
  saveState();
  renderJobs();
  showToast('Job gelöscht.', 'success');
}

// ===== RUN ALL ZONES =====
document.getElementById('runAiBtn').addEventListener('click', async () => {
  if (!state.settings.anthropicKey) { showToast('Bitte API Key in Einstellungen eingeben.', 'error'); navigateTo('settings'); return; }
  if (!state.zones.length) { showToast('Keine Content Zones vorhanden.', 'error'); return; }
  showToast(`AI wird für ${state.zones.length} Zone(n) gestartet...`, 'info');
  for (const zone of state.zones) await runZoneJob(zone.id);
});

// ===== ANALYTICS =====
function renderAnalytics() {
  document.getElementById('aStatGen').textContent = state.stats.generated || 0;
  document.getElementById('aStatSuccess').textContent = state.stats.successJobs || 0;
  document.getElementById('aStatScore').textContent = state.stats.lastSeoScore ? state.stats.lastSeoScore + '/100' : '—';
  document.getElementById('aStatSites').textContent = state.websites.length;
  renderAnalyticsBars();
  updateScoreRing(state.stats.lastSeoScore || 0);
}

function renderAnalyticsBars() {
  const container = document.getElementById('analyticsBars');
  const labels = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    labels.push(d);
  }
  const actByDay = {};
  state.activities.forEach(a => {
    const day = new Date(a.time).toDateString();
    actByDay[day] = (actByDay[day] || 0) + 1;
  });
  const max = Math.max(...labels.map(d => actByDay[d.toDateString()] || 0), 1);
  container.innerHTML = labels.map((d, i) => {
    const count = actByDay[d.toDateString()] || 0;
    const h = Math.round((count / max) * 100);
    const show = i % 5 === 0;
    return `<div class="analytics-bar-wrap">
      <div class="analytics-bar" style="height:${h}%" title="${count} Aktivitäten am ${d.toLocaleDateString('de')}"></div>
      <span class="analytics-bar-label">${show ? d.getDate() + '.' : ''}</span>
    </div>`;
  }).join('');
}

function updateScoreRing(score) {
  const fill = document.getElementById('scoreRingFill');
  const num = document.getElementById('scoreRingNum');
  if (!fill || !num) return;
  const circ = 276.46;
  fill.style.strokeDashoffset = circ - (circ * score / 100);
  num.textContent = score || '—';
  const s1 = Math.min(100, Math.round(score * 1.1)); const s2 = Math.min(100, Math.round(score * 0.95)); const s3 = Math.min(100, Math.round(score * 0.9));
  ['sb1','sb2','sb3'].forEach((id, i) => { document.getElementById(id).textContent = [s1,s2,s3][i] + '/100'; });
  ['sbf1','sbf2','sbf3'].forEach((id, i) => { document.getElementById(id).style.width = [s1,s2,s3][i] + '%'; });
}

// ===== SNIPPET PAGE =====
function renderSnippetPage() {
  const sel = document.getElementById('snippetWebsiteSelect');
  sel.innerHTML = '<option value="">— Website wählen —</option>' +
    state.websites.map(w => `<option value="${w.id}">${escHtml(w.name || w.url)}</option>`).join('');
}

function updateSnippetForWebsite() {
  const id = document.getElementById('snippetWebsiteSelect').value;
  const w = state.websites.find(x => x.id === id);
  updateSnippetDisplay(w?.apiKey || 'YOUR_API_KEY');
}

function updateSnippetDisplay(apiKey) {
  document.getElementById('snippetCode').innerHTML =
    `<span class="cm">&lt;!-- seo.solutions AI Content Engine --&gt;</span>\n&lt;script&gt;\n(function() {\n  var SEO_API_KEY = '<span class="str">${escHtml(apiKey)}</span>';\n  <span class="kw">var</span> script = document.createElement(<span class="str">'script'</span>);\n  script.src = <span class="str">'https://api.seo.solutions/v1/content/embed.js?key='</span> + SEO_API_KEY;\n  script.async = <span class="kw">true</span>;\n  document.head.appendChild(script);\n})();\n&lt;/script&gt;`;
}

function copySnippet() {
  const raw = document.getElementById('snippetCode').textContent;
  navigator.clipboard.writeText(raw).then(() => showToast('Snippet kopiert!', 'success'));
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

async function searchBusinesses() {
  const query = document.getElementById('searchQuery').value.trim();
  const location = document.getElementById('searchLocation').value.trim();
  const radiusKm = parseInt(document.getElementById('searchRadius').value, 10) || 5;
  if (!query) { showToast('Bitte Branche / Suchbegriff eingeben.', 'error'); return; }
  if (!location) { showToast('Bitte Ort / Stadt eingeben.', 'error'); return; }

  const results = document.getElementById('searchResults');
  results.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;gap:12px;padding:40px;color:var(--ff-blue)">
    <div class="spinner" style="border-color:rgba(11,92,255,.3);border-top-color:var(--ff-blue)"></div>
    Firmen werden gesucht...
  </div>`;

  try {
    const res = await fetch(API_BASE + '/api/search/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location, radius: radiusKm * 1000 }),
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

    results.innerHTML = sourceInfo + businesses.map((biz, i) => {
      const stars = biz.rating ? '★'.repeat(Math.round(biz.rating)) + '☆'.repeat(5 - Math.round(biz.rating)) : '';
      return `<div class="search-result-item">
        <div class="search-result-favicon">${(biz.name || '?')[0].toUpperCase()}</div>
        <div class="search-result-body">
          <div class="search-result-name">${escHtml(biz.name)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:2px">
            ${biz.category ? `<span class="search-result-category">${escHtml(biz.category)}</span>` : ''}
            ${biz.source ? `<span class="badge badge-blue" style="font-size:9px;padding:2px 6px">${escHtml(biz.source)}</span>` : ''}
          </div>
          <div class="search-result-meta">
            ${biz.address ? `<span>📍 ${escHtml(biz.address)}</span>` : ''}
            ${biz.phone ? `<span>📞 ${escHtml(biz.phone)}</span>` : ''}
            ${biz.email ? `<span>✉ ${escHtml(biz.email)}</span>` : ''}
            ${biz.website ? `<span class="search-result-url">🌐 ${escHtml(biz.website)}</span>` : ''}
          </div>
          ${stars ? `<div class="search-result-rating">${stars} <span>${biz.rating.toFixed(1)}</span></div>` : ''}
        </div>
        <div class="search-result-actions">
          ${biz.website ? `<button class="btn btn-sm btn-primary" onclick='addBusinessAsWebsite(${JSON.stringify(biz).replace(/'/g, "&#39;")})'>+ Website</button>` : ''}
          ${biz.website ? `<button class="btn btn-sm btn-secondary" onclick='analyzeWebsite("${escHtml(biz.website)}")'>SEO Analyse</button>` : ''}
        </div>
      </div>`;
    }).join('');

    state.stats.searches = (state.stats.searches || 0) + 1;
    addActivity({ title: `Firmensuche: "${query}" in "${location}"`, meta: `${businesses.length} Ergebnisse aus ${sources.length} Portalen`, status: 'success', color: '#0b5cff' });
    saveState();
    showToast(`${businesses.length} Firmen aus ${sources.length} Portalen gefunden!`, 'success');
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

// ===== INIT =====
loadSettings();
renderDashboard();
