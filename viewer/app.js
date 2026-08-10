'use strict';

const lanesEl = document.getElementById('lanes');
const statusEl = document.getElementById('status');
const emptyHintEl = document.getElementById('empty-hint');
const lanes = new Map(); // sessionId -> lane record

const KIND_META = {
  prompt: { icon: '➤', cls: 'k-prompt' },
  text: { icon: '', cls: 'k-text' },
  thinking: { icon: '·', cls: 'k-thinking' },
  tool: { icon: '→', cls: 'k-tool' },
  result: { icon: '✓', cls: 'k-result' },
  error: { icon: '✕', cls: 'k-error' },
  image: { icon: '🖼', cls: 'k-image' },
  system: { icon: '•', cls: 'k-system' },
};

function updateEmptyHint() {
  emptyHintEl.style.display = lanes.size === 0 ? 'block' : 'none';
}

function laneFor(sessionId) {
  const key = sessionId || 'unknown';
  if (lanes.has(key)) return lanes.get(key);

  const el = document.createElement('section');
  el.className = 'lane';
  el.innerHTML =
    '<div class="lane-header"><span class="lane-title">session ' +
    key.slice(0, 8) +
    '</span><span class="lane-time"></span></div><div class="lane-feed"></div>';
  lanesEl.prepend(el);

  const header = el.querySelector('.lane-header');
  header.title = 'Click to collapse this session';
  header.addEventListener('click', () => el.classList.toggle('collapsed'));

  const lane = {
    el,
    feedEl: el.querySelector('.lane-feed'),
    titleEl: el.querySelector('.lane-title'),
    lastTs: Date.now(),
    titled: false,
  };
  lanes.set(key, lane);
  updateEmptyHint();
  return lane;
}

function addRow(lane, evt) {
  // First real prompt in a lane becomes its title, much more useful than a session id.
  if (!lane.titled && evt.kind === 'prompt' && evt.detail) {
    lane.titleEl.textContent = evt.detail.slice(0, 70);
    lane.titled = true;
  }

  const meta = KIND_META[evt.kind] || KIND_META.system;
  const row = document.createElement('div');
  row.className = 'row ' + meta.cls;

  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = (meta.icon ? meta.icon + ' ' : '') + (evt.label || evt.kind);

  const detail = document.createElement('span');
  detail.className = 'row-detail';
  detail.textContent = evt.detail || '';

  row.append(label, detail);
  lane.feedEl.appendChild(row);
  while (lane.feedEl.children.length > 200) lane.feedEl.removeChild(lane.feedEl.firstChild);
  lane.feedEl.scrollTop = lane.feedEl.scrollHeight;
  lane.lastTs = Date.now();
  lane.el.classList.remove('idle');
}

const source = new EventSource('/events');
source.onopen = () => {
  statusEl.textContent = 'live';
};
source.onerror = () => {
  statusEl.textContent = 'reconnecting…';
};
source.onmessage = (e) => {
  let evt;
  try {
    evt = JSON.parse(e.data);
  } catch (err) {
    return;
  }
  if (evt.kind === 'system') {
    statusEl.textContent = evt.detail;
    return;
  }
  addRow(laneFor(evt.sessionId), evt);
};

setInterval(() => {
  const now = Date.now();
  for (const lane of lanes.values()) {
    if (now - lane.lastTs > 60000) lane.el.classList.add('idle');
  }
}, 5000);

updateEmptyHint();
