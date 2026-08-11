# Domain documentation

Fama is a single-context repository.

## Before exploring

- Read root `CONTEXT.md` when it exists.
- Read relevant architectural decisions under `docs/adr/` when they exist.
- If either is absent, proceed silently. Producer workflows create them only
  when durable terminology or a durable architectural decision is resolved.

## Consumer rules

- Use the glossary vocabulary in `CONTEXT.md` for issues, tests, hypotheses,
  refactors, and documentation.
- Do not silently contradict an ADR. Cite the ADR and explain why reopening it
  may be justified.
- A missing domain term may indicate either invented language or a genuine
  documentation gap; resolve that before adding a synonym.
