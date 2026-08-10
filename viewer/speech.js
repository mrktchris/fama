'use strict';

// Thin wrapper around the browser's built-in Web Speech API. Free, local,
// zero API key, zero token cost, this is the whole reason the project can
// promise "no API dependency" and still talk.

(function () {
  const STORAGE_KEY = 'claude-narrator.voice';
  const MAX_PENDING = 4; // hard cap so a burst of events can't build an ever-growing backlog

  function Narrator() {
    this.enabled = false;
    this.voice = null;
    this.rate = 1;
    this.pending = 0;
    this.onStateChange = null; // callback(isSpeaking: boolean)
    if (this.supported) {
      window.speechSynthesis.addEventListener('voiceschanged', () => this._restoreVoice());
      this._restoreVoice();
    }
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
    enable() {
      if (!this.supported) return false;
      // Browsers refuse programmatic speech until a real user gesture has
      // unlocked audio once. Speaking an empty utterance inside this click
      // handler satisfies that and unlocks every say() call after it.
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
      this.enabled = true;
      return true;
    },
    disable() {
      this.enabled = false;
      this.stop();
    },
    say(text) {
      if (!this.enabled || !this.supported || !text) return;
      if (this.pending >= MAX_PENDING) return; // drop, this is a live feed, not a transcript to catch up on
      const utter = new SpeechSynthesisUtterance(text);
      if (this.voice) utter.voice = this.voice;
      utter.rate = this.rate;
      this.pending += 1;
      utter.onstart = () => this.onStateChange && this.onStateChange(true);
      utter.onend = utter.onerror = () => {
        this.pending = Math.max(0, this.pending - 1);
        this.onStateChange && this.onStateChange(this.pending > 0);
      };
      window.speechSynthesis.speak(utter);
    },
    stop() {
      this.pending = 0;
      if (this.supported) window.speechSynthesis.cancel();
      this.onStateChange && this.onStateChange(false);
    },
  };

  window.Narrator = Narrator;
})();
