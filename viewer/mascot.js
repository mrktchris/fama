'use strict';

// Tiny state machine for the animated mascot. All the actual animation is
// CSS (see style.css), this just flips classes and a status label.

(function () {
  const el = document.getElementById('mascot');
  const labelEl = document.getElementById('mascot-label');

  const LABELS = { idle: 'idle', thinking: 'thinking…', speaking: 'speaking…', tool: 'working…' };

  let revertTimer = null;
  let base = 'idle'; // what we fall back to once a transient pulse ends: idle or speaking

  function show(state, label) {
    el.classList.remove('idle', 'thinking', 'speaking', 'tool');
    el.classList.add(state);
    labelEl.textContent = label || LABELS[state] || state;
  }

  function setSpeaking(isSpeaking) {
    base = isSpeaking ? 'speaking' : 'idle';
    clearTimeout(revertTimer);
    show(base);
  }

  function pulse(state, label, holdMs) {
    show(state, label);
    clearTimeout(revertTimer);
    revertTimer = setTimeout(() => show(base), holdMs);
  }

  window.mascot = {
    setSpeaking,
    pulseThinking: () => pulse('thinking', LABELS.thinking, 2200),
    pulseTool: (name) => pulse('tool', '→ ' + name, 1600),
  };
})();
