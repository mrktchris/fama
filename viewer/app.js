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

const narrator = new Narrator();
window.narrator = narrator; // settings.js drives it directly (test button, refresh after save)

let mostRecentSessionId = null;
let speakingLaneEl = null;

const speakThinkingEl = document.getElementById('speak-thinking');
const speakToolsEl = document.getElementById('speak-tools');
const voiceToggleEl = document.getElementById('voice-toggle');
const voiceModeEl = document.getElementById('voice-mode');
const voiceSelectEl = document.getElementById('voice-select');
const voiceRateEl = document.getElementById('voice-rate');
const voiceRateReadoutEl = document.getElementById('voice-rate-readout');

// --- client-side prefs that persist across reloads, no server round trip ---
const PREFS_KEY = 'claude-narrator.prefs';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
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
speakThinkingEl.addEventListener('change', () => savePrefs({ speakThinking: speakThinkingEl.checked }));
speakToolsEl.addEventListener('change', () => savePrefs({ speakTools: speakToolsEl.checked }));

// --- voice controls -----------------------------------------------------

narrator.onStateChange = (isSpeaking) => {
  window.mascot.setSpeaking(isSpeaking);
  if (speakingLaneEl) {
    speakingLaneEl.classList.remove('lane-speaking');
    speakingLaneEl = null;
  }
  if (isSpeaking) {
    const lane = lanes.get(mostRecentSessionId || 'unknown');
    if (lane) {
      lane.el.classList.add('lane-speaking');
      speakingLaneEl = lane.el;
    }
  }
};

function refreshVoiceButton() {
  voiceToggleEl.textContent = narrator.enabled ? '🔊 voice on' : '🔈 enable voice';
  voiceToggleEl.classList.toggle('active', narrator.enabled);
}

voiceToggleEl.addEventListener('click', () => {
  if (!narrator.supported) {
    voiceToggleEl.textContent = 'speech not supported here';
    voiceToggleEl.disabled = true;
    return;
  }
  if (narrator.enabled) narrator.disable();
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
  const current = narrator.voice ? narrator.voice.name : null;
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
if (narrator.supported) {
  window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
  populateVoices();
}
voiceSelectEl.addEventListener('change', () => narrator.setVoiceByName(voiceSelectEl.value));

function applyRate(value) {
  narrator.rate = Number(value);
  voiceRateReadoutEl.textContent = narrator.rate.toFixed(2) + '×';
}
applyRate(voiceRateEl.value); // pick up the restored pref (or the HTML default) immediately
voiceRateEl.addEventListener('input', () => {
  applyRate(voiceRateEl.value);
  savePrefs({ rate: narrator.rate });
});

function truncateForSpeech(text, max) {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > max * 0.4 ? cut.slice(0, lastStop + 1) : cut) + '…';
}

// --- lanes ----------------------------------------------------------------

function updateEmptyHint() {
  emptyHintEl.style.display = lanes.size === 0 ? 'block' : 'none';
}

function laneFor(sessionId) {
  const key = sessionId || 'unknown';
  if (lanes.has(key)) return lanes.get(key);

  const el = document.createElement('section');
  el.className = 'lane';
  el.innerHTML =
    '<div class="lane-header"><span class="lane-live-dot"></span>' +
    '<span class="lane-title" title="session ' + key + '">session ' + key.slice(0, 12) + '</span>' +
    '<span class="lane-current-badge">attached</span></div>' +
    '<div class="lane-feed"></div>';
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

// "Attached" marks whichever session is most recently active, i.e. whichever
// one would speak next. It's the honest answer to "which thread are you on":
// this tool has no way to know which Claude Code window has your focus, only
// which one is actually doing something right now.
function markCurrentLane() {
  for (const l of lanes.values()) l.el.classList.remove('is-current');
  const current = lanes.get(mostRecentSessionId || 'unknown');
  if (current) current.el.classList.add('is-current');
}

function addRow(lane, evt) {
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

// --- voice + mascot dispatch ------------------------------------------

function handleVoiceAndMascot(evt) {
  // Only the most recently active session gets to speak. Overlapping robot
  // voices from several sessions at once is worse than picking wrong.
  const isFocused = evt.sessionId === mostRecentSessionId;

  if (evt.kind === 'thinking') {
    window.mascot.pulseThinking();
    // Thinking fires often and is lower priority than a real narrated line,
    // only speak it when nothing else is already queued, so it reflects the
    // CURRENT thought instead of reading a backlog of stale ones. The server
    // rewrite step (when on) also keeps each line short, so this empties out
    // fast instead of falling behind.
    if (isFocused && speakThinkingEl.checked && narrator.pending === 0) {
      narrator.say(truncateForSpeech(evt.detail, 350), 'thinking');
    }
  } else if (evt.kind === 'tool') {
    window.mascot.pulseTool(evt.label);
    if (isFocused && speakToolsEl.checked) narrator.say('running ' + evt.label, 'tool');
  } else if (evt.kind === 'text' && isFocused) {
    narrator.say(truncateForSpeech(evt.detail, 500), 'text');
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
    return;
  }
  const lane = laneFor(evt.sessionId);
  if (evt.sessionId && evt.sessionId !== mostRecentSessionId) {
    mostRecentSessionId = evt.sessionId;
    markCurrentLane();
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
