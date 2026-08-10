'use strict';

// Two voice backends behind one interface:
//  - local: window.speechSynthesis, the browser/OS built-in voice, free.
//  - cloud: fetches /speak (server-side OpenAI TTS, optionally rewritten
//    into a short natural sentence first), used only if the server reports
//    a key is configured.
// say() always resolves through one serialized chain so cloud and local
// utterances never overlap, and a failed cloud request falls back to the
// local voice for that one line instead of going silent.

(function () {
  const STORAGE_KEY = 'fama.voice';
  // Renamed twice now (claude-narrator -> Pico -> Fama), oldest first so a
  // pre-Pico install still migrates forward correctly, see _restoreVoice.
  const LEGACY_STORAGE_KEYS = ['pico.voice', 'claude-narrator.voice'];
  // Kept tight on purpose: a deep queue means a rate/settings change (or just
  // reality) takes that many stale utterances to catch up to, which reads as
  // "broken" even when every value is technically correct. Shallower queue,
  // fresher feedback, also fewer wasted calls on backlog nobody's still
  // listening for.
  const MAX_PENDING = 2;

  // Best-effort, fire-and-forget. A logging call failing shouldn't itself
  // throw, that would just be a new silent failure hiding the first one.
  function reportClientError(message) {
    try {
      fetch('/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fama-Token': window.__FAMA_TOKEN__ || '' },
        body: JSON.stringify({ message }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  function Narrator() {
    this.enabled = false;
    this.voice = null; // local speechSynthesis voice choice
    this.rate = 1;
    this.pending = 0;
    this.onStateChange = null; // callback(isSpeaking: boolean)
    this.cloudVoice = false;
    this._chain = Promise.resolve();
    this._audioEl = null;
    this._controller = null; // in-flight cloud fetch, abortable
    this._generation = 0; // bumped by stop(), a resolving fetch from a prior
    // generation is a stale result, not something that should ever start
    // playing after voice was turned off in the meantime. Found by external
    // review: stop() reset internal state but never actually cancelled an
    // in-flight /speak request, so audio could start playing after "off".

    if (this.supported) {
      window.speechSynthesis.addEventListener('voiceschanged', () => this._restoreVoice());
      this._restoreVoice();
    }

    this.ready = this.refreshConfig();
  }

  Narrator.prototype = {
    get supported() {
      return 'speechSynthesis' in window;
    },
    listVoices() {
      return this.supported ? window.speechSynthesis.getVoices() : [];
    },
    setVoiceByName(name) {
      const v = this.listVoices().find((v) => v.name === name);
      if (v) {
        this.voice = v;
        localStorage.setItem(STORAGE_KEY, name);
      }
    },
    _restoreVoice() {
      if (this.voice) return;
      let saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        // Carry forward a pre-rename choice instead of silently dropping back
        // to the default voice on this update, whichever name it was saved under.
        for (const legacyKey of LEGACY_STORAGE_KEYS) {
          saved = localStorage.getItem(legacyKey);
          if (saved) {
            localStorage.setItem(STORAGE_KEY, saved);
            localStorage.removeItem(legacyKey);
            break;
          }
        }
      }
      if (!saved) return;
      const v = this.listVoices().find((v) => v.name === saved);
      if (v) this.voice = v;
    },
    // Re-pulls /config, called on load and again after Settings saves so the
    // rest of the UI can reflect a change without a page reload.
    refreshConfig() {
      return fetch('/config')
        .then((r) => r.json())
        .then((cfg) => {
          this.cloudVoice = !!cfg.cloudVoice;
          return {
            cloud: this.cloudVoice,
            model: cfg.model || null,
            voice: cfg.voice || null,
            rewrite: !!cfg.rewrite,
            narrationSeconds: cfg.narrationSeconds || null,
          };
        })
        .catch(() => ({ cloud: false, model: null, voice: null, rewrite: false, narrationSeconds: null }));
    },
    enable() {
      // Browsers refuse programmatic audio, speech AND <audio>, until a real
      // user gesture has unlocked it once. This click handler is that gesture,
      // for both playback paths at once.
      if (this.supported) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      this._audioEl = new Audio();
      this._audioEl.play().catch(() => {});
      this.enabled = true;
      return true;
    },
    disable() {
      this.enabled = false;
      this.stop();
    },
    say(text, kind) {
      if (!this.enabled || !text) return;
      if (this.pending >= MAX_PENDING) return; // drop, this is a live feed, not a transcript to catch up on
      this.pending += 1;
      this.onStateChange && this.onStateChange(true);
      this._chain = this._chain
        .then(() => this._speakOne(text, kind))
        .catch(() => {}) // one bad utterance shouldn't jam the chain for the next one
        .then(() => {
          this.pending = Math.max(0, this.pending - 1);
          this.onStateChange && this.onStateChange(this.pending > 0);
        });
    },
    async _speakOne(text, kind) {
      if (this.cloudVoice) {
        try {
          await this._speakCloud(text, kind);
          return;
        } catch (err) {
          // server hiccup, rate limit, bad key, whatever, fall back rather than
          // go silent for this line. Reported server-side (not just console.log)
          // since a client-only log is invisible to anyone debugging this remotely.
          reportClientError('cloud speak failed, falling back to local: ' + (err && err.message));
        }
      }
      try {
        await this._speakLocal(text);
      } catch (err) {
        reportClientError('local speak failed too, this line went unheard: ' + (err && err.message));
      }
    },
    _speakCloud(text, kind) {
      const generation = this._generation;
      this._controller = new AbortController();
      const isStale = () => generation !== this._generation;
      return fetch('/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Fama-Token': window.__FAMA_TOKEN__ || '' },
        body: JSON.stringify({ text, kind, speed: this.rate }),
        signal: this._controller.signal,
      })
        .then((resp) => {
          if (isStale()) throw new Error('stopped, discarding stale response');
          if (!resp.ok) throw new Error('tts request failed: ' + resp.status);
          return resp.blob();
        })
        .then(
          (blob) =>
            new Promise((resolve, reject) => {
              if (isStale()) {
                reject(new Error('stopped, discarding stale response'));
                return;
              }
              const url = URL.createObjectURL(blob);
              const audio = this._audioEl || new Audio();
              this._audioEl = audio;
              audio.src = url;
              audio.onended = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              audio.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('audio playback failed'));
              };
              audio.play().catch(reject);
            })
        );
    },
    _speakLocal(text) {
      if (!this.supported) {
        reportClientError('local speechSynthesis unsupported in this browser/window');
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const utter = new SpeechSynthesisUtterance(text);
        if (this.voice) utter.voice = this.voice;
        utter.rate = this.rate;
        utter.onend = () => resolve();
        utter.onerror = (e) => reject(new Error('speechSynthesis error: ' + (e && e.error)));
        window.speechSynthesis.speak(utter);
      });
    },
    stop() {
      this.pending = 0;
      this._generation += 1; // any in-flight _speakCloud from before this point is now stale
      this._chain = Promise.resolve();
      if (this._controller) {
        this._controller.abort();
        this._controller = null;
      }
      if (this.supported) window.speechSynthesis.cancel();
      if (this._audioEl) {
        this._audioEl.pause();
        this._audioEl.removeAttribute('src'); // stops it from resuming/reloading the old blob on next play()
      }
      this.onStateChange && this.onStateChange(false);
    },
  };

  window.Narrator = Narrator;
})();
