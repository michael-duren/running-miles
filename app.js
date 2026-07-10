'use strict';

/* ---------------- CSV ---------------- */

// RFC4180-ish: quoted fields, "" escapes, CRLF, BOM.
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  text = text.replace(/^\uFEFF/, '');
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

const parseDate = s => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(2000 + +m[3], +m[1] - 1, +m[2]);
};

// "24" -> 24 · "MARATHON 26.2" -> 26.2 · "Sat 18 / Sun 12" -> 30 · "10 easy" -> 10
const longRunMiles = s => {
  const nums = String(s).match(/\d+(?:\.\d+)?/g);
  return nums ? nums.reduce((a, b) => a + parseFloat(b), 0) : 0;
};

const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtDate = (d, opts) => d.toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
const fmtMiles = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

/* ---------------- state ---------------- */

const TODAY = startOfDay(new Date());
let ALL = [];      // every row with a date + miles
let VIEW = [];     // current filter slice
let scope = 'all';
let hoverIdx = -1;

/* ---------------- load ---------------- */

// These must not depend on the CSV resolving.
initTheme();
initOfflineBanner();
initServiceWorker();

fetch('master_running_sheet.csv', { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
  .then(text => {
    const rows = parseCSV(text);
    const head = rows[0].map(h => h.trim());
    const col = name => head.indexOf(name);
    const ci = {
      date: col('Week_Start'), miles: col('Miles'), lr: col('Long Run'),
      type: col('Type'), phase: col('Phase'), wk: col('Week_Num'), notes: col('Notes'),
    };

    ALL = rows.slice(1).map(r => {
      const date = parseDate(r[ci.date] || '');
      const milesRaw = (r[ci.miles] || '').trim();
      if (!date || milesRaw === '') return null;      // trailing unplanned weeks
      const type = (r[ci.type] || '').trim();
      const lrRaw = (r[ci.lr] || '').trim();
      const end = addDays(date, 7);
      return {
        date, end,
        miles: parseFloat(milesRaw),
        lrRaw, lr: longRunMiles(lrRaw),
        type, phase: (r[ci.phase] || '').trim(),
        wk: (r[ci.wk] || '').trim(), notes: (r[ci.notes] || '').trim(),
        isRace: type === 'Race',
        isHistorical: type === 'Historical',
        isElapsed: end <= TODAY,
        isCurrent: date <= TODAY && TODAY < end,
      };
    }).filter(Boolean);

    initFilter();
    renderStats();
    applyScope();
    window.addEventListener('resize', debounce(drawChart, 120));
  })
  .catch(err => {
    document.getElementById('chart').innerHTML =
      `<p class="hint">Could not load <code>master_running_sheet.csv</code> (${err.message}).
       If you opened this file directly, serve it instead: <code>python3 -m http.server</code></p>`;
  });

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------------- stats ---------------- */

function renderStats() {
  const plan = ALL.filter(r => !r.isHistorical);

  // Next race. The sheet pins the marathon to Sunday; for other races we only
  // know the week, so we say "race week of" rather than inventing a day.
  const races = ALL.filter(r => r.isRace);
  const next = races.find(r => addDays(r.date, 6) >= TODAY);
  const heroDays = document.getElementById('hero-days');
  const heroRace = document.getElementById('hero-race');
  if (next) {
    const isMarathon = /MARATHON/i.test(next.lrRaw);
    const target = isMarathon ? addDays(next.date, 6) : next.date;
    const days = Math.round((target - TODAY) / 86400000);
    heroDays.textContent = days;
    heroRace.textContent = isMarathon
      ? `${next.lrRaw} · ${fmtDate(target, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`
      : `${next.lrRaw} · race week of ${fmtDate(target)}`;
    document.querySelector('.hero .label').textContent =
      days === 1 ? 'Day until race day' : 'Days until race day';
  } else {
    heroDays.textContent = '—';
    heroRace.textContent = 'No race weeks remaining';
  }

  const cur = ALL.find(r => r.isCurrent);
  document.getElementById('stat-current').textContent = cur ? `${fmtMiles(cur.miles)} mi` : '—';
  document.getElementById('stat-current-sub').textContent = cur
    ? `${cur.wk || 'Historical'}${cur.lrRaw ? ` · long run ${cur.lrRaw}` : ''}`
    : 'Outside the plan window';

  const peak = plan.reduce((a, b) => (b.miles > a.miles ? b : a), plan[0]);
  document.getElementById('stat-peak').textContent = `${fmtMiles(peak.miles)} mi`;
  document.getElementById('stat-peak-sub').textContent = `${peak.wk} · week of ${fmtDate(peak.date, { month: 'short', day: 'numeric' })}`;

  const total = plan.reduce((s, r) => s + r.miles, 0);
  document.getElementById('stat-weeks').textContent = plan.length;
  document.getElementById('stat-weeks-sub').textContent = `${Math.round(total).toLocaleString()} mi total`;
}

/* ---------------- filter ---------------- */

function initFilter() {
  document.getElementById('scope-filter').addEventListener('click', e => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    scope = btn.dataset.scope;
    document.querySelectorAll('#scope-filter .seg').forEach(b =>
      b.setAttribute('aria-pressed', String(b === btn)));
    applyScope();
  });
}

function applyScope() {
  VIEW = ALL.filter(r =>
    scope === 'all' ? true : scope === 'plan' ? !r.isHistorical : r.isHistorical);
  hoverIdx = -1;
  hideTip();
  document.getElementById('filter-count').textContent =
    `${VIEW.length} weeks · ${Math.round(VIEW.reduce((s, r) => s + r.miles, 0)).toLocaleString()} miles`;
  drawChart();
  renderTable();
}

/* ---------------- chart ---------------- */

const NS = 'http://www.w3.org/2000/svg';
const el = (n, attrs) => {
  const e = document.createElementNS(NS, n);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
};

// A race week's Long Run cell may be a distance ("16" for the 10K week) rather
// than the race name, so fall back to the distance named in the notes.
function raceLabel(r) {
  if (/marathon/i.test(r.lrRaw)) return 'Marathon';
  if (/zumbro/i.test(r.lrRaw)) return 'Zumbro 50';
  if (/[A-Za-z]/.test(r.lrRaw)) return r.lrRaw;
  const m = r.notes.match(/\b(\d+\s?(?:K|k|mi|miler)|half marathon|marathon)\b/);
  return m ? m[1].replace(/\s/g, '').toUpperCase() : 'Race';
}

// Column: square at the baseline, 4px rounded data-end.
function barPath(x, y, w, base, r) {
  r = Math.min(r, w / 2, Math.max(base - y, 0));
  if (base - y <= 0.5) return `M${x},${base}h${w}`;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

let geom = null;

function drawChart() {
  const host = document.getElementById('chart');
  host.innerHTML = '';
  if (!VIEW.length) return;

  const W = Math.max(host.clientWidth || 900, 320);
  // Top band holds two label lanes: race names, and "this week" above them,
  // so a race in the current week can't collide with the divider label.
  const M = { top: 56, right: 16, bottom: 34, left: 44 };
  const plotH = 300;
  const H = M.top + plotH + M.bottom;   // container includes the axis band
  const plotW = W - M.left - M.right;

  const yMax = Math.max(20, Math.ceil(Math.max(...VIEW.map(r => r.miles)) / 20) * 20);
  const y = v => M.top + plotH - (v / yMax) * plotH;
  const band = plotW / VIEW.length;
  const barW = Math.max(2, Math.min(24, band - 2));   // 2px surface gap between neighbours
  const cx = i => M.left + band * i + band / 2;
  const base = M.top + plotH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' });

  // gridlines: solid hairlines, recessive
  for (let v = 0; v <= yMax; v += 20) {
    svg.appendChild(el('line', {
      x1: M.left, x2: W - M.right, y1: y(v), y2: y(v),
      class: v === 0 ? 'axis' : 'grid',
    }));
    const t = el('text', { x: M.left - 10, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = v;
    svg.appendChild(t);
  }

  // x axis: a tick where the month changes
  let lastMonth = -1;
  VIEW.forEach((r, i) => {
    const m = r.date.getMonth();
    if (m === lastMonth) return;
    lastMonth = m;
    const t = el('text', { x: cx(i), y: base + 20, 'text-anchor': 'middle', class: 'tick' });
    t.textContent = m === 0 ? String(r.date.getFullYear()) : fmtDate(r.date, { month: 'short' });
    svg.appendChild(t);
  });

  // columns
  VIEW.forEach((r, i) => {
    svg.appendChild(el('path', {
      d: barPath(cx(i) - barW / 2, y(r.miles), barW, base, 4),
      class: r.isRace ? 'bar-race' : r.isElapsed ? 'bar-elapsed' : 'bar-upcoming',
    }));
  });

  // long run: 2px line, same miles axis (same unit — one scale, never a second axis).
  // It crosses the columns, so it carries a surface halo instead of a border.
  const pts = VIEW.map((r, i) => (r.lr > 0 ? [cx(i), y(r.lr)] : null));
  let d = '', pen = false;
  pts.forEach(p => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0] + ',' + p[1]; pen = true; });
  if (d) {
    svg.appendChild(el('path', { d, class: 'lr-halo' }));
    svg.appendChild(el('path', { d, class: 'lr-line' }));
  }

  // Selective direct labels only: race weeks (leader line from the top band),
  // the long-run peak, and "this week".
  VIEW.forEach((r, i) => {
    if (!r.isRace) return;
    const x = cx(i);
    svg.appendChild(el('line', { x1: x, x2: x, y1: M.top - 8, y2: y(r.miles) - 5, class: 'leader' }));
    const t = el('text', { x, y: M.top - 16, 'text-anchor': 'middle', class: 'mark-label' });
    t.textContent = raceLabel(r);
    svg.appendChild(t);
  });

  // Peak of the training long run — races are the story of the race labels, not this one.
  const lrPeak = VIEW.filter(r => !r.isRace)
    .reduce((a, b) => (b.lr > (a ? a.lr : 0) ? b : a), null);
  if (lrPeak && lrPeak.lr > 0) {
    const i = VIEW.indexOf(lrPeak);
    // sits over the columns, so it gets a surface halo to stay legible
    const t = el('text', { x: cx(i), y: y(lrPeak.lr) - 9, 'text-anchor': 'middle', class: 'mark-label halo' });
    t.textContent = `peak ${fmtMiles(lrPeak.lr)} mi`;
    if (cx(i) > W - 60) t.setAttribute('text-anchor', 'end'), t.setAttribute('x', W - M.right);
    svg.appendChild(t);
  }

  const curIdx = VIEW.findIndex(r => r.isCurrent);
  if (curIdx >= 0) {
    const x = M.left + band * curIdx;
    svg.appendChild(el('line', { x1: x, x2: x, y1: M.top - 30, y2: base, class: 'divider' }));
    const anchorEnd = x > W - 70;
    const t = el('text', {
      x: anchorEnd ? x - 5 : x + 5, y: M.top - 36,
      'text-anchor': anchorEnd ? 'end' : 'start', class: 'mark-label muted',
    });
    t.textContent = 'this week';
    svg.appendChild(t);
  }

  // crosshair + nearest-point hit layer (bands are thinner than a 24px target)
  const cross = el('line', { y1: M.top, y2: base, class: 'crosshair', opacity: 0 });
  svg.appendChild(cross);
  const hit = el('rect', { x: M.left, y: M.top, width: plotW, height: plotH, fill: 'transparent' });
  svg.appendChild(hit);

  host.appendChild(svg);
  geom = { M, W, H, band, plotW, base, cx, y, cross };

  hit.addEventListener('mousemove', e => {
    const box = svg.getBoundingClientRect();
    const px = (e.clientX - box.left) * (W / box.width);
    setHover(Math.max(0, Math.min(VIEW.length - 1, Math.floor((px - M.left) / band))));
  });
  hit.addEventListener('mouseleave', () => { hoverIdx = -1; hideTip(); });

  host.onkeydown = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const start = hoverIdx < 0 ? (curIdx >= 0 ? curIdx : 0) : hoverIdx + (e.key === 'ArrowRight' ? 1 : -1);
    setHover(Math.max(0, Math.min(VIEW.length - 1, start)));
  };
  host.onblur = () => { hoverIdx = -1; hideTip(); };
}

function setHover(i) {
  if (i === hoverIdx || !geom) return;
  hoverIdx = i;
  const r = VIEW[i];
  geom.cross.setAttribute('opacity', 1);
  geom.cross.setAttribute('x1', geom.cx(i));
  geom.cross.setAttribute('x2', geom.cx(i));
  showTip(r, i);
}

function hideTip() {
  document.getElementById('tooltip').hidden = true;
  if (geom) geom.cross.setAttribute('opacity', 0);
}

function showTip(r, i) {
  const tip = document.getElementById('tooltip');
  const swatch = c => `<span class="key key-bar" style="background:${c}"></span>`;
  const barColor = r.isRace ? 'var(--race)' : r.isElapsed ? 'var(--elapsed)' : 'var(--upcoming)';
  tip.innerHTML = `
    <div class="tt-date">${fmtDate(r.date)}${r.wk ? ` · ${r.wk}` : ''}</div>
    <div class="tt-row">${swatch(barColor)} Miles <b>${fmtMiles(r.miles)}</b></div>
    ${r.lrRaw ? `<div class="tt-row"><span class="key key-line" style="background:var(--longrun)"></span> Long run <b>${r.lrRaw}</b></div>` : ''}
    ${r.type ? `<div class="tt-row" style="color:var(--muted)">${r.type}</div>` : ''}
    ${r.notes ? `<div class="tt-note">${escapeHTML(r.notes)}</div>` : ''}`;
  tip.hidden = false;

  const host = document.getElementById('chart');
  const scale = host.clientWidth / geom.W;
  const x = geom.cx(i) * scale;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(w / 2 + 2, Math.min(host.clientWidth - w / 2 - 2, x))}px`;
  tip.style.top = `${Math.max(10, geom.y(Math.max(r.miles, r.lr)) * scale - 12)}px`;
}

const escapeHTML = s => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- table ---------------- */

function renderTable() {
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  for (const r of VIEW) {
    const tr = document.createElement('tr');
    tr.className = r.isRace ? 'is-race' : r.isCurrent ? 'is-current' : r.isElapsed ? 'is-elapsed' : '';
    tr.innerHTML = `
      <td class="date">${fmtDate(r.date)}</td>
      <td class="wk">${r.wk.replace(/^Week\s*/, '') || '—'}</td>
      <td class="num">${fmtMiles(r.miles)}</td>
      <td class="lr">${r.lrRaw || '—'}</td>
      <td>${r.type ? `<span class="badge${r.isRace ? ' is-race' : ''}"><span class="dot"></span>${r.type}</span>` : ''}</td>
      <td class="phase">${escapeHTML(r.phase) || '—'}</td>
      <td class="notes">${escapeHTML(r.notes)}</td>`;
    tbody.appendChild(tr);
  }
}

/* ---------------- pwa ---------------- */

function initOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  const sync = () => { banner.hidden = navigator.onLine; };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  sync();
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no SW and no fetch(); skip rather than throw.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  navigator.serviceWorker.register('sw.js').catch(() => {});

  // A new worker taking over means the shell changed underneath us. Reload once —
  // but not on the very first install, where there was no controller to replace.
  let reloading = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

/* ---------------- theme ---------------- */

function initTheme() {
  const btn = document.getElementById('theme-toggle');
  const label = btn.querySelector('[data-theme-label]');
  const system = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.dataset.theme = saved;

  const sync = () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : system();
    label.textContent = dark ? 'Light' : 'Dark';
    btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  sync();

  btn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : system();
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    sync();
    drawChart();
  });
}
