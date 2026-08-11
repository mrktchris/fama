# ADR 0001: Deep runtime Modules behind explicit Interfaces

- Status: Accepted
- Date: 2026-08-11

## Context

`server.js` and `desktop/main.js` accumulated several unrelated lifecycle and
policy responsibilities. The behavior was tested end to end, but changes to
project selection, transcript ingest, cloud speech, or Electron lifecycle had
large blast radii and depended on parallel arrays or mutable implementation
state.

## Decision

Keep one deployable application and deepen five internal Modules:

1. Selected Projects owns the canonical project record and environment/config
   migration.
2. Live Activity Ingest owns discovery, live-only tailers, provider Adapter
   invocation, bounded replay, and SSE subscribers.
3. Cloud Narration owns cloud settings, redaction, rewrite/TTS policy, and
   usage accounting.
4. Narrator exposes speech intents and state snapshots to browser callers.
5. Desktop Runtime composes configuration, server/update lifecycle, window
   policy, and Electron IPC without duplicating domain behavior.

The entry points remain composition roots. Compatibility reads for legacy
project config/environment shapes remain until a later migration can remove
them safely.

## Consequences

- Each Module can be tested without starting the whole desktop application.
- Selected Project identity is stable across ordering changes.
- Provider and Electron details sit behind Adapters at explicit seams.
- The application remains a single-context, single-process server plus its
  Electron shell; this is modularization, not a distributed-system split.
