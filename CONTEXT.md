# Fama domain context

Fama observes live coding-agent activity and optionally narrates it. It is
local-first: transcript discovery, normalization, selection, and browser
delivery stay on the machine. Cloud Narration is an explicit optional Adapter.

## Glossary

- **Selected Project**: a canonical project record with a stable `id`, Claude
  transcript `dir`, real `cwd`, and user-facing `name`. All providers are
  filtered through this record before their activity can enter the feed.
- **Live Activity**: normalized events appended after Fama starts observing a
  Session. Existing transcript history is never replayed.
- **Live Activity Ingest**: the Module that discovers active Sessions, owns
  their tailers, invokes provider Adapters, and publishes Live Activity.
- **Provider Adapter**: a parser that converts a provider transcript or
  sanitized heartbeat record into Fama's normalized Live Activity event
  shape. Claude, Codex, and the optional selected-project BUZZ heartbeat file
  are the current providers.
- **Cloud Narration**: the optional Module that owns narration settings,
  redaction, rewrite policy, speech synthesis, and local usage estimates.
- **Narrator**: the browser Module that serializes speech intents, selects the
  local or Cloud Narration Adapter, drops stale work, and reports its state.
- **Messages View**: the conversation-first projection of Live Activity. It
  shows prompts and agent replies as dialogue and keeps reasoning/tool/result
  events available through expandable disclosures.
- **Activity View**: the compact operator projection of the same Live Activity
  records. Switching views never changes ingest, retention, or narration.
- **Desktop Runtime**: the Electron composition Module that owns per-user
  configuration, child-server and update lifecycle, secure windows, and IPC
  wiring.
- **Desktop Notifications**: the Desktop Runtime Module that turns Live
  Activity errors and meaningful Session-idle transitions into bounded native
  notifications. It owns per-Session debounce timers and the global idle
  cooldown; Electron notification delivery is its Adapter.
- **Session**: one provider transcript with a stable session identity.

## Invariants

- Live Activity is live-only; attaching a tailer starts at end-of-file.
- Activity from an unselected project never enters the feed.
- A BUZZ heartbeat is observed only from a selected project's
  `.fama/agent-heartbeats.jsonl`; Fama starts at EOF and never reads BUZZ keys,
  messages, private memory, or client identifiers.
- Provider attribution and Selected Project identity survive normalization.
- A raw API key never crosses the server/browser Interface or enters a package.
- Desktop Runtime uses Electron's bundled Node runtime for the local server.
- Renderer code uses explicit IPC and Narrator Interfaces, not Node access or
  mutable implementation state.
- Messages and Activity are live-only projections of one event record; neither
  view may fetch or replay transcript history that predates observation.
