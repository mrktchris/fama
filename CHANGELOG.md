# Changelog

All notable changes to this project, newest first. Versions match `package.json` and the git tags each commit was made under.

## 0.12.0 — first beta

The first release intended for anyone other than the author. Everything before this was alpha: iterated in the open, renamed several times, and not distributed as something to rely on. Those earlier builds have been removed; this is the only supported version.

**What it is**

- **Live visual dashboard.** One lane per active Claude Code session, streaming text, thinking, tool calls, and results in real time. A small animated mascot shows idle / thinking / speaking / running-a-tool at a glance.
- **Watch several projects at once.** Onboarding is a checklist; the tray menu's "Manage watched projects…" reopens it later pre-checked with whatever's currently watched. One server process tails them all, and each lane is badged with which project it came from once more than one is active.
- **Spoken narration.** Free by default (your OS voice) or an optional OpenAI cloud voice, with a persona and accent you write yourself as free text rather than pick from a dropdown.
- **A rewrite step, not verbatim reading.** Thinking and text events get a quick pass through a cheap model first, turning rambling internal monologue into one short natural spoken line. Length is a 3–30s dial with a live cost estimate.
- **Lane management.** Double-click a lane title to rename it (persists across reloads), drag to reorder, pin one to lock narration to it, or hit stop-talking to cancel the current line without turning voice off.
- **Usage tracking.** A running dollar total for the cloud voice in Settings, independent of your real OpenAI billing.
- **Desktop app.** System tray, closes to tray instead of quitting, desktop notifications (toggleable), launch-at-startup (toggleable), automatic Desktop shortcut, and an update checker against this repo's releases.

**Privacy**

The dashboard is entirely local and works offline: no account, no telemetry, no analytics, nothing transmitted. The only thing that ever leaves your machine is the optional cloud voice, using your own API key billed to your own account. With it off, nothing leaves your device at all. See the README for exactly what is sent when it's on.

**Identity**

Named for Ovid's Fama, who lives in a house of bronze at the center of the world, hearing everything and repeating it back instantly, without rest — the literal mechanism this app performs. The myth's Fama mixes lies into what she repeats; this one only repeats what's real. Oxide/bronze/verdigris palette, Cinzel wordmark, EB Garamond long-form copy.

**Build and release safety**

- Packaging now runs a hard verification gate (`desktop/verify-package.js`) that fails the build if a package contains a `.env`, a `usage.json`, a `.pid` file, or anything matching a credential pattern. This exists because `.gitignore` protects git but not the packager: `electron-packager` copies the whole project directory and does not read `.gitignore`, so a real `.env` in the source root (created by running from source and saving Settings) was being copied into the built package. `electron-builder`'s `files` whitelist had prevented this; switching to `electron-packager` silently dropped that protection. The packaging script now carries explicit `--ignore` rules, and the gate independently verifies they held, because a build flag that silently stops matching is exactly what needs checking rather than trusting.
- `.env` is written only to the OS per-user app data directory, never anywhere inside the application folder.
- Update checking works against GitHub Releases; in-place auto-install is not supported for this distribution format (unpacked folder, not an installer), so an available update opens the Releases page instead of pretending to install itself.

## Pre-beta (alpha, 0.1.0 – 0.11.1)

Developed in the open under three earlier names (`claude-narrator`, briefly Aloud, then Pico). Those releases have been removed and are unsupported. Summary of what was built during that period, kept for context:

- Local transcript tailing over SSE, byte-offset based, with a zero-dependency Node server (0.1.0)
- Animated mascot and free browser-based speech (0.2.0)
- Optional OpenAI cloud voice with graceful fallback to the free voice (0.3.0)
- In-app Settings panel and the LLM rewrite step (0.4.0)
- Usage/cost tracker, calibrated narration length, unified speed control (0.5.0)
- Windows desktop app via Electron, persona and voice-style controls (0.6.0)
- Update checking via electron-updater, first packaged build (0.7.0)
- Fixes from external review: single-instance lock, server lifecycle on project switch, transcript decoding at chunk boundaries (0.8.0)
- CSRF token on mutating routes, XSS fix in lane rendering, genuine cancellation of in-flight speech (0.9.0)
- Desktop notifications, launch-at-startup, desktop shortcut, ~15% smaller package (0.10.0)
- Multi-project watching, lane rename and reorder (0.11.0)
- Auto-update repair and contribution infrastructure (0.11.1)
