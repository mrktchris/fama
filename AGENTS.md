# Fama agent guidance

Fama is a local-first desktop observer and narrator for coding-agent activity.
Preserve user privacy, provider attribution, live-only transcript semantics,
and the packaged-app secret scan whenever changing the system.

The current cross-agent audit and handoff record is
`docs/AUDIT-2026-08-11.md`. Update it when follow-up work changes a finding,
verification result, or architectural recommendation.

Cloud provider model names and price estimates belong to
`lib/cloud-narration.js`. The viewer consumes that Interface instead of
duplicating provider constants. Recheck official OpenAI model and pricing pages
before changing defaults, availability labels, or estimates. As of 2026-08-11,
the official `gpt-4o-mini-tts` page lists it as active and "Default."

Desktop updates are opt-in twice: once before download and once before
restart/install. A tagged release must pass tests, audits, packaging, and the
packaged-artifact secret scan before publication.

The source server supports Node 18+. Electron development and packaging use
Node 22.12+; the packaged app starts the server with Electron's bundled Node
runtime and must not depend on a separate `node.exe` from `PATH`.

## Agent skills

### Issue tracker

Issues and PRDs live in GitHub Issues for `mrktchris/fama`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage roles documented for this repository. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read root `CONTEXT.md` when present and relevant decisions under `docs/adr/`. See `docs/agents/domain.md`.
