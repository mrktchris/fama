'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadNarrator() {
  const spoken = [];
  let startSpeak;
  const speakStarted = new Promise((resolve) => (startSpeak = resolve));
  const speechSynthesis = {
    addEventListener() {},
    getVoices: () => [],
    speak: (utterance) => spoken.push(utterance.text),
    cancel() {},
  };
  class FakeAudio {
    play() {
      return Promise.resolve();
    }
    pause() {}
    removeAttribute() {}
  }
  class FakeUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const fetch = (url, options = {}) => {
    if (url === '/config') {
      return Promise.resolve({ json: () => Promise.resolve({ cloudVoice: true, model: 'gpt-4o-mini-tts' }) });
    }
    if (url === '/speak') {
      startSpeak();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
    return Promise.resolve({});
  };
  const storage = new Map();
  const window = {
    speechSynthesis,
    __FAMA_TOKEN__: 'test-token',
  };
  const context = {
    window,
    fetch,
    Audio: FakeAudio,
    SpeechSynthesisUtterance: FakeUtterance,
    AbortController,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'viewer', 'speech.js'), 'utf8'), context);
  return { Narrator: window.Narrator, spoken, speakStarted };
}

test('Narrator.stop aborts cloud work without falling back to stale local speech', async () => {
  const { Narrator, spoken, speakStarted } = loadNarrator();
  const narrator = new Narrator();
  await narrator.ready;
  narrator.enable();
  narrator.say('first line', 'text');
  narrator.say('queued line', 'text');
  await speakStarted;
  narrator.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(spoken.filter(Boolean), []);
  assert.equal(narrator.pending, 0);
});
