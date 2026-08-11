'use strict';

const VALID_PERSONAS = new Set(['max', 'reese', 'sam', 'jordan', 'kai', 'vera', 'christian']);
const VALID_STATUS = new Set(['working', 'watching', 'testing', 'ready', 'blocked', 'idle', 'reviewing']);

function safeText(value, maximum) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text || text.length > maximum) return null;
  return text;
}

function eventsFromBuzzHeartbeat(record) {
  if (!record || record.type !== 'agent_heartbeat') return [];
  const persona = safeText(record.persona, 32);
  const code = safeText(record.code, 32);
  const detail = safeText(record.client_summary, 240);
  const status = safeText(record.status, 32);
  const timestamp = safeText(record.timestamp, 64);
  const traceId = record.trace_id == null ? null : safeText(record.trace_id, 128);
  if (!VALID_PERSONAS.has(persona) || !VALID_STATUS.has(status) || !code || !detail || !timestamp) return [];
  if (Number.isNaN(Date.parse(timestamp))) return [];
  if (record.trace_id != null && !traceId) return [];

  return [{
    sessionId: `buzz-frac7-${persona}`,
    ts: timestamp,
    provider: 'buzz',
    kind: 'agent_heartbeat',
    label: `${persona} · ${code}`,
    detail,
    status,
    agent: persona,
    uuid: traceId,
  }];
}

module.exports = { eventsFromBuzzHeartbeat, safeText };
