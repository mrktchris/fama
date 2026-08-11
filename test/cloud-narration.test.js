'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CloudNarration, CloudNarrationError } = require('../lib/cloud-narration');

function fixture(t, fetch) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-cloud-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const envPath = path.join(root, '.env');
  fs.writeFileSync(envPath, 'OPENAI_API_KEY=sk-test\nOPENAI_TTS_MODEL=gpt-4o-mini-tts\nOPENAI_NARRATION_SECONDS=3\n', 'utf8');
  return new CloudNarration({
    envPath,
    usagePath: path.join(root, 'usage.json'),
    env: {},
    fetch,
    timeout: () => undefined,
    now: () => new Date('2026-08-11T00:00:00Z'),
  });
}

test('Cloud Narration owns rewrite, synthesis, redaction, and usage accounting', async (t) => {
  const requests = [];
  const cloud = fixture(t, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/chat/completions')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'A safe short line.' } }], usage: { prompt_tokens: 8, completion_tokens: 4 } }),
      };
    }
    return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  });

  const result = await cloud.speak({
    text: 'The key is sk-abcdefghijklmnopqrstuvwxyz1234567890 and this sentence contains enough extra words to require a rewrite call.',
    kind: 'thinking',
    speed: 9,
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.messages[1].content.includes('sk-abcdefghijklmnopqrstuvwxyz1234567890'), false);
  assert.equal(requests[1].body.input, 'A safe short line.');
  assert.equal(requests[1].body.speed, 2);
  assert.deepEqual([...result.audio], [1, 2, 3]);
  assert.equal(cloud.usage().ttsCalls, 1);
  assert.equal(cloud.usage().rewriteCalls, 1);
});

test('Cloud Narration settings sanitize persisted lines and never expose the key', (t) => {
  const cloud = fixture(t, async () => assert.fail('provider should not be called'));
  const config = cloud.updateSettings({ apiKey: 'sk-new\nOPENAI_TTS_MODEL=evil', model: 'tts-1\nOPENAI_API_KEY=injected' });
  const saved = fs.readFileSync(cloud.envPath, 'utf8');
  assert.equal('apiKey' in config, false);
  assert.equal(config.cloudVoice, true);
  assert.equal(saved.match(/^OPENAI_API_KEY=/gm).length, 1);
  assert.equal(saved.match(/^OPENAI_TTS_MODEL=/gm).length, 1);
});

test('Cloud Narration returns a typed local fallback error when no key is configured', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-cloud-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cloud = new CloudNarration({ envPath: path.join(root, '.env'), usagePath: path.join(root, 'usage.json'), env: {} });
  await assert.rejects(cloud.speak({ text: 'hello' }), (error) => error instanceof CloudNarrationError && error.status === 501);
});

test('Cloud Narration skips pointless rewrites and falls back to source text when rewrite fails', async (t) => {
  const requests = [];
  const cloud = fixture(t, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/chat/completions')) return { ok: false, status: 429, text: async () => 'busy' };
    return { ok: true, arrayBuffer: async () => Uint8Array.from([4]).buffer };
  });

  await cloud.speak({ text: 'short line', kind: 'text' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.endsWith('/audio/speech'), true);

  requests.length = 0;
  const longText = 'This source sentence has enough words to require the optional rewrite step and still remain safe when that provider fails.';
  const result = await cloud.speak({ text: longText, kind: 'thinking' });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.input, longText);
  assert.equal(result.spokenText, longText);
});
