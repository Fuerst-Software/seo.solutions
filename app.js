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
  firmen: JSON.parse(localStorage.getItem('seo_firmen') || '[]'),
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
  localStorage.setItem('seo_firmen', JSON.stringify(state.firmen));
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
  if (page === 'websites') renderWebsites();
  if (page === 'zones') renderZones();
  if (page === 'ai-jobs') renderJobs();
  if (page === 'analytics') renderAnalytics();
  if (page === 'snippet') renderSnippetPage();
  if (page === 'ai-lab') renderLabZoneSelect();
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

  updateNavBadges();
  renderActivities();
  updateQuickstart();
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
