'use strict';

// The gear-icon modal: lets you paste an OpenAI key, pick model/voice, and
// toggle the rewrite step, all from the browser instead of hand-editing .env.
// Saving here just calls POST /settings, which is the same thing a hand-edited
// .env accomplishes, the UI is a convenience layer, not a separate system.

(function () {
  const overlay = document.getElementById('settings-overlay');
  const toggleBtn = document.getElementById('settings-toggle');
  const closeBtn = document.getElementById('settings-close');
  const apiKeyInput = document.getElementById('settings-api-key');
  const keyToggleBtn = document.getElementById('settings-key-toggle');
  const keyStatusEl = document.getElementById('settings-key-status');
  const modelSelect = document.getElementById('settings-model');
  const voiceSelect = document.getElementById('settings-voice');
  const rewriteCheckbox = document.getElementById('settings-rewrite');
  const lengthSlider = document.getElementById('settings-length');
  const lengthReadout = document.getElementById('settings-length-readout');
  const lengthCost = document.getElementById('settings-length-cost');
  const personaInput = document.getElementById('settings-persona');
  const voiceStyleInput = document.getElementById('settings-voice-style');
  const voiceStyleSupportEl = document.getElementById('voice-style-support');
  const saveBtn = document.getElementById('settings-save');
  const testBtn = document.getElementById('settings-test');
  const removeBtn = document.getElementById('settings-remove-key');
  const saveStatusEl = document.getElementById('settings-save-status');

  // Mirrors the server's own formula (see narrationPreset in server.js) so the
  // estimate on screen matches what actually gets sent, without a round trip.
  const CHARS_PER_WORD = 5.5;
  const PRICE_PER_CHAR = { 'tts-1': 0.000015, 'tts-1-hd': 0.00003 };
  function updateLengthReadout() {
    const seconds = Number(lengthSlider.value);
    const words = Math.max(6, Math.round(seconds * 2.5));
    const chars = Math.round(words * CHARS_PER_WORD);
    const price = PRICE_PER_CHAR[modelSelect.value] || PRICE_PER_CHAR['tts-1-hd'];
    const cost = chars * price;
    lengthReadout.textContent = `~${seconds}s, ~${words} words`;
    lengthCost.textContent = `~$${cost.toFixed(4)} per line at ${modelSelect.value}, more length is directly more credits`;
  }
  lengthSlider.addEventListener('input', updateLengthReadout);
  modelSelect.addEventListener('change', updateLengthReadout);

  function updateVoiceStyleSupport() {
    const supported = modelSelect.value === 'gpt-4o-mini-tts';
    voiceStyleSupportEl.textContent = supported ? '' : '(only gpt-4o-mini-tts honors this, pick it above)';
    voiceStyleInput.disabled = !supported;
    voiceStyleInput.placeholder = supported ? 'e.g. calm British accent, dry and understated' : 'switch the model above to use this';
  }
  modelSelect.addEventListener('change', updateVoiceStyleSupport);

  // Preset chips just fill the target field, they don't save by themselves,
  // Save still has to be clicked, same as if you'd typed it yourself.
  document.querySelectorAll('.preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const target = chip.dataset.target === 'persona' ? personaInput : voiceStyleInput;
      target.value = chip.dataset.value || '';
      target.focus();
    });
  });

  const usageTotalEl = document.getElementById('usage-total');
  const usageBreakdownEl = document.getElementById('usage-breakdown');
  const usageResetBtn = document.getElementById('usage-reset');

  function fmtMoney(n) {
    // Sub-cent totals are the common case here, $0.00 for everything reads as
    // broken, so show more precision until the number actually earns fewer digits.
    if (n === 0) return '$0.00';
    if (n < 0.01) return '$' + n.toFixed(4);
    if (n < 1) return '$' + n.toFixed(3);
    return '$' + n.toFixed(2);
  }

  function refreshUsage() {
    fetch('/usage')
      .then((r) => r.json())
      .then((u) => {
        usageTotalEl.textContent = fmtMoney(u.totalCost || 0);
        if (!u.ttsCalls) {
          usageBreakdownEl.textContent = 'No calls yet, this fills in as the cloud voice actually gets used.';
          return;
        }
        const since = u.since ? new Date(u.since).toLocaleDateString() : 'unknown';
        usageBreakdownEl.textContent =
          `${u.ttsCalls} line${u.ttsCalls === 1 ? '' : 's'} spoken, ${u.ttsChars} characters synthesized` +
          (u.rewriteCalls ? `, ${u.rewriteCalls} rewrite${u.rewriteCalls === 1 ? '' : 's'}` : '') +
          `, since ${since}.`;
      })
      .catch(() => {
        usageBreakdownEl.textContent = 'Could not reach the server.';
      });
  }

  usageResetBtn.addEventListener('click', () => {
    if (!confirm('Reset the usage counter to $0.00? This only zeroes the local tracker, it has no effect on your actual OpenAI billing.')) return;
    fetch('/usage/reset', { method: 'POST' }).then(refreshUsage);
  });

  function open() {
    overlay.classList.remove('hidden');
    refreshFromServer();
    refreshUsage();
  }
  function close() {
    overlay.classList.add('hidden');
    saveStatusEl.textContent = '';
  }

  toggleBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
  });

  keyToggleBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  function refreshFromServer() {
    fetch('/config')
      .then((r) => r.json())
      .then((cfg) => {
        modelSelect.value = cfg.model || 'tts-1-hd';
        voiceSelect.value = cfg.voice || 'alloy';
        rewriteCheckbox.checked = cfg.rewrite !== false;
        lengthSlider.min = cfg.narrationMin || 3;
        lengthSlider.max = cfg.narrationMax || 30;
        lengthSlider.value = cfg.narrationSeconds || 10;
        updateLengthReadout();
        personaInput.value = cfg.narrationPersona || '';
        voiceStyleInput.value = cfg.voiceStyle || '';
        updateVoiceStyleSupport();
        apiKeyInput.value = '';
        apiKeyInput.placeholder = cfg.cloudVoice ? 'sk-•••••••••••• (already set, leave blank to keep)' : 'sk-...';
        keyStatusEl.textContent = cfg.cloudVoice ? 'A key is currently configured.' : 'No key configured yet, using the free browser voice.';
        keyStatusEl.classList.toggle('ok', !!cfg.cloudVoice);
      })
      .catch(() => {
        keyStatusEl.textContent = 'Could not reach the server.';
      });
  }

  function saveSettings(extra) {
    saveStatusEl.classList.remove('error');
    saveStatusEl.textContent = 'Saving…';
    const body = Object.assign(
      {
        apiKey: apiKeyInput.value.trim(),
        model: modelSelect.value,
        voice: voiceSelect.value,
        rewrite: rewriteCheckbox.checked,
        narrationSeconds: Number(lengthSlider.value),
        narrationPersona: personaInput.value.trim(),
        voiceStyle: voiceStyleInput.value.trim(),
      },
      extra || {}
    );
    return fetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((result) => {
        if (result.error) throw new Error(result.error);
        return window.narrator.refreshConfig().then(() => {
          window.updateVoiceModeBadge && window.updateVoiceModeBadge();
          saveStatusEl.textContent = result.cloudVoice
            ? `Saved and live now: ${result.model}, ${result.voice}, ~${result.narrationSeconds}s per line, rewrite ${
                result.rewrite ? 'on' : 'off'
              }.`
            : 'Saved. No key set, using the free browser voice.';
          refreshFromServer();
        });
      })
      .catch((err) => {
        saveStatusEl.textContent = 'Save failed: ' + err.message;
        saveStatusEl.classList.add('error');
      });
  }

  saveBtn.addEventListener('click', () => saveSettings());

  removeBtn.addEventListener('click', () => {
    if (!confirm('Remove the saved OpenAI key? This switches back to the free voice.')) return;
    apiKeyInput.value = '';
    saveSettings({ clearKey: true });
  });

  testBtn.addEventListener('click', () => {
    if (!window.narrator.enabled) window.narrator.enable();
    const sample =
      "So I'm thinking about whether to use approach A or approach B here, and honestly A seems cleaner " +
      'since it avoids the extra dependency, but let me actually double check that before committing to it.';
    window.narrator.say(sample, 'thinking');
    setTimeout(refreshUsage, 3000); // rough guess at when the call has actually landed
  });
})();
