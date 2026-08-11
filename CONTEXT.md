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
- **Provider Adapter**: a parser that converts a provider transcript record
  into Fama's normalized Live Activity event shape. Claude and Codex are the
  current providers.
- **Cloud Narration**: the optional Module that owns narration settings,
  redaction, rewrite policy, speech synthesis, and local usage estimates.
- **Narrator**: the browser Module that serializes speech intents, selects the
  local or Cloud Narration Adapter, drops stale work, and reports its state.
- **Desktop Runtime**: the Electron composition Module that owns per-user
  configuration, child-server and update lifecycle, secure windows, and IPC
  wiring.
- **Session**: one provider transcript with a stable session identity.

## Invariants

- Live Activity is live-only; attaching a tailer starts at end-of-file.
- Activity from an unselected project never enters the feed.
- Provider attribution and Selected Project identity survive normalization.
- A raw API key never crosses the server/browser Interface or enters a package.
- Desktop Runtime uses Electron's bundled Node runtime for the local server.
- Renderer code uses explicit IPC and Narrator Interfaces, not Node access or
  mutable implementation state.
