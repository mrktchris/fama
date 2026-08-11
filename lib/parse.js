'use strict';

/**
 * Turns a raw Claude Code transcript record (one line of the session .jsonl)
 * into zero or more normalized narration events. Deliberately defensive:
 * the transcript format isn't a public contract, so every field access
 * assumes the shape might be missing or different than expected.
 */

const TRUNCATE = 160;

function truncate(str, max = TRUNCATE) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return '';
  if (input.file_path) return input.file_path;
  if (input.path) return input.path;
  if (input.command) return truncate(input.command, 90);
  if (input.pattern) return input.pattern;
  if (input.url) return input.url;
  if (input.prompt) return truncate(input.prompt, 90);
  if (input.query) return input.query;
  const keys = Object.keys(input);
  if (!keys.length) return '';
  const k = keys[0];
  return `${k}: ${truncate(String(input[k]), 60)}`;
}

function textFromToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && c.type === 'text' ? c.text : '')).join(' ');
  }
  return '';
}

// Pulls the actual displayable bytes out of an image content block. Only
// base64-inline images carry data we can show directly (a data: URI); a
// 'url' source is passed through as-is, everything else is dropped rather
// than guessed at.
// Base64 image data lives in server.js's 300-event in-memory backlog (see
// broadcast()) for as long as it takes to roll off the end, and every image
// event carries a full copy to every connected client. Uncapped, a handful
// of multi-megabyte screenshots would multiply that fast: this is a real
// memory/bandwidth ceiling, not a hypothetical one, found while reviewing
// the image feature right after shipping it, not caught up front. A
// thumbnail-sized cap is plenty for "see what it saw at a glance"; anything
// bigger degrades to a labeled placeholder instead of blowing up the backlog.
const MAX_IMAGE_BASE64_CHARS = 1_500_000; // ~1.1MB raw, comfortably thumbnail-sized

function mediaFromImageBlock(block) {
  const source = block && block.source;
  if (!source) return null;
  if (source.type === 'base64' && source.data) {
    if (source.data.length > MAX_IMAGE_BASE64_CHARS) return { tooLarge: true };
    return { mediaType: source.media_type || 'image/png', data: source.data };
  }
  if (source.type === 'url' && source.url) {
    return { url: source.url };
  }
  return null;
}

function imagesFromToolResultContent(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((c) => c && c.type === 'image')
    .map(mediaFromImageBlock)
    .filter(Boolean);
}

function eventsFromRecord(record) {
  const events = [];
  if (!record || typeof record !== 'object') return events;
  if (record.type !== 'user' && record.type !== 'assistant') return events;

  const msg = record.message;
  if (!msg || msg.content == null) return events;

  const base = {
    sessionId: record.sessionId || null,
    ts: record.timestamp || null,
    uuid: record.uuid || null,
  };

  if (typeof msg.content === 'string') {
    if (record.type === 'user' && msg.content.trim()) {
      events.push({ ...base, kind: 'prompt', label: 'you', detail: msg.content.trim() });
    }
    return events;
  }

  if (!Array.isArray(msg.content)) return events;

  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case 'text':
        if (record.type === 'assistant' && block.text && block.text.trim()) {
          events.push({ ...base, kind: 'text', label: 'claude', detail: block.text.trim() });
        }
        break;
      case 'thinking':
        if (block.thinking && block.thinking.trim()) {
          // Found by external audit, confirmed real: `detail` (220 chars) is
          // what the lane feed displays, but it was also the ONLY copy of
          // this text that existed anywhere downstream, so the server-side
          // rewrite step (whose whole job is condensing long raw reasoning)
          // only ever saw an already-truncated 220-char fragment, often
          // cut off mid-sentence, for any thinking block longer than that.
          // `full` carries the real text through to speech, capped only by
          // a sanity ceiling far above what any spoken line needs, not by
          // the display width.
          const fullText = block.thinking.trim();
          events.push({ ...base, kind: 'thinking', label: 'thinking', detail: truncate(fullText, 220), full: truncate(fullText, 4000) });
        }
        break;
      case 'tool_use':
        events.push({
          ...base,
          kind: 'tool',
          label: block.name || 'tool',
          detail: summarizeToolInput(block.input),
        });
        break;
      case 'tool_result': {
        const isError = !!block.is_error;
        const text = truncate(textFromToolResultContent(block.content).trim());
        events.push({ ...base, kind: isError ? 'error' : 'result', label: isError ? 'error' : 'done', detail: text });
        // A tool result (e.g. Read on an image file, a screenshot tool) can
        // carry actual images alongside its text. Previously these were
        // silently dropped by textFromToolResultContent, which only ever
        // looked at 'text' blocks — surfaced as separate image events so
        // the feed shows the real picture instead of just its caption.
        for (const media of imagesFromToolResultContent(block.content)) {
          events.push({ ...base, kind: 'image', label: 'image', detail: '[image]', media });
        }
        break;
      }
      case 'image': {
        const media = mediaFromImageBlock(block);
        events.push({ ...base, kind: 'image', label: 'image', detail: '[image]', media });
        break;
      }
      default:
        break; // unknown block type, ignore rather than guess
    }
  }
  return events;
}

module.exports = { eventsFromRecord };
