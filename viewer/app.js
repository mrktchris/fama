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
let mostRecentSessionId = null;
let speakingLaneEl = null;

const speakThinkingEl = document.getElementById('speak-thinking');
const speakToolsEl = document.getElementById('speak-tools');
const voiceToggleEl = document.getElementById('voice-toggle');
const voiceSelectEl = document.getElementById('voice-select');
const voiceRateEl = document.getElementById('voice-rate');

// --- voice controls -------------------------------------------------------

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

const voiceModeEl = document.getElementById('voice-mode');
narrator.ready.then(({ cloud, model }) => {
  voiceModeEl.textContent = cloud ? `OpenAI · ${model}` : 'free (Windows voice)';
  voiceModeEl.classList.toggle('cloud', cloud);
  voiceModeEl.title = cloud
    ? `Using OpenAI text-to-speech (${model}), server-side, costs a small amount per line`
    : 'No OPENAI_API_KEY configured, using your browser/OS built-in voice, completely free';
});

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
voiceRateEl.addEventListener('input', () => {
  narrator.rate = Number(voiceRateEl.value);
});

function truncateForSpeech(text, max) {
  if (!text || text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (lastStop > max * 0.4 ? cut.slice(0, lastStop + 1) : cut) + '…';
}

// --- lanes ------------------------------------------------------------

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
    '<span class="lane-title">session ' + key.slice(0, 8) + '</span></div>' +
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
    // CURRENT thought instead of reading a backlog of stale ones.
    if (isFocused && speakThinkingEl.checked && narrator.pending === 0) {
      narrator.say(truncateForSpeech(evt.detail, 200));
    }
  } else if (evt.kind === 'tool') {
    window.mascot.pulseTool(evt.label);
    if (isFocused && speakToolsEl.checked) narrator.say('running ' + evt.label);
  } else if (evt.kind === 'text' && isFocused) {
    narrator.say(truncateForSpeech(evt.detail, 280));
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
  if (evt.sessionId) mostRecentSessionId = evt.sessionId;
  addRow(laneFor(evt.sessionId), evt);
  handleVoiceAndMascot(evt);
};

setInterval(() => {
  const now = Date.now();
  for (const lane of lanes.values()) {
    if (now - lane.lastTs > 60000) lane.el.classList.add('idle');
  }
}, 5000);

updateEmptyHint();
