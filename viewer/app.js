'use strict';

const lanesEl = document.getElementById('lanes');
const statusEl = document.getElementById('status');
const emptyHintEl = document.getElementById('empty-hint');
const lanes = new Map(); // sessionId -> lane record

const KIND_META = {
  prompt: { icon: 'user', cls: 'k-prompt', title: 'You' },
  text: { icon: 'signal', cls: 'k-text', title: 'Assistant' },
  thinking: { icon: 'thinking', cls: 'k-thinking', title: 'Thinking' },
  tool: { icon: 'tool', cls: 'k-tool', title: 'Tool call' },
  result: { icon: 'check', cls: 'k-result', title: 'Result' },
  error: { icon: 'error', cls: 'k-error', title: 'Error' },
  image: { icon: 'image', cls: 'k-image', title: 'Image' },
  system: { icon: 'activity', cls: 'k-system', title: 'Activity' },
};

function makeIcon(name, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add(className || 'ui-icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-' + name);
  svg.appendChild(use);
  return svg;
}

const narrator = new Narrator();
window.narrator = narrator; // settings.js drives it directly (test button, refresh after save)

let mostRecentSessionId = null;
let pinnedSessionId = null; // manual override, click a lane's speaker icon to set this
let speakingLaneEl = null;
let multiProjectMode = false; // set once the system event reports >1 watched project, toggles the per-lane project badge

// The session that actually gets to speak: a manual pin always wins over
// auto-follow, so picking a lane sticks until you pick a different one or
// explicitly release it, rather than getting yanked back the instant some
// other session does anything.
function focusSessionId() {
  return pinnedSessionId || mostRecentSessionId;
}

const speakThinkingEl = document.getElementById('speak-thinking');
const speakToolsEl = document.getElementById('speak-tools');
const voiceToggleEl = document.getElementById('voice-toggle');
const stopTalkingEl = document.getElementById('stop-talking');
const voiceModeEl = document.getElementById('voice-mode');
const voiceSelectEl = document.getElementById('voice-select');
const voiceRateEl = document.getElementById('voice-rate');
const voiceRateReadoutEl = document.getElementById('voice-rate-readout');
const viewButtons = [...document.querySelectorAll('.view-option')];

// --- client-side prefs that persist across reloads, no server round trip ---
const PREFS_KEY = 'fama.prefs';
// Renamed three times now (claude-narrator -> Aloud -> Pico -> Fama), oldest
// first so a very old install still migrates forward correctly.
const LEGACY_PREFS_KEYS = ['pico.prefs', 'claude-narrator.prefs'];
function loadPrefs() {
  try {
    const current = localStorage.getItem(PREFS_KEY);
    if (current) return JSON.parse(current) || {};
    // Carry forward whatever a returning user already had instead of
    // silently resetting their thinking/tools/speed prefs on this update.
    for (const legacyKey of LEGACY_PREFS_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (legacy) {
        localStorage.setItem(PREFS_KEY, legacy);
        localStorage.removeItem(legacyKey);
        return JSON.parse(legacy) || {};
      }
    }
    return {};
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  const next = Object.assign(loadPrefs(), patch);
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
}
const prefs = loadPrefs();
if (typeof prefs.speakThinking === 'boolean') speakThinkingEl.checked = prefs.speakThinking;
if (typeof prefs.speakTools === 'boolean') speakToolsEl.checked = prefs.speakTools;
if (typeof prefs.rate === 'number') voiceRateEl.value = prefs.rate;

function applyViewMode(requestedMode, persist) {
  const mode = requestedMode === 'activity' ? 'activity' : 'conversation';
  document.body.classList.toggle('view-conversation', mode === 'conversation');
  document.body.classList.toggle('view-activity', mode === 'activity');
  for (const button of viewButtons) {
    const selected = button.dataset.view === mode;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  if (persist) savePrefs({ viewMode: mode });
}

applyViewMode(prefs.viewMode || 'conversation', false);
for (const button of viewButtons) button.addEventListener('click', () => applyViewMode(button.dataset.view, true));
speakThinkingEl.addEventListener('change', () => savePrefs({ speakThinking: speakThinkingEl.checked }));
speakToolsEl.addEventListener('change', () => savePrefs({ speakTools: speakToolsEl.checked }));

// --- voice controls -----------------------------------------------------

narrator.configure({ onStateChange: (isSpeaking) => {
  window.mascot.setSpeaking(isSpeaking);
  stopTalkingEl.disabled = !isSpeaking;
  if (speakingLaneEl) {
    speakingLaneEl.classList.remove('lane-speaking');
    speakingLaneEl = null;
  }
  if (isSpeaking) {
    const lane = lanes.get(focusSessionId() || 'unknown');
    if (lane) {
      lane.el.classList.add('lane-speaking');
      speakingLaneEl = lane.el;
    }
  }
} });

// Cancels only the current/queued line(s), voice stays enabled and keeps
// narrating whatever comes next, this is deliberately not the same as the
// enable/disable toggle.
stopTalkingEl.addEventListener('click', () => narrator.stop());

function refreshVoiceButton() {
  const state = narrator.status();
  const label = voiceToggleEl.querySelector('span');
  if (label) label.textContent = state.enabled ? 'Voice on' : 'Enable voice';
  voiceToggleEl.classList.toggle('active', state.enabled);
  voiceToggleEl.setAttribute('aria-pressed', String(state.enabled));
}

voiceToggleEl.addEventListener('click', () => {
  if (!narrator.status().supported) {
    const label = voiceToggleEl.querySelector('span');
    if (label) label.textContent = 'Speech unavailable';
    voiceToggleEl.disabled = true;
    return;
  }
  if (narrator.status().enabled) narrator.disable();
  else narrator.enable();
  refreshVoiceButton();
});
refreshVoiceButton();

function updateVoiceModeBadge() {
  narrator.refreshConfig().then((cfg) => {
    voiceModeEl.textContent = cfg.cloud ? `OpenAI · ${cfg.model} · ~${cfg.narrationSeconds}s` : 'free (Windows voice)';
    voiceModeEl.classList.toggle('cloud', cfg.cloud);
    voiceModeEl.title = cfg.cloud
      ? `Using OpenAI text-to-speech (${cfg.model}, ${cfg.voice}), server-side, costs a small amount per line`
      : 'No key configured, using your browser/OS built-in voice, completely free';
  });
}
window.updateVoiceModeBadge = updateVoiceModeBadge;
narrator.ready.then(() => updateVoiceModeBadge());

function populateVoices() {
  const voices = narrator.listVoices();
  if (!voices.length) return;
  const current = narrator.status().voiceName;
  voiceSelectEl.innerHTML = '';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
    voiceSelectEl.appendChild(opt);
  }
  if (current) voiceSelectEl.value = current;
  else if (voices[0]) narrator.setVoiceByName(voices[0].name);
}
if (narrator.status().supported) {
  window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
  populateVoices();
}
voiceSelectEl.addEventListener('change', () => narrator.setVoiceByName(voiceSelectEl.value));

function applyRate(value) {
  const state = narrator.configure({ rate: value });
  voiceRateReadoutEl.textContent = state.rate.toFixed(2) + '×';
}
applyRate(voiceRateEl.value); // pick up the restored pref (or the HTML default) immediately
voiceRateEl.addEventListener('input', () => {
  applyRate(voiceRateEl.value);
  savePrefs({ rate: narrator.status().rate });
});

function truncateForSpeech(text, max) {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > max * 0.4 ? cut.slice(0, lastStop + 1) : cut) + '…';
}

// --- lanes ----------------------------------------------------------------

function updateEmptyHint() {
  emptyHintEl.hidden = lanes.size !== 0;
}

// Custom lane names persist across reloads (sessionId -> name you typed),
// same localStorage pattern as prefs. A session's own first prompt still
// supplies the default title, this only overrides it once you've actually
// renamed one.
const SESSION_NAMES_KEY = 'fama.session-names';
const LEGACY_SESSION_NAMES_KEY = 'pico.session-names'; // this feature only ever existed under the Pico name, one migration is enough
function loadSessionNames() {
  try {
    const current = localStorage.getItem(SESSION_NAMES_KEY);
    if (current) return JSON.parse(current) || {};
    const legacy = localStorage.getItem(LEGACY_SESSION_NAMES_KEY);
    if (legacy) {
      localStorage.setItem(SESSION_NAMES_KEY, legacy);
      localStorage.removeItem(LEGACY_SESSION_NAMES_KEY);
      return JSON.parse(legacy) || {};
    }
    return {};
  } catch {
    return {};
  }
}
function saveSessionName(sessionId, name) {
  const names = loadSessionNames();
  if (name) names[sessionId] = name;
  else delete names[sessionId];
  localStorage.setItem(SESSION_NAMES_KEY, JSON.stringify(names));
}

function laneFor(sessionId) {
  const key = sessionId || 'unknown';
  if (lanes.has(key)) return lanes.get(key);

  const el = document.createElement('section');
  el.className = 'lane';
  el.draggable = true;
  el.innerHTML = '<div class="lane-header"><span class="lane-live-dot"></span></div><div class="lane-feed" role="log" aria-live="polite"></div>';
  const header = el.querySelector('.lane-header');

  const dragHandle = document.createElement('span');
  dragHandle.className = 'lane-drag-handle';
  dragHandle.title = 'Drag to reposition';
  dragHandle.appendChild(makeIcon('grip'));

  const projectEl = document.createElement('span');
  projectEl.className = 'lane-project hidden';

  const titleEl = document.createElement('span');
  titleEl.className = 'lane-title';
  titleEl.title = 'Double-click to rename · session ' + key;
  const savedNames = loadSessionNames();
  const customName = savedNames[key];
  titleEl.textContent = customName || 'session ' + key.slice(0, 12);

  const renameInput = document.createElement('input');
  renameInput.className = 'lane-rename-input hidden';
  renameInput.maxLength = 60;
  function startRename() {
    renameInput.value = titleEl.textContent;
    titleEl.classList.add('hidden');
    renameInput.classList.remove('hidden');
    renameInput.focus();
    renameInput.select();
  }
  function commitRename() {
    const value = renameInput.value.trim();
    renameInput.classList.add('hidden');
    titleEl.classList.remove('hidden');
    if (value) {
      titleEl.textContent = value;
      lane.titled = true; // manual name wins, don't let the first-prompt title overwrite it
      saveSessionName(key, value);
    } else {
      saveSessionName(key, null);
    }
  }
  titleEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    startRename();
  });
  renameInput.addEventListener('click', (e) => e.stopPropagation());
  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameInput.blur();
    if (e.key === 'Escape') {
      renameInput.value = titleEl.textContent;
      renameInput.blur();
    }
  });
  renameInput.addEventListener('blur', commitRename);

  const badgeEl = document.createElement('span');
  badgeEl.className = 'lane-current-badge';
  badgeEl.textContent = 'following';

  const providerEl = document.createElement('span');
  providerEl.className = 'lane-provider';

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'lane-pin';
  pinBtn.title = 'Listen to this session, overriding auto-follow';
  pinBtn.setAttribute('aria-label', 'Listen to this session, overriding auto-follow');
  pinBtn.setAttribute('aria-pressed', 'false');
  pinBtn.appendChild(makeIcon('pin'));
  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't also toggle collapse
    pinnedSessionId = pinnedSessionId === key ? null : key;
    markCurrentLane();
  });

  const collapseIcon = makeIcon('chevron', 'lane-chevron');
  header.append(dragHandle, projectEl, titleEl, renameInput, providerEl, badgeEl, pinBtn, collapseIcon);
  lanesEl.prepend(el);

  header.title = 'Click to collapse this session';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'true');
  function toggleCollapsed() {
    const collapsed = el.classList.toggle('collapsed');
    header.setAttribute('aria-expanded', String(!collapsed));
  }
  header.addEventListener('click', toggleCollapsed);
  header.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleCollapsed();
  });

  // Plain HTML5 drag-and-drop, no library: these are already real DOM nodes
  // in a simple flex column, reordering is just moving the dragged element
  // to sit before/after whatever it's currently over.
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = lanesEl.querySelector('.lane.dragging');
    if (!dragging || dragging === el) return;
    const rect = el.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    lanesEl.insertBefore(dragging, before ? el : el.nextSibling);
  });

  const lane = {
    el,
    feedEl: el.querySelector('.lane-feed'),
    titleEl: el.querySelector('.lane-title'),
    projectEl,
    providerEl,
    lastTs: Date.now(),
    titled: !!customName,
  };
  lanes.set(key, lane);
  updateEmptyHint();
  return lane;
}

// "Attached" marks whichever session is most recently active, i.e. whichever
// one would speak next. It's the honest answer to "which thread are you on":
// this tool has no way to know which Claude Code window has your focus, only
// which one is actually doing something right now.
function markCurrentLane() {
  for (const l of lanes.values()) {
    l.el.classList.remove('is-current', 'is-pinned');
    const badge = l.el.querySelector('.lane-current-badge');
    if (badge) badge.textContent = 'following';
    const pin = l.el.querySelector('.lane-pin');
    if (pin) pin.setAttribute('aria-pressed', 'false');
  }
  const current = lanes.get(focusSessionId() || 'unknown');
  if (current) {
    current.el.classList.add('is-current');
    if (pinnedSessionId) {
      current.el.classList.add('is-pinned');
      const badge = current.el.querySelector('.lane-current-badge');
      if (badge) badge.textContent = 'pinned';
      const pin = current.el.querySelector('.lane-pin');
      if (pin) pin.setAttribute('aria-pressed', 'true');
    }
  }
}

function eventAuthor(evt, meta) {
  if (evt.kind === 'prompt') return 'You';
  if (evt.kind === 'text') return evt.provider === 'codex' ? 'Codex' : 'Claude';
  if (evt.kind === 'tool' && evt.label) return evt.label;
  return meta.title;
}

function formatEventTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function appendEventDetail(detail, evt) {
  // Image events carry the actual picture rather than only a caption. Inline
  // data stays same-origin and remote images remain explicit outbound links.
  if (evt.kind === 'image' && evt.media && evt.media.tooLarge) {
    detail.textContent = '[image too large to preview]';
    return;
  }
  if (evt.kind === 'image' && evt.media) {
    const src = evt.media.data ? `data:${evt.media.mediaType || 'image/png'};base64,${evt.media.data}` : null;
    if (src) {
      const link = document.createElement('a');
      link.href = src;
      link.target = '_blank';
      link.rel = 'noopener';
      const img = document.createElement('img');
      img.className = 'row-thumb';
      img.src = src;
      img.alt = 'Shared image';
      img.loading = 'lazy';
      link.appendChild(img);
      detail.appendChild(link);
      return;
    }
    if (evt.media.externalUrl) {
      const link = document.createElement('a');
      link.href = evt.media.externalUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open external image';
      detail.appendChild(link);
      return;
    }
  }
  detail.textContent = evt.kind === 'thinking' ? evt.full || evt.detail || '' : evt.detail || '';
}

function addRow(lane, evt) {
  if (!lane.titled && evt.kind === 'prompt' && evt.detail) {
    lane.titleEl.textContent = evt.detail.slice(0, 70);
    lane.titled = true;
  }

  if (!lane.providerEl.textContent && evt.provider) {
    lane.providerEl.textContent = evt.provider === 'codex' ? 'Codex' : 'Claude';
    lane.providerEl.dataset.provider = evt.provider;
  }

  const meta = KIND_META[evt.kind] || KIND_META.system;
  const row = document.createElement('div');
  row.className = 'row ' + meta.cls;
  row.dataset.kind = evt.kind || 'system';

  const avatar = document.createElement('span');
  avatar.className = 'row-avatar';
  avatar.appendChild(makeIcon(meta.icon));

  const content = document.createElement('div');
  content.className = 'row-content';

  const head = document.createElement('div');
  head.className = 'row-head';
  const label = document.createElement('span');
  label.className = 'row-label';
  label.textContent = eventAuthor(evt, meta);
  const time = document.createElement('time');
  time.className = 'row-time';
  time.dateTime = evt.ts || '';
  time.textContent = formatEventTime(evt.ts);
  head.append(label, time);

  const detail = document.createElement('div');
  detail.className = 'row-detail';
  appendEventDetail(detail, evt);

  const isDisclosure = evt.kind === 'thinking' || evt.kind === 'tool' || evt.kind === 'result' || evt.kind === 'error';
  if (isDisclosure) {
    const disclosure = document.createElement('details');
    disclosure.className = 'event-disclosure';
    disclosure.open = evt.kind === 'error';
    const summary = document.createElement('summary');
    summary.append(avatar, head);
    const chevron = makeIcon('chevron', 'disclosure-chevron');
    summary.appendChild(chevron);
    const body = document.createElement('div');
    body.className = 'disclosure-body';
    body.appendChild(detail);
    disclosure.append(summary, body);
    row.appendChild(disclosure);
  } else {
    content.append(head, detail);
    row.append(avatar, content);
  }

  lane.feedEl.appendChild(row);
  while (lane.feedEl.children.length > 200) lane.feedEl.removeChild(lane.feedEl.firstChild);
  lane.feedEl.scrollTop = lane.feedEl.scrollHeight;
  lane.lastTs = Date.now();
  lane.el.classList.remove('idle');
}

// --- voice + mascot dispatch ------------------------------------------

function handleVoiceAndMascot(evt) {
  // Only one session gets to speak: whichever's pinned, or the most recently
  // active one if nothing's pinned. Overlapping robot voices from several
  // sessions at once is worse than picking wrong.
  const isFocused = evt.sessionId === focusSessionId();

  if (evt.kind === 'thinking') {
    window.mascot.pulseThinking();
    // Thinking fires often and is lower priority than a real narrated line,
    // only speak it when nothing else is already queued, so it reflects the
    // CURRENT thought instead of reading a backlog of stale ones. The server
    // rewrite step (when on) also keeps each line short, so this empties out
    // fast instead of falling behind.
    if (isFocused && speakThinkingEl.checked && narrator.isIdle()) {
      // evt.full (added alongside the always-220-char evt.detail display
      // text) carries the real thinking block, up to lib/parse.js's 4000-char
      // ceiling, so the server-side rewrite step actually has real reasoning
      // to condense instead of an already-truncated fragment. Cap raised to
      // match: the old 350 here was a second truncation on top of the parse
      // layer's, re-creating the exact bug one layer up if left as-is.
      narrator.enqueue(truncateForSpeech(evt.full || evt.detail, 2000), 'thinking');
    }
  } else if (evt.kind === 'tool') {
    window.mascot.pulseTool(evt.label);
    if (isFocused && speakToolsEl.checked) narrator.enqueue('running ' + evt.label, 'tool');
  } else if (evt.kind === 'text' && isFocused) {
    narrator.enqueue(truncateForSpeech(evt.detail, 500), 'text');
  }
}

// --- event stream -------------------------------------------------------

const source = new EventSource('/events');
source.onopen = () => {
  statusEl.textContent = 'live';
  statusEl.classList.add('live');
};
source.onerror = () => {
  statusEl.textContent = 'reconnecting…';
  statusEl.classList.remove('live');
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
    if (Array.isArray(evt.projects) && evt.projects.length) {
      statusEl.title = 'Watching: ' + evt.projects.map((p) => p.name).join(', ');
      multiProjectMode = evt.projects.length > 1;
    }
    return;
  }
  const lane = laneFor(evt.sessionId);
  // Project badge: only worth showing once more than one project is
  // actually in play, in the common single-project case it's just noise
  // repeating what the header tooltip already says.
  if (evt.projectName && !lane.projectEl.textContent) {
    lane.projectEl.textContent = evt.projectName;
  }
  lane.projectEl.classList.toggle('hidden', !multiProjectMode);
  if (evt.sessionId && evt.sessionId !== mostRecentSessionId) {
    mostRecentSessionId = evt.sessionId;
    if (!pinnedSessionId) markCurrentLane(); // pinned means this activity doesn't change who's speaking
  }
  addRow(lane, evt);
  handleVoiceAndMascot(evt);
};

setInterval(() => {
  const now = Date.now();
  for (const lane of lanes.values()) {
    if (now - lane.lastTs > 60000) lane.el.classList.add('idle');
  }
}, 5000);

updateEmptyHint();
