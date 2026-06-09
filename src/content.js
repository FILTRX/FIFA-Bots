'use strict';
// FIFA WC 2026 Ticket Bot — Content Script v20 FINAL
// Strategy: intercept STX's own /seats/free/ol responses via postMessage
// Trigger data loading via selectBlockByAvailabilities Custom Event
// Select seats via selectSeatsByIds → click Add to cart

if (window.__fifaBotLoaded) { /* skip */ } else {
window.__fifaBotLoaded = true;

const HOST = 'fwc26-resale-usd.tickets.fifa.com';
const DB_NAME = 'FifaBotDB', DB_VER = 1, STORE = 'settings';

let settings = {
  perfIds: [], category: 'CAT3', count: 2, interval: 30, running: false,
  minPrice: 0, maxPrice: 700, // USD per ticket
};

const CAT_NAMES = {
  CAT1: 'Category 1', CAT2: 'Category 2', CAT3: 'Category 3', CAT4: 'Category 4',
  FRONT_CAT1: 'Front Category 1', FRONT_CAT2: 'Front Category 2',
  EA_STD_CAT1: 'Easy Access Standard - Category 1',
  EA_STD_CAT2: 'Easy Access Standard - Category 2',
  EA_STD_CAT3: 'Easy Access Standard - Category 3',
  WC_EA_CAT1: 'Wheelchair & Easy Access Amenity - Category 1',
  WC_EA_CAT2: 'Wheelchair & Easy Access Amenity - Category 2',
  WC_EA_CAT3: 'Wheelchair & Easy Access Amenity - Category 3',
  SUPP_PREM: 'Supporter Premier Tier',
  SUPP_STD: 'Supporter Standard Tier',
  SUPP_VAL: 'Supporter Value Tier',
};

// ── IndexedDB ─────────────────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (!_db) _db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
  return _db;
}
async function saveSettings() {
  (await getDB()).transaction(STORE, 'readwrite').objectStore(STORE).put({ id: 1, settings: { ...settings } });
}
async function loadSettings() {
  return new Promise(async res => {
    const req = (await getDB()).transaction(STORE, 'readonly').objectStore(STORE).get(1);
    req.onsuccess = e => { if (e.target.result?.settings) settings = { ...settings, ...e.target.result.settings }; res(settings); };
    req.onerror = () => res(settings);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));


function pickFirst(...vals) {
  return vals.find(v => v !== undefined && v !== null && v !== '');
}

function textOf(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object') return String(
    pickFirst(v.name?.en, v.name, v.label?.en, v.label, v.description?.en, v.description, v.code, v.key, v.id, '')
  );
  return String(v);
}

function getCategoryText(f) {
  const p = f?.properties || {};
  return textOf(p.seatCategory || p.category || p.seat_category || p.seatCategoryName || p.tariff || p.priceLevel);
}

function parseMoneyToCents(v) {
  if (v === undefined || v === null || v === '') return NaN;
  if (typeof v === 'number') {
    // FIFA resale sends amount in 1/1000 USD: 830070 = $830.07, 750000 = $750.00.
    // Convert it to cents for comparing with Min/Max fields.
    return v > 10000 ? Math.round(v / 10) : Math.round(v * 100);
  }
  const raw = String(v).replace(/[^0-9.,-]/g, '');
  if (!raw) return NaN;
  const normalized = raw.includes(',') && raw.includes('.')
    ? raw.replace(/,/g, '')
    : raw.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return NaN;
  return n > 10000 ? Math.round(n / 10) : Math.round(n * 100);
}

function getPriceCents(f) {
  const p = f?.properties || {};
  const vals = [
    p.amount,
    p.price,
    p.priceAmount,
    p.faceValue,
    p.totalAmount,
    p.minPrice,
    p.offer?.amount,
    p.offer?.price,
    p.ticket?.amount,
    p.ticket?.price,
    p.product?.amount,
    p.product?.price,
    p.tariff?.amount,
    p.tariff?.price,
  ];
  for (const v of vals) {
    const cents = parseMoneyToCents(v);
    if (Number.isFinite(cents) && cents > 0) return cents;
  }
  return NaN;
}

function blockName(f) {
  const p = f?.properties || {};
  return textOf(p.block?.name?.en || p.block?.name || p.block || p.blockId || p.sector || p.section);
}

function getBlockId(f) {
  const p = f?.properties || {};
  return textOf(p.block?.id || p.blockId || p.block?.code || p.block?.name?.en || p.block?.name || p.block || p.sector || p.section);
}

function seatDebugList(features, limit = 30) {
  return features.slice(0, limit).map(f => {
    const p = f.properties || {};
    const cents = getPriceCents(f);
    return {
      id: f.id,
      category: getCategoryText(f),
      priceUsd: Number.isFinite(cents) ? +(cents / 100).toFixed(2) : null,
      rawAmount: p.amount,
      rawPrice: p.price,
      blockId: getBlockId(f),
      block: blockName(f),
      row: pickFirst(p.row, p.rowName, p.place?.row),
      seat: pickFirst(p.number, p.seatNumber, p.place?.seat),
      propKeys: Object.keys(p).slice(0, 25).join(',')
    };
  });
}

function log(msg, type = 'info') {
  if (type === 'error') console.error('[FIFA Bot]', msg);
  else if (type === 'warn') console.warn('[FIFA Bot]', msg);
  else console.log('[FIFA Bot]', msg);
  chrome.runtime.sendMessage({ type: 'LOG', msg, logType: type }).catch(() => {});
  pageLogs.push({ t: new Date().toTimeString().slice(0,8), msg, type });
  if (pageLogs.length > 80) pageLogs.shift();
  const b = document.querySelector('#fb-badge');
  if (b) b.textContent = msg.slice(0, 72);
  updatePageLog();
}

// ── Intercept seat data from STX via postMessage ──────────────────────────────
let _allSeats = [];      // accumulated from all blocks
let _interceptedSeats = null;

window.addEventListener('message', e => {
  if (!e.data || !e.data.__fb) return;
  const d = e.data;
  if (d.type === 'seats' && d.features?.length) {
    const existingIds = new Set(_allSeats.map(f => f.id));
    const newSeats = d.features.filter(f => !existingIds.has(f.id));
    _allSeats = [..._allSeats, ...newSeats];
    _interceptedSeats = _allSeats;

    // DEBUG: print directly to DevTools console (works even in extension isolated world)
    const dbg = seatDebugList(_allSeats, 30);
    console.log('[FIFA Bot DEBUG JSON]', JSON.stringify(dbg, null, 2));
    console.table(dbg);
    const cats = {};
    for (const f of _allSeats) {
      const c = getCategoryText(f) || '(empty category)';
      cats[c] = (cats[c] || 0) + 1;
    }
    console.log('[FIFA Bot DEBUG categories]', cats);

    log(`Intercepted +${newSeats.length} seats (total: ${_allSeats.length})`);
  }
  if (d.type === 'csrf') log(`CSRF: ${d.value.slice(0,8)}…`);
});

// ── Find N consecutive cheapest seats ─────────────────────────────────────────
function findAdjacentGroup(features, catKey, count, minPrice = 0, maxPrice = Infinity) {
  const targetName = (CAT_NAMES[catKey] || '').toLowerCase();

  // Filter by category name + price range. amount is in CENTS, so $700 = 70000.
  const minCents = Math.round((Number(minPrice) || 0) * 100);
  const maxCents = Number.isFinite(Number(maxPrice)) && Number(maxPrice) > 0
    ? Math.round(Number(maxPrice) * 100)
    : Infinity;

  let pool = features.filter(f => {
    const cat = getCategoryText(f).toLowerCase();
    const amount = getPriceCents(f);
    const catOk = cat === targetName || cat.includes(targetName) || targetName.includes(cat);
    return catOk && Number.isFinite(amount) && amount >= minCents && amount <= maxCents;
  });

  log(`Pool: ${features.length} total → ${pool.length} in "${CAT_NAMES[catKey] || catKey}" price $${minPrice}–$${maxPrice || '∞'}`);
  if (!pool.length) {
    const sample = seatDebugList(features, 20);
    console.log('[FIFA Bot DEBUG no-pool sample]', JSON.stringify(sample, null, 2));
    console.table(sample);
  }
  if (!pool.length) return null;

  // getPriceCents() converts FIFA raw amount to USD cents (830070 = $830.07).
  // Sort cheapest first
  pool.sort((a, b) => (getPriceCents(a) || 0) - (getPriceCents(b) || 0));

  // Log cheapest 5
  const top5 = pool.slice(0, 5).map(f => {
    const p = f.properties;
    const price = getPriceCents(f) / 100;
    return `$${price.toFixed(2)} B${blockName(f)||'?'} R${p.row} S${p.number}`;
  });
  log(`Cheapest: ${top5.join(' | ')}`);

  // Group by block.id + row
  const rowMap = {};
  pool.forEach(f => {
    const p = f.properties;
    const key = `${p.block?.id}||${p.row}`;
    if (!rowMap[key]) rowMap[key] = [];
    rowMap[key].push(f);
  });

  // Find cheapest group of N consecutive
  const candidates = [];
  for (const seats of Object.values(rowMap)) {
    if (seats.length < count) continue;
    seats.sort((a, b) => parseInt(a.properties?.number || 0) - parseInt(b.properties?.number || 0));
    for (let i = 0; i <= seats.length - count; i++) {
      const win = seats.slice(i, i + count);
      const nums = win.map(f => parseInt(f.properties?.number || 0));
      let ok = true;
      for (let j = 1; j < nums.length; j++) if (nums[j] !== nums[j-1] + 1) { ok = false; break; }
      if (ok) candidates.push({
        features: win,
        total: win.reduce((s, f) => s + (getPriceCents(f) || 0), 0),
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.total - b.total);
  const best = candidates[0];
  const p0 = best.features[0].properties;
  return {
    features: best.features,
    ids: best.features.map(f => f.id),
    block: p0.block?.name?.en || '?',
    area: p0.area?.name?.en || '',
    row: p0.row,
    seatNumbers: best.features.map(f => parseInt(f.properties?.number || 0)),
    priceEach: (getPriceCents(best.features[0]) || 0) / 100,
    totalPrice: best.total / 100,
  };
}

// ── Select seats + Add to cart ────────────────────────────────────────────────
async function selectAndAddToCart(group) {
  const seatMapEl = document.getElementById('seatMap');
  if (!seatMapEl) { log('No #seatMap', 'error'); return false; }

  // STX expects: { seatIds: [numericId1, numericId2, ...] }
  // and uses l.includes(feature.getId()) where getId() returns number
  log(`Dispatching selectSeatsByIds: [${group.ids.join(', ')}]`);

  seatMapEl.dispatchEvent(new CustomEvent('selectSeatsByIds', {
    detail: { seatIds: group.ids },  // numeric IDs, key is 'seatIds'!
    bubbles: true, cancelable: true,
  }));

  // Wait for Add to cart button to become enabled
  log('Waiting for Add to cart…');
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const btn = findAddToCartBtn();
    if (btn) {
      log('✓ Clicking Add to cart!', 'ok');
      btn.click();
      return true;
    }
  }

  log('Add to cart button not found after selectSeatsByIds', 'warn');
  return false;
}

function findAddToCartBtn() {
  for (const el of document.querySelectorAll('button, a[role="button"]')) {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (txt !== 'add to cart') continue;
    const disabled = el.disabled || el.hasAttribute('disabled') ||
      el.classList.contains('p-disabled') ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('aria-disabled') === '';
    if (!disabled) return el;
  }
  return null;
}

// ── Wait for STX to be ready ──────────────────────────────────────────────────
async function waitForSTX() {
  // Wait for canvas
  for (let i = 0; i < 60; i++) {
    if (document.querySelector('#seatMap canvas')) break;
    await sleep(250);
  }
  // Wait for STX to attach event listeners (rendercomplete + addEventListeners)
  // STX fires rendercomplete after initial render — wait for it
  await new Promise(res => {
    const check = () => {
      const el = document.getElementById('seatMap');
      if (!el) { setTimeout(check, 200); return; }
      // Check if STX has attached its listeners by testing a harmless event
      el.dispatchEvent(new CustomEvent('__fbtest'));
      res();
    };
    setTimeout(check, 1500);
  });
  await sleep(1000); // extra buffer
}

// ── Collect seats from all Cat3 blocks ────────────────────────────────────────
async function collectAllSeats(catName, count) {
  const seatMapEl = document.getElementById('seatMap');
  if (!seatMapEl) return;

  const prevTotal = _allSeats.length;
  log(`Collecting seats from all "${catName}" blocks…`);

  // IMPORTANT: one selectBlockByAvailabilities call already makes STX load the available seats
  // for the selected category across many blocks. Re-dispatching it often jumps back to the same
  // visible block (for example 434), so we trigger it only ONCE per check.
  const beforeIds = new Set(_allSeats.map(f => f.id));

  seatMapEl.dispatchEvent(new CustomEvent('selectBlockByAvailabilities', {
    detail: { category: catName, numberOfSeats: count },
    bubbles: true, cancelable: true,
  }));

  // Wait while interceptor receives seats from API responses.
  await sleep(3500);

  const newSeats = _allSeats.filter(f => !beforeIds.has(f.id));
  const allBlockIds = [...new Set(_allSeats.map(getBlockId).filter(Boolean))];
  const newBlockIds = [...new Set(newSeats.map(getBlockId).filter(Boolean))];

  log(`Block scan: +${newSeats.length} seats | new blocks: ${newBlockIds.join(', ') || 'unknown'} | total unique blocks: ${allBlockIds.length}`);
  log(`Total collected: ${_allSeats.length} (was ${prevTotal}) | unique blocks: ${allBlockIds.length}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let isRunning = false, pollTimer = null, checkCount = 0;
let stats = { checks: 0, found: 0, added: 0 };
let pageLogs = [];

function getCurrentPerformanceId() {
  return window.location.href.match(/performance\/(\d+)/)?.[1] || null;
}

function isOnSeatMapPage() {
  return window.location.href.includes('/seat/performance/') ||
         window.location.href.includes('/selection/event/seat/');
}

function currentMatchLabel() {
  const id = getCurrentPerformanceId();
  return id ? `Match ${id}` : 'Open a match page';
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { running: isRunning, ...stats } }).catch(() => {});
  updatePageStatus();
}

async function runCheck() {
  if (!isRunning) return;

  if (window.location.href.includes('cart/shoppingCart')) {
    log('🎉 Cart page! Tickets added!', 'ok');
    stopBot();
    try {
      chrome.notifications.create('', {
        type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title: '🎟 FIFA Tickets in cart!',
        message: 'Review cart and click Buy Now!', priority: 2,
      });
    } catch(e) {}
    return;
  }

  const onSeatmap = isOnSeatMapPage();
  const perfId = getCurrentPerformanceId();

  if (!onSeatmap || !perfId) {
    log('Open the exact match seat map page first, then press Start', 'error');
    stopBot();
    return;
  }

  stats.checks++;
  checkCount++;
  log(`Check #${checkCount} — current match ${perfId}`);
  broadcastState();

  // Wait for STX widget
  log('Waiting for STX…');
  await waitForSTX();

  // Collect seats from all blocks
  const catName = CAT_NAMES[settings.category] || settings.category;
  await collectAllSeats(catName, settings.count);

  if (!_allSeats.length) {
    log('No seats collected — retrying', 'warn');
    scheduleReload();
    return;
  }

  log(`Using ${_allSeats.length} total seats`);

  // Find cheapest adjacent group
  const group = findAdjacentGroup(_allSeats, settings.category, settings.count, settings.minPrice, settings.maxPrice);
  if (!group) {
    log(`No ${settings.count} adjacent "${catName}" in $${settings.minPrice}–$${settings.maxPrice} — retrying`, 'warn');
    scheduleReload();
    return;
  }

  stats.found++;
  log(`✓ FOUND! Block ${group.block} | ${group.area} | Row ${group.row} | Seats ${group.seatNumbers.join(',')} | $${group.priceEach.toFixed(2)}/each | Total $${group.totalPrice.toFixed(2)}`, 'ok');
  broadcastState();

  const added = await selectAndAddToCart(group);
  if (added) {
    stats.added++;
    broadcastState();
    await sleep(5000);
    if (isRunning && !window.location.href.includes('cart/shoppingCart')) {
      log('No cart redirect — reloading', 'warn');
      scheduleReload();
    }
  } else {
    scheduleReload();
  }
}

function scheduleReload() {
  stopPolling();
  pollTimer = setTimeout(() => {
    if (isRunning) {
      _allSeats = [];
      _interceptedSeats = null;
      window.location.reload();
    }
  }, settings.interval * 1000);
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function startBot() {
  if (isRunning) return;
  isRunning = true; checkCount = 0;
  stats = { checks: 0, found: 0, added: 0 };
  _allSeats = []; _interceptedSeats = null;
  settings.running = true; saveSettings();
  const perfId = getCurrentPerformanceId();
  log(`Bot started on current match ${perfId || '?'} | ${CAT_NAMES[settings.category]||settings.category} | ${settings.count} seats | $${settings.minPrice}–$${settings.maxPrice} | ${settings.interval}s`, 'ok');
  broadcastState(); createFloatingUI();
  runCheck();
}

function stopBot() {
  isRunning = false; stopPolling();
  settings.running = false; saveSettings();
  broadcastState(); log('Bot stopped', 'warn'); createFloatingUI();
}

function updateSettingsFromPanel() {
  const root = document.querySelector('#fb-root');
  if (!root) return;
  const cat = root.querySelector('#fb-cat')?.value || settings.category;
  const count = parseInt(root.querySelector('#fb-count')?.value, 10) || settings.count || 2;
  const minPrice = Math.max(0, parseFloat(root.querySelector('#fb-min')?.value) || 0);
  const maxPrice = Math.max(0, parseFloat(root.querySelector('#fb-max')?.value) || 0);
  const interval = Math.max(5, parseInt(root.querySelector('#fb-interval')?.value, 10) || settings.interval || 30);
  settings = { ...settings, category: cat, count, minPrice, maxPrice, interval, perfIds: [] };
  saveSettings();
  updatePageStatus();
}

function updatePageLog() {
  const box = document.querySelector('#fb-log');
  if (!box) return;
  box.innerHTML = pageLogs.slice(-12).map(l => {
    const color = l.type === 'error' ? '#fecaca' : l.type === 'warn' ? '#fde68a' : l.type === 'ok' ? '#bbf7d0' : '#dbeafe';
    return `<div style="color:${color};margin:2px 0;line-height:1.25"><span style="opacity:.55">${l.t}</span> ${escapeHtml(l.msg)}</div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function updatePageStatus() {
  const root = document.querySelector('#fb-root');
  if (!root) return;
  const perfId = getCurrentPerformanceId();
  const state = root.querySelector('#fb-state');
  const badge = root.querySelector('#fb-badge');
  const startBtn = root.querySelector('#fb-start');
  const dot = root.querySelector('#fb-dot');
  const match = root.querySelector('#fb-match');
  if (match) match.textContent = perfId ? perfId : 'not on match page';
  if (state) state.textContent = isRunning ? `Running · checks ${stats.checks} · found ${stats.found}` : 'Ready';
  if (badge) badge.textContent = isRunning
    ? `Running · ${CAT_NAMES[settings.category]||settings.category} · ${settings.count} seats`
    : `FIFA Bot · ${CAT_NAMES[settings.category]||settings.category} · ${settings.count} seats`;
  if (startBtn) startBtn.textContent = isRunning ? 'Stop bot' : 'Start bot';
  if (dot) dot.style.background = isRunning ? '#22c55e' : (perfId ? '#f59e0b' : '#ef4444');
}

function createFloatingUI() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', createFloatingUI, { once: true });
    return;
  }
  document.querySelector('#fb-root')?.remove();

  const css = document.createElement('style');
  css.id = 'fb-style';
  css.textContent = `
    #fb-root, #fb-root * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, Segoe UI, Arial, sans-serif; }
    #fb-root { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; color: #fff; }
    #fb-card { width: 360px; border: 1px solid rgba(255,255,255,.14); border-radius: 22px; overflow: hidden; background: linear-gradient(145deg, rgba(9,18,38,.96), rgba(16,37,73,.96)); box-shadow: 0 22px 70px rgba(0,0,0,.45); backdrop-filter: blur(12px); }
    #fb-head { padding: 14px 16px; display:flex; align-items:center; justify-content:space-between; background: rgba(255,255,255,.06); border-bottom:1px solid rgba(255,255,255,.09); }
    #fb-title { display:flex; gap:10px; align-items:center; font-weight:900; letter-spacing:.2px; }
    #fb-dot { width:10px; height:10px; border-radius:99px; background:#f59e0b; box-shadow:0 0 18px currentColor; }
    #fb-mini { border:0; color:#cbd5e1; background:rgba(255,255,255,.08); border-radius:10px; padding:4px 9px; cursor:pointer; }
    #fb-body { padding: 14px 16px 16px; }
    #fb-state { color:#cbd5e1; font-size:12px; margin-top:3px; }
    #fb-match-row { margin: 12px 0; padding: 10px 12px; border-radius:14px; background:rgba(15,23,42,.65); border:1px solid rgba(148,163,184,.18); font-size:12px; color:#cbd5e1; }
    #fb-match { display:block; color:#fff; font-size:13px; font-weight:800; margin-top:3px; }
    .fb-grid { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
    .fb-field { display:flex; flex-direction:column; gap:5px; }
    .fb-field label { font-size:11px; color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:.45px; }
    .fb-field input, .fb-field select { width:100%; border:1px solid rgba(148,163,184,.22); border-radius:12px; padding:9px 10px; outline:none; background:rgba(15,23,42,.82); color:#fff; font-size:13px; }
    .fb-field input:focus, .fb-field select:focus { border-color:#60a5fa; box-shadow:0 0 0 3px rgba(96,165,250,.17); }
    #fb-actions { display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:12px; }
    #fb-start, #fb-save { border:0; border-radius:14px; padding:11px 12px; color:#fff; font-weight:900; cursor:pointer; }
    #fb-start { background: linear-gradient(135deg,#2563eb,#7c3aed); }
    #fb-save { background: rgba(255,255,255,.10); color:#dbeafe; }
    #fb-log { margin-top:12px; max-height:140px; overflow:auto; padding:10px; border-radius:14px; background:rgba(2,6,23,.58); border:1px solid rgba(148,163,184,.14); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:11px; }
    #fb-badge { margin-top:9px; color:#bfdbfe; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #fb-card.fb-collapsed { width:auto; }
    #fb-card.fb-collapsed #fb-body { display:none; }
    #fb-card.fb-collapsed #fb-head { border-bottom:0; }
  `;
  document.getElementById('fb-style')?.remove();
  document.documentElement.appendChild(css);

  const root = document.createElement('div');
  root.id = 'fb-root';
  root.innerHTML = `
    <div id="fb-card">
      <div id="fb-head">
        <div>
          <div id="fb-title"><span id="fb-dot"></span><span>FIFA Ticket Bot</span></div>
          <div id="fb-state">Ready</div>
        </div>
        <button id="fb-mini" title="Minimize">−</button>
      </div>
      <div id="fb-body">
        <div id="fb-match-row">Current match ID <span id="fb-match">checking…</span></div>
        <div class="fb-grid">
          <div class="fb-field" style="grid-column:1 / -1">
            <label>Category</label>
            <select id="fb-cat">
              ${Object.entries(CAT_NAMES).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
            </select>
          </div>
          <div class="fb-field"><label>Seats together</label><input id="fb-count" type="number" min="1" max="8" step="1"></div>
          <div class="fb-field"><label>Interval, sec</label><input id="fb-interval" type="number" min="5" max="300" step="1"></div>
          <div class="fb-field"><label>Min $</label><input id="fb-min" type="number" min="0" step="1"></div>
          <div class="fb-field"><label>Max $</label><input id="fb-max" type="number" min="0" step="1"></div>
        </div>
        <div id="fb-actions"><button id="fb-start">Start bot</button><button id="fb-save">Save</button></div>
        <div id="fb-log"></div>
        <div id="fb-badge">FIFA Bot</div>
      </div>
    </div>`;
  document.body.appendChild(root);

  root.querySelector('#fb-cat').value = settings.category;
  root.querySelector('#fb-count').value = settings.count;
  root.querySelector('#fb-interval').value = settings.interval;
  root.querySelector('#fb-min').value = settings.minPrice;
  root.querySelector('#fb-max').value = settings.maxPrice;

  root.querySelector('#fb-start').onclick = () => {
    updateSettingsFromPanel();
    if (isRunning) stopBot(); else startBot();
  };
  root.querySelector('#fb-save').onclick = () => {
    updateSettingsFromPanel();
    log('Settings saved', 'ok');
  };
  root.querySelector('#fb-mini').onclick = () => {
    const card = root.querySelector('#fb-card');
    card.classList.toggle('fb-collapsed');
    root.querySelector('#fb-mini').textContent = card.classList.contains('fb-collapsed') ? '+' : '−';
  };
  root.querySelectorAll('input,select').forEach(el => el.addEventListener('change', updateSettingsFromPanel));
  updatePageStatus();
  updatePageLog();
}

chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  if (msg.type === 'START') { if (msg.settings) settings = { ...settings, ...msg.settings }; startBot(); sendResponse({ ok: true }); return true; }
  if (msg.type === 'STOP') { stopBot(); sendResponse({ ok: true }); return true; }
  if (msg.type === 'GET_STATE') { sendResponse({ running: isRunning, settings, ...stats }); return true; }
  if (msg.type === 'UPDATE_SETTINGS') { settings = { ...settings, ...msg.settings }; saveSettings(); createFloatingUI(); sendResponse({ ok: true }); return true; }
});

(async () => {
  await loadSettings();
  createFloatingUI();
  if (settings.running) {
    log('Resuming…'); await sleep(500);
    isRunning = true; checkCount = 0;
    _allSeats = []; _interceptedSeats = null;
    stats = { checks: 0, found: 0, added: 0 };
    broadcastState(); createFloatingUI();
    runCheck();
  }
})();

} // end guard
