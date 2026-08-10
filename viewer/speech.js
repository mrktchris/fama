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
  const STORAGE_KEY = 'claude-narrator.voice';
  const MAX_PENDING = 4; // hard cap so a burst of events can't build an ever-growing backlog

  function Narrator() {
    this.enabled = false;
    this.voice = null; // local speechSynthesis voice choice
    this.rate = 1;
    this.pending = 0;
    this.onStateChange = null; // callback(isSpeaking: boolean)
    this.cloudVoice = false;
    this._chain = Promise.resolve();
    this._audioEl = null;

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
      const saved = localStorage.getItem(STORAGE_KEY);
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
          // go silent for this line
        }
      }
      await this._speakLocal(text);
    },
    _speakCloud(text, kind) {
      return fetch('/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind, speed: this.rate }),
      })
        .then((resp) => {
          if (!resp.ok) throw new Error('tts request failed: ' + resp.status);
          return resp.blob();
        })
        .then(
          (blob) =>
            new Promise((resolve, reject) => {
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
      if (!this.supported) return Promise.resolve();
      return new Promise((resolve) => {
        const utter = new SpeechSynthesisUtterance(text);
        if (this.voice) utter.voice = this.voice;
        utter.rate = this.rate;
        utter.onend = utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    },
    stop() {
      this.pending = 0;
      this._chain = Promise.resolve();
      if (this.supported) window.speechSynthesis.cancel();
      if (this._audioEl) this._audioEl.pause();
      this.onStateChange && this.onStateChange(false);
    },
  };

  window.Narrator = Narrator;
})();
