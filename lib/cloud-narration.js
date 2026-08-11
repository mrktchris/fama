'use strict';

const fs = require('node:fs');
const { redactSensitiveText } = require('./redact');
const { voiceStyleInstructions } = require('./voice-style');

const NARRATION_MIN_SECONDS = 3;
const NARRATION_MAX_SECONDS = 30;
const MAX_SPEECH_CHARS = 900;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_MODELS = new Set(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']);
const REWRITE_MODELS = new Set(['gpt-4o-mini']);
// Checked against OpenAI's official model pages on 2026-08-11. tts-1 and
// tts-1-hd are billed per character. gpt-4o-mini-tts is active and billed in
// text/audio tokens, so its per-character value is necessarily an estimate.
const PRICING = Object.freeze({
  checkedAt: '2026-08-11',
  estimatedTtsPerChar: Object.freeze({
    'tts-1': 0.000015,
    'tts-1-hd': 0.00003,
    'gpt-4o-mini-tts': 0.000012,
  }),
  rewritePerToken: Object.freeze({ prompt: 0.00000015, completion: 0.0000006 }),
});

function envBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function clampNarrationSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return 10;
  return Math.min(NARRATION_MAX_SECONDS, Math.max(NARRATION_MIN_SECONDS, Math.round(n)));
}

function narrationPreset(seconds) {
  const normalized = clampNarrationSeconds(seconds);
  const words = Math.max(6, Math.round(normalized * 2.5));
  return { seconds: normalized, words, maxTokens: Math.round(words * 4) + 40 };
}

function clampSpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

function noNewlines(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

function normalizeModel(value, allowed, fallback) {
  const model = noNewlines(value);
  return allowed.has(model) ? model : fallback;
}

function loadEnvFile(filePath, fsImpl = fs) {
  let content;
  try {
    content = fsImpl.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  const values = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function defaultUsage(now) {
  return { totalCost: 0, ttsCalls: 0, ttsChars: 0, rewriteCalls: 0, rewriteTokens: 0, since: now().toISOString() };
}

class CloudNarrationError extends Error {
  constructor(message, status, publicMessage, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CloudNarrationError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

class CloudNarration {
  constructor(options) {
    this.envPath = options.envPath;
    this.usagePath = options.usagePath;
    this._env = options.env || process.env;
    this._fs = options.fs || fs;
    this._fetch = options.fetch || global.fetch;
    this._now = options.now || (() => new Date());
    this._timeout = options.timeout || ((milliseconds) => AbortSignal.timeout(milliseconds));
    const saved = loadEnvFile(this.envPath, this._fs);
    this._config = {
      apiKey: saved.OPENAI_API_KEY || this._env.OPENAI_API_KEY || '',
      model: normalizeModel(saved.OPENAI_TTS_MODEL || this._env.OPENAI_TTS_MODEL, TTS_MODELS, DEFAULT_TTS_MODEL),
      voice: saved.OPENAI_TTS_VOICE || this._env.OPENAI_TTS_VOICE || 'alloy',
      rewriteModel: normalizeModel(saved.OPENAI_REWRITE_MODEL || this._env.OPENAI_REWRITE_MODEL, REWRITE_MODELS, 'gpt-4o-mini'),
      rewrite: envBool(saved.OPENAI_NARRATE_REWRITE || this._env.OPENAI_NARRATE_REWRITE, true),
      narrationSeconds: clampNarrationSeconds(saved.OPENAI_NARRATION_SECONDS || this._env.OPENAI_NARRATION_SECONDS || 10),
      narrationPersona: saved.OPENAI_NARRATION_PERSONA || this._env.OPENAI_NARRATION_PERSONA || '',
      voiceStyle: saved.OPENAI_VOICE_STYLE || this._env.OPENAI_VOICE_STYLE || '',
    };
    this._usage = this._loadUsage();
  }

  publicConfig() {
    const config = this._config;
    return Object.freeze({
      cloudVoice: Boolean(config.apiKey),
      model: config.model,
      voice: config.voice,
      rewrite: config.rewrite,
      rewriteModel: config.rewriteModel,
      narrationSeconds: config.narrationSeconds,
      narrationMin: NARRATION_MIN_SECONDS,
      narrationMax: NARRATION_MAX_SECONDS,
      narrationPersona: config.narrationPersona,
      voiceStyle: config.voiceStyle,
      voiceStyleSupported: config.model === 'gpt-4o-mini-tts',
      pricing: {
        checkedAt: PRICING.checkedAt,
        estimatedTtsPerChar: { ...PRICING.estimatedTtsPerChar },
      },
    });
  }

  usage() {
    return Object.freeze({ ...this._usage });
  }

  resetUsage() {
    this._usage = defaultUsage(this._now);
    this._saveUsage();
    return this.usage();
  }

  updateSettings(body) {
    const current = this._config;
    const typedKey = typeof body.apiKey === 'string' ? noNewlines(body.apiKey) : '';
    const nextText = (key) => (typeof body[key] === 'string' && body[key].trim() ? noNewlines(body[key]) : current[key]);
    this._config = {
      apiKey: body.clearKey === true ? '' : typedKey || current.apiKey,
      model: normalizeModel(nextText('model'), TTS_MODELS, current.model),
      voice: nextText('voice'),
      rewriteModel: normalizeModel(nextText('rewriteModel'), REWRITE_MODELS, current.rewriteModel),
      rewrite: typeof body.rewrite === 'boolean' ? body.rewrite : current.rewrite,
      narrationSeconds:
        body.narrationSeconds !== undefined ? clampNarrationSeconds(body.narrationSeconds) : current.narrationSeconds,
      narrationPersona:
        typeof body.narrationPersona === 'string' ? noNewlines(body.narrationPersona).slice(0, 500) : current.narrationPersona,
      voiceStyle: typeof body.voiceStyle === 'string' ? noNewlines(body.voiceStyle).slice(0, 500) : current.voiceStyle,
    };
    this._saveConfig();
    return this.publicConfig();
  }

  async speak(input) {
    const rawText = redactSensitiveText(input && input.text ? String(input.text) : '').slice(0, MAX_SPEECH_CHARS);
    const kind = input && ['thinking', 'text', 'tool'].includes(input.kind) ? input.kind : 'text';
    const speed = clampSpeed(input && input.speed);
    if (!rawText) throw new CloudNarrationError('no text', 400, 'no text');
    if (!this._config.apiKey) {
      throw new CloudNarrationError('no API key configured', 501, 'no OpenAI key configured, use the free browser voice instead');
    }

    let spokenText = rawText;
    let rewriteUsage = null;
    const alreadyShort = rawText.trim().split(/\s+/).length <= narrationPreset(this._config.narrationSeconds).words;
    const shouldRewrite = this._config.rewrite && (kind === 'thinking' || kind === 'text') && !alreadyShort;
    if (shouldRewrite) {
      try {
        const rewritten = await this._rewrite(rawText, kind);
        if (rewritten.text) spokenText = redactSensitiveText(rewritten.text).slice(0, MAX_SPEECH_CHARS);
        rewriteUsage = rewritten;
      } catch {
        // Rewrite is an enhancement. Provider failure falls back to redacted
        // source text so one network hop never drops Live Activity audio.
      }
    }

    try {
      const audio = await this._synthesize(spokenText, speed);
      this._recordUsage({
        ttsChars: spokenText.length,
        ttsModel: this._config.model,
        rewritePromptTokens: rewriteUsage ? rewriteUsage.promptTokens : 0,
        rewriteCompletionTokens: rewriteUsage ? rewriteUsage.completionTokens : 0,
      });
      return Object.freeze({
        audio,
        spokenText,
        kind,
        speed,
        model: this._config.model,
        narrationSeconds: this._config.narrationSeconds,
      });
    } catch (error) {
      throw new CloudNarrationError('speech synthesis failed', 502, 'speech synthesis failed, see server log for detail', error);
    }
  }

  providerErrorMessage(error) {
    const cause = error && error.cause ? error.cause : error;
    let message = redactSensitiveText(String((cause && cause.message) || cause || 'unknown provider error'));
    if (this._config.apiKey) message = message.split(this._config.apiKey).join('[redacted credential]');
    return message.replace(/[\r\n]+/g, ' ').slice(0, 300);
  }

  describe() {
    const config = this._config;
    return config.apiKey
      ? `OpenAI (${config.model}, ${config.voice}), rewrite ${config.rewrite ? `on (~${config.narrationSeconds}s)` : 'off'}`
      : 'free browser voice (no key configured)';
  }

  async _rewrite(text, kind) {
    const context =
      kind === 'thinking'
        ? 'This is raw internal reasoning, often fragmented or rambling as it is being worked out.'
        : 'This is already meant to be read by a person, just make it work as spoken audio.';
    const preset = narrationPreset(this._config.narrationSeconds);
    const personaLine = this._config.narrationPersona
      ? `Voice/persona for this rewrite: ${this._config.narrationPersona}. Stay in that voice, but the length limit below is non-negotiable regardless of persona. `
      : '';
    const response = await this._fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this._config.rewriteModel,
        messages: [
          {
            role: 'system',
            content:
              "You narrate a coding agent's live activity out loud, in real time, for someone half-listening while they work on something else. " +
              personaLine +
              `HARD LIMIT: ${preset.words} words maximum, count them as you write and stop at the limit even mid-thought. ` +
              'Present tense, natural spoken sentences. Never start with a filler opener. No code, file paths, markdown, or meta-commentary. Reply with only the rewritten line.',
          },
          { role: 'user', content: `${context}\n\nRewrite this in ${preset.words} words or fewer:\n\n${text}` },
        ],
        max_tokens: preset.maxTokens,
        temperature: 0.2,
      }),
      signal: this._timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI rewrite ${response.status}: ${body.slice(0, 200)}`);
    }
    const data = await response.json();
    const output = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return {
      text: (output || '').trim(),
      promptTokens: (data.usage && data.usage.prompt_tokens) || 0,
      completionTokens: (data.usage && data.usage.completion_tokens) || 0,
    };
  }

  async _synthesize(text, speed) {
    const payload = { model: this._config.model, voice: this._config.voice, input: text, response_format: 'mp3', speed };
    if (this._config.voiceStyle && this._config.model === 'gpt-4o-mini-tts') {
      payload.instructions = voiceStyleInstructions(this._config.voiceStyle);
    }
    const response = await this._fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this._config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: this._timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI TTS ${response.status}: ${body.slice(0, 200)}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  _saveConfig() {
    const clean = (value) => noNewlines(value);
    const config = this._config;
    const content = [
      '# Written by the Fama Settings panel (the gear icon in the app).',
      '# Hand edits are fine, but hitting Save there rewrites these lines.',
      '',
      `OPENAI_API_KEY=${clean(config.apiKey)}`,
      `OPENAI_TTS_MODEL=${clean(config.model)}`,
      `OPENAI_TTS_VOICE=${clean(config.voice)}`,
      `OPENAI_REWRITE_MODEL=${clean(config.rewriteModel)}`,
      `OPENAI_NARRATE_REWRITE=${config.rewrite ? 'true' : 'false'}`,
      `OPENAI_NARRATION_SECONDS=${config.narrationSeconds}`,
      `OPENAI_NARRATION_PERSONA=${clean(config.narrationPersona)}`,
      `OPENAI_VOICE_STYLE=${clean(config.voiceStyle)}`,
      '',
    ].join('\n');
    this._fs.writeFileSync(this.envPath, content, { encoding: 'utf8', mode: 0o600 });
    try {
      this._fs.chmodSync(this.envPath, 0o600);
    } catch {
      // Windows applies the per-user directory ACL.
    }
  }

  _loadUsage() {
    try {
      const parsed = JSON.parse(this._fs.readFileSync(this.usagePath, 'utf8'));
      return Object.assign(defaultUsage(this._now), parsed);
    } catch {
      return defaultUsage(this._now);
    }
  }

  _saveUsage() {
    try {
      this._fs.writeFileSync(this.usagePath, JSON.stringify(this._usage, null, 2), 'utf8');
    } catch {
      // Usage estimates are best-effort and must never break narration.
    }
  }

  _recordUsage({ ttsChars, ttsModel, rewritePromptTokens, rewriteCompletionTokens }) {
    const ttsPrice = PRICING.estimatedTtsPerChar[ttsModel] || PRICING.estimatedTtsPerChar[DEFAULT_TTS_MODEL];
    let cost = (ttsChars || 0) * ttsPrice;
    this._usage.ttsCalls += 1;
    this._usage.ttsChars += ttsChars || 0;
    if (rewritePromptTokens || rewriteCompletionTokens) {
      cost +=
        (rewritePromptTokens || 0) * PRICING.rewritePerToken.prompt +
        (rewriteCompletionTokens || 0) * PRICING.rewritePerToken.completion;
      this._usage.rewriteCalls += 1;
      this._usage.rewriteTokens += (rewritePromptTokens || 0) + (rewriteCompletionTokens || 0);
    }
    this._usage.totalCost += cost;
    this._saveUsage();
  }
}

module.exports = {
  CloudNarration,
  CloudNarrationError,
  clampNarrationSeconds,
  clampSpeed,
  loadEnvFile,
  narrationPreset,
};
