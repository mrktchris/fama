'use strict';

// The gear-icon modal: lets you paste an OpenAI key, pick model/voice, and
// toggle the rewrite step, all from the browser instead of hand-editing .env.
// Saving here just calls POST /settings, which is the same thing a hand-edited
// .env accomplishes, the UI is a convenience layer, not a separate system.

(function () {
  // Accent color: purely client-side, applies instantly, no server round
  // trip, no Save needed, this is presentation only. Persists in
  // localStorage so it survives a reload, same pattern as the other
  // client-only prefs (voice, thinking/tools toggles, lane names).
  const ACCENT_KEY = 'fama.accent';
  const swatches = document.querySelectorAll('#accent-swatches .swatch');
  function applyAccent(hex) {
    const selected = Array.from(swatches).find((s) => s.dataset.accent === hex) || swatches[0];
    document.documentElement.dataset.accent = selected ? selected.dataset.theme : 'aurora';
    swatches.forEach((s) => s.classList.toggle('active', s.dataset.accent === hex));
  }
  swatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      applyAccent(swatch.dataset.accent);
      localStorage.setItem(ACCENT_KEY, JSON.stringify({ hex: swatch.dataset.accent }));
    });
  });
  try {
    const saved = JSON.parse(localStorage.getItem(ACCENT_KEY));
    if (saved && saved.hex) applyAccent(saved.hex);
    else swatches[0] && swatches[0].classList.add('active'); // aurora blue default, matches the CSS default already in place
  } catch {
    swatches[0] && swatches[0].classList.add('active');
  }

  // Feed text size: same pattern, a CSS custom property on :root that
  // .lane-feed reads (see style.css), so every open lane picks it up
  // immediately, no reload.
  const FEED_SIZE_KEY = 'fama.feed-size';
  const sizeChips = document.querySelectorAll('#feed-size-row .preset-chip');
  function applyFeedSize(size) {
    const allowed = new Set(Array.from(sizeChips, (chip) => chip.dataset.size));
    const selected = allowed.has(size) ? size : '12px';
    document.documentElement.dataset.feedSize = selected;
    sizeChips.forEach((c) => c.classList.toggle('active', c.dataset.size === selected));
  }
  sizeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      applyFeedSize(chip.dataset.size);
      localStorage.setItem(FEED_SIZE_KEY, chip.dataset.size);
    });
  });
  applyFeedSize(localStorage.getItem(FEED_SIZE_KEY) || '12px');

  // Compact layout, mascot visibility, reduce-motion override: all just a
  // body class flip plus a localStorage flag, same instant/no-Save pattern.
  function wireBodyClassToggle(checkboxId, className, storageKey, invert) {
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) return;
    const stored = localStorage.getItem(storageKey);
    const initial = stored === null ? checkbox.checked : stored === 'true';
    checkbox.checked = initial;
    document.body.classList.toggle(className, invert ? !initial : initial);
    checkbox.addEventListener('change', () => {
      document.body.classList.toggle(className, invert ? !checkbox.checked : checkbox.checked);
      localStorage.setItem(storageKey, String(checkbox.checked));
    });
  }
  wireBodyClassToggle('settings-density', 'density-compact', 'fama.density-compact', false);
  wireBodyClassToggle('settings-mascot', 'mascot-hidden', 'fama.mascot-visible', true); // checkbox means "show", class means "hidden", inverted
  wireBodyClassToggle('settings-reduce-motion', 'reduce-motion', 'fama.reduce-motion', false);

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
  let focusBeforeOpen = null;

  // Electron-only controls (native notifications, launch at startup): meaningless
  // when this same page is opened plain in a browser tab (`npm start`), so the
  // whole section stays hidden unless preload-main.js actually exposed the bridge.
  const desktopAppSection = document.getElementById('desktop-app-section');
  const notificationsCheckbox = document.getElementById('settings-notifications');
  const launchStartupCheckbox = document.getElementById('settings-launch-startup');
  if (window.famaDesktop) {
    desktopAppSection.classList.remove('hidden');
    window.famaDesktop.getPrefs().then((prefs) => {
      notificationsCheckbox.checked = prefs.notificationsEnabled;
      launchStartupCheckbox.checked = prefs.launchOnStartup;
    });
    notificationsCheckbox.addEventListener('change', () => {
      window.famaDesktop.setPrefs({ notificationsEnabled: notificationsCheckbox.checked });
    });
    launchStartupCheckbox.addEventListener('change', () => {
      window.famaDesktop.setPrefs({ launchOnStartup: launchStartupCheckbox.checked });
    });
  }

  // Project selector button, header: same Electron-gated pattern as above.
  // Was tray-only ("Manage watched projects…"), which is easy to never find
  // on your own — this surfaces the same flow directly in the app.
  const manageProjectsBtn = document.getElementById('manage-projects');
  if (window.famaDesktop && window.famaDesktop.manageProjects) {
    manageProjectsBtn.classList.remove('hidden');
    manageProjectsBtn.addEventListener('click', () => window.famaDesktop.manageProjects());
  }

  // Pricing comes from the Cloud Narration Module through /config. Keeping the
  // provider knowledge server-side prevents the preview and recorded usage
  // from drifting into two different estimates again.
  const CHARS_PER_WORD = 5.5;
  let pricePerChar = {};
  function updateLengthReadout() {
    const seconds = Number(lengthSlider.value);
    const words = Math.max(6, Math.round(seconds * 2.5));
    const chars = Math.round(words * CHARS_PER_WORD);
    lengthReadout.textContent = `~${seconds}s, ~${words} words`;
    const price = pricePerChar[modelSelect.value];
    if (!Number.isFinite(price)) {
      lengthCost.textContent = 'Cost estimate is loading from the local narration service.';
      return;
    }
    const cost = chars * price;
    lengthCost.textContent = `~$${cost.toFixed(4)} estimated per line at ${modelSelect.value}, more length is directly more credits`;
  }
  lengthSlider.addEventListener('input', updateLengthReadout);
  modelSelect.addEventListener('change', updateLengthReadout);

  function updateVoiceStyleSupport() {
    const supported = modelSelect.value === 'gpt-4o-mini-tts';
    voiceStyleSupportEl.textContent = supported ? '' : '(only gpt-4o-mini-tts honors this, pick it above)';
    voiceStyleInput.disabled = !supported;
    voiceStyleInput.placeholder = supported ? 'e.g. natural Dominican-American English, warm and conversational' : 'switch the model above to use this';
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
    // broken, so show more precision until the number actually earns fewer
    // digits. The leading ~ is deliberate: gpt-4o-mini-tts is actually billed
    // per token, not per character, this tracker approximates it at the
    // per-character rate, it's a real estimate, not a synced-to-billing number.
    if (n === 0) return '~$0.00';
    if (n < 0.01) return '~$' + n.toFixed(4);
    if (n < 1) return '~$' + n.toFixed(3);
    return '~$' + n.toFixed(2);
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
    fetch('/usage/reset', { method: 'POST', headers: { 'X-Fama-Token': window.__FAMA_TOKEN__ || '' } }).then(refreshUsage);
  });

  function open() {
    focusBeforeOpen = document.activeElement;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    toggleBtn.setAttribute('aria-expanded', 'true');
    refreshFromServer();
    refreshUsage();
    closeBtn.focus();
  }
  function close() {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    toggleBtn.setAttribute('aria-expanded', 'false');
    saveStatusEl.textContent = '';
    if (focusBeforeOpen && typeof focusBeforeOpen.focus === 'function') focusBeforeOpen.focus();
  }

  toggleBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) close();
    if (e.key === 'Tab' && !overlay.classList.contains('hidden')) {
      const focusable = [...overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  keyToggleBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    const visible = apiKeyInput.type === 'text';
    keyToggleBtn.setAttribute('aria-pressed', String(visible));
    keyToggleBtn.setAttribute('aria-label', visible ? 'Hide API key' : 'Show API key');
  });

  function refreshFromServer() {
    fetch('/config')
      .then((r) => r.json())
      .then((cfg) => {
        modelSelect.value = cfg.model || 'gpt-4o-mini-tts';
        pricePerChar = cfg.pricing && cfg.pricing.estimatedTtsPerChar ? cfg.pricing.estimatedTtsPerChar : {};
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
      headers: { 'Content-Type': 'application/json', 'X-Fama-Token': window.__FAMA_TOKEN__ || '' },
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
          return true;
        });
      })
      .catch((err) => {
        saveStatusEl.textContent = 'Save failed: ' + err.message;
        saveStatusEl.classList.add('error');
        return false;
      });
  }

  saveBtn.addEventListener('click', () => saveSettings());

  removeBtn.addEventListener('click', () => {
    if (!confirm('Remove the saved OpenAI key? This switches back to the free voice.')) return;
    apiKeyInput.value = '';
    saveSettings({ clearKey: true });
  });

  testBtn.addEventListener('click', () => {
    // Found by audit: this used to test whatever was last SAVED, not what's
    // currently typed in the form, a control that silently contradicted its
    // own label. Now it saves first (same as clicking Save) so what you hear
    // always matches what's on screen when you click it.
    if (!window.narrator.status().enabled) window.narrator.enable();
    const sample =
      "So I'm thinking about whether to use approach A or approach B here, and honestly A seems cleaner " +
      'since it avoids the extra dependency, but let me actually double check that before committing to it.';
    saveSettings().then((saved) => {
      if (!saved) return;
      window.narrator.enqueue(sample, 'thinking');
      setTimeout(refreshUsage, 3000); // rough guess at when the call has actually landed
    });
  });
})();
