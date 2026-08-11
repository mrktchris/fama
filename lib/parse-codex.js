'use strict';

/**
 * Turns a raw Codex CLI transcript record (one line of a
 * ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl file) into zero or more
 * normalized narration events using the SAME kind vocabulary as
 * lib/parse.js's Claude Code parser (prompt/text/thinking/tool/result/error),
 * so the rest of Fama never has to know which provider an event came from.
 *
 * Format verified 2026-08-11 against real session files already on this
 * machine (not guessed/invented) — see FAMA-BIG-ROLLOUT-PLAN.md on the
 * Desktop for the full field-by-field notes. Still deliberately defensive:
 * Codex's transcript format isn't a public contract either, same posture as
 * lib/parse.js.
 *
 * Unlike Claude Code's transcript (where every line embeds its own
 * sessionId), Codex only states the session id once, in the session_meta
 * record. The caller (the file tailer wiring this up, see
 * FAMA-BIG-ROLLOUT-PLAN.md Section 2) is responsible for tracking that per
 * file and passing it in as context — this parser has no way to recover it
 * from an arbitrary mid-file line on its own.
 */

const TRUNCATE = 160;

function truncate(str, max = TRUNCATE) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// Codex's function_call arguments arrive as a JSON *string*, not an object
// (unlike Claude's tool_use.input, which is already parsed). Same
// best-effort summarization goal as lib/parse.js's summarizeToolInput,
// adapted for that extra parse step.
function summarizeToolArguments(argsJson) {
  let input;
  try {
    input = JSON.parse(argsJson);
  } catch {
    return truncate(String(argsJson || ''), 60);
  }
  if (!input || typeof input !== 'object') return '';
  if (input.file_path) return input.file_path;
  if (input.path) return input.path;
  if (input.command) return truncate(Array.isArray(input.command) ? input.command.join(' ') : String(input.command), 90);
  if (input.pattern) return input.pattern;
  if (input.url) return input.url;
  if (input.query) return input.query;
  const keys = Object.keys(input);
  if (!keys.length) return '';
  const k = keys[0];
  return `${k}: ${truncate(String(input[k]), 60)}`;
}

// Reasoning summaries are frequently NOT populated — confirmed against a
// real session where `summary` was an empty array and only opaque
// `encrypted_content` was present. Extracts text defensively from whatever
// shape summary items turn out to have (string, or {text}/{summary_text}),
// returns '' rather than throwing when there's nothing readable, so callers
// can just skip emitting a thinking event for that (common) case.
function textFromReasoningSummary(summary) {
  if (!Array.isArray(summary) || !summary.length) return '';
  return summary
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.text || item.summary_text || '';
      return '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

function eventsFromCodexRecord(record, context) {
  const events = [];
  if (!record || typeof record !== 'object') return events;
  const payload = record.payload;
  if (!payload || typeof payload !== 'object') return events;

  const sessionId = (context && context.sessionId) || payload.session_id || null;
  const base = { sessionId, ts: record.timestamp || null, provider: 'codex' };

  if (record.type === 'event_msg') {
    switch (payload.type) {
      case 'user_message':
        if (payload.message && String(payload.message).trim()) {
          events.push({ ...base, kind: 'prompt', label: 'you', detail: String(payload.message).trim(), uuid: payload.turn_id || null });
        }
        break;
      case 'agent_message':
        if (payload.message && String(payload.message).trim()) {
          events.push({ ...base, kind: 'text', label: 'codex', detail: String(payload.message).trim(), uuid: payload.turn_id || null });
        }
        break;
      case 'task_complete':
        // last_agent_message duplicates whatever the final agent_message
        // event already said, only surfaced here as a distinct "done"
        // marker (matches Claude's tool_result -> kind:'result' pattern),
        // not re-narrated in full to avoid saying the same line twice.
        events.push({ ...base, kind: 'result', label: 'done', detail: 'task complete', uuid: payload.turn_id || null });
        break;
      default:
        break; // task_started, token_count, web_search_end, etc: not narration-worthy on their own
    }
    return events;
  }

  if (record.type === 'response_item') {
    switch (payload.type) {
      case 'reasoning': {
        const text = textFromReasoningSummary(payload.summary);
        if (text) {
          events.push({ ...base, kind: 'thinking', label: 'thinking', detail: truncate(text, 220), full: truncate(text, 4000), uuid: payload.id || null });
        }
        // else: reasoning happened but Codex didn't expose a readable
        // summary for it (the common case) — nothing to show, not an error.
        break;
      }
      case 'function_call':
        events.push({
          ...base,
          kind: 'tool',
          label: payload.name || 'tool',
          detail: summarizeToolArguments(payload.arguments),
          uuid: payload.call_id || payload.id || null,
        });
        break;
      case 'function_call_output': {
        // No explicit is_error flag in this format (unlike Claude's
        // tool_result.is_error) — always surfaced as a plain result. A
        // reliable failure signal would need real examples of a failed
        // call to confirm the shape first (see plan doc, Section 8 note).
        const text = truncate(typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output || ''));
        events.push({ ...base, kind: 'result', label: 'done', detail: text, uuid: payload.call_id || null });
        break;
      }
      case 'message':
        // Deliberately skipped: role:'developer' is Codex's system-prompt
        // boilerplate (huge, not narration), role:'user' duplicates
        // event_msg:user_message above, role:'assistant' duplicates
        // event_msg:agent_message above. Handling only the event_msg copies
        // avoids double-narrating the same content through two paths.
        break;
      default:
        break; // tool_search_call/output, web_search_call: not mapped yet, ignored rather than guessed at
    }
    return events;
  }

  return events; // session_meta, turn_context: structural, not narration events
}

module.exports = { eventsFromCodexRecord, summarizeToolArguments, textFromReasoningSummary };
