'use strict';

const $ = id => document.getElementById(id);
const mlist  = $('mlist');
const addBtn = $('addBtn');
const catSel = $('cat');
const cntInp = $('cnt');
const minpInp = $('minp');
const maxpInp = $('maxp');
const isl    = $('isl');
const ival   = $('ival');
const dot    = $('dot');
const stext  = $('stext');
const logBox = $('log');
const bstart = $('bstart');
const bstop  = $('bstop');

let matchCount = 1;

// ── Match inputs ──────────────────────────────────────────────────────────────
function addMatchRow(val = '') {
  if (matchCount >= 3) return;
  matchCount++;
  const item = document.createElement('div');
  item.className = 'mi';
  item.innerHTML = `<div class="mnum">${matchCount}</div><input class="minp perf" type="text" placeholder="e.g. 10229226700887" value="${val}"><button class="mrm">×</button>`;
  item.querySelector('.mrm').addEventListener('click', () => {
    if (mlist.children.length > 1) { item.remove(); matchCount--; rebuildNums(); addBtn.style.display = matchCount < 3 ? '' : 'none'; }
  });
  mlist.appendChild(item);
  if (matchCount >= 3) addBtn.style.display = 'none';
}

mlist.querySelector('.mrm').addEventListener('click', () => {
  if (mlist.children.length > 1) { mlist.querySelector('.mi').remove(); matchCount--; rebuildNums(); }
});
addBtn.addEventListener('click', () => addMatchRow());

function rebuildNums() {
  mlist.querySelectorAll('.mnum').forEach((el, i) => { el.textContent = i + 1; });
}

function getPerfIds() {
  return [...mlist.querySelectorAll('.perf')].map(i => i.value.trim()).filter(v => /^\d{10,16}$/.test(v));
}

// ── Slider ────────────────────────────────────────────────────────────────────
isl.addEventListener('input', () => { ival.textContent = isl.value + 's'; });

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(msg, type = 'info') {
  const now = new Date().toTimeString().slice(0,8);
  const line = document.createElement('div');
  line.className = type;
  line.textContent = `[${now}] ${msg}`;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
  if (logBox.children.length > 150) logBox.removeChild(logBox.firstChild);
}

// ── Status ────────────────────────────────────────────────────────────────────
function setRunning(on) {
  dot.className = 'dot' + (on ? ' on' : '');
  stext.textContent = on ? `Running — watching ${getPerfIds().length || '?'} match(es)` : 'Idle — configure and start';
  bstart.textContent = on ? '⏸ Running…' : '▶ Start Bot';
  bstart.classList.toggle('on', on);
  bstop.classList.toggle('vis', on);
}

// ── Load saved state ──────────────────────────────────────────────────────────
chrome.storage.local.get(['botSettings', 'botRunning'], ({ botSettings, botRunning }) => {
  if (botSettings) {
    const ids = botSettings.perfIds || [];
    if (ids[0]) mlist.querySelector('.perf').value = ids[0];
    ids.slice(1).forEach(id => addMatchRow(id));
    if (botSettings.category) catSel.value = botSettings.category;
    if (botSettings.count)    cntInp.value  = botSettings.count;
    if (botSettings.interval) { isl.value = botSettings.interval; ival.textContent = botSettings.interval + 's'; }
    if (botSettings.minPrice !== undefined) minpInp.value = botSettings.minPrice;
    if (botSettings.maxPrice !== undefined) maxpInp.value = botSettings.maxPrice;
  }
  if (botRunning) setRunning(true);
});

// ── Listen for messages from content script ───────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'LOG')          addLog(msg.msg, msg.logType || 'info');
  if (msg.type === 'STATE_UPDATE') setRunning(!!msg.state?.running);
});

// ── Start ─────────────────────────────────────────────────────────────────────
bstart.addEventListener('click', async () => {
  const perfIds = getPerfIds();
  if (!perfIds.length) { addLog('Enter at least one valid Performance ID', 'err'); return; }
  const count = parseInt(cntInp.value, 10) || 4;
  const minPrice = Math.max(0, parseFloat(minpInp.value) || 0);
  const maxPrice = Math.max(0, parseFloat(maxpInp.value) || 0);
  if (maxPrice && minPrice > maxPrice) { addLog('Min price cannot be greater than max price', 'err'); return; }
  const config = { perfIds, category: catSel.value, count, minPrice, maxPrice, interval: parseInt(isl.value, 10), running: true };

  chrome.storage.local.set({ botSettings: config, botRunning: true });

  // Send to content script on the active FIFA tab
  const tabs = await chrome.tabs.query({ url: '*://fwc26-resale-usd.tickets.fifa.com/*' });
  if (!tabs.length) {
    addLog('No FIFA tab found! Open fwc26-resale-usd.tickets.fifa.com first', 'err');
    return;
  }
  chrome.tabs.sendMessage(tabs[0].id, { type: 'START', settings: config }, resp => {
    if (chrome.runtime.lastError) { addLog('Could not reach FIFA tab: ' + chrome.runtime.lastError.message, 'err'); return; }
    setRunning(true);
    addLog(`Bot started on tab ${tabs[0].id}. Watching ${perfIds.length} match(es).`, 'ok');
  });
});

// ── Stop ──────────────────────────────────────────────────────────────────────
bstop.addEventListener('click', async () => {
  chrome.storage.local.set({ botRunning: false });
  const tabs = await chrome.tabs.query({ url: '*://fwc26-resale-usd.tickets.fifa.com/*' });
  tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'STOP' }).catch(() => {}));
  setRunning(false);
  addLog('Stopped', 'warn');
});
