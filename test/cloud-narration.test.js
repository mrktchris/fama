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
  assert.equal(config.model, 'gpt-4o-mini-tts');
  assert.equal('modelDeprecated' in config, false);
  assert.equal(config.pricing.checkedAt, '2026-08-11');
  assert.equal(config.pricing.estimatedTtsPerChar['tts-1'], 0.000015);
  assert.deepEqual(config.models.map((model) => model.id), ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']);
  assert.equal(config.models.find((model) => model.id === 'gpt-4o-mini-tts').voiceStyleSupported, true);
  assert.deepEqual(config.voices, ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
  assert.deepEqual(config.narrationEstimate, { wordsPerSecond: 2.5, charactersPerWord: 5.5, minWords: 6 });
});

test('Cloud Narration owns the pricing estimate and rejects unsupported provider models', async (t) => {
  const cloud = fixture(t, async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from([1]).buffer }));
  const config = cloud.updateSettings({ model: 'made-up-expensive-model', rewriteModel: 'unknown-rewriter', rewrite: false });
  assert.equal(config.model, 'gpt-4o-mini-tts');
  assert.equal(config.rewriteModel, 'gpt-4o-mini');

  cloud.updateSettings({ model: 'tts-1', rewrite: false });
  await cloud.speak({ text: 'four', kind: 'text' });
  assert.equal(cloud.usage().totalCost, 4 * 0.000015);
});

test('Cloud Narration is the browser catalog source of truth', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'index.html'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '..', 'viewer', 'settings.js'), 'utf8');
  assert.equal(html.includes('option value="gpt-4o-mini-tts"'), false);
  assert.match(settings, /populateSelect\(modelSelect, models, cfg\.model\)/);
  assert.equal(settings.includes("modelSelect.value === 'gpt-4o-mini-tts'"), false);
  assert.equal(settings.includes('wordsPerSecond: 2.5'), false);
});

test('Cloud Narration returns a typed local fallback error when no key is configured', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fama-cloud-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cloud = new CloudNarration({ envPath: path.join(root, '.env'), usagePath: path.join(root, 'usage.json'), env: {} });
  assert.equal(cloud.publicConfig().model, 'gpt-4o-mini-tts');
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
