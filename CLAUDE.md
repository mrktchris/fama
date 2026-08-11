# Fama Claude guidance

Before changing this repository, read `AGENTS.md`, `CONTEXT.md`, and
`docs/AUDIT-2026-08-11.md`. `AGENTS.md` is the shared operating policy for
Claude and Codex; do not create a competing set of project rules.

Use `docs/AUDIT-2026-08-11.md` as the durable cross-agent handoff. After any
material code, security, architecture, delivery, or verification change,
update that record with the commit or release state and the evidence you
actually observed. Read `git status` first and preserve changes belonging to
the maintainer or another agent.

Fama may display and narrate both Claude and Codex transcript events, but it
does not expose either agent's hidden context or automatically inject messages
between them. Coordinate through committed code, pull requests, and the shared
audit record so every handoff remains reviewable.
