# Changelog

All notable changes to this project, newest first. Versions match `package.json` and the git tags each commit was made under.

## 0.12.1

Fixes from an independent external audit of the public repo and released package, verified against real code and a real running app before acting on any of it, not applied on the auditor's word alone. **v0.12.0 is withdrawn, this supersedes it.**

- **Real leak, fixed:** four dev-session log files (`electron.out.log`, `electron.err.log`, `run.out.log`, `run.err.log`) were sitting in the source root and shipped inside the v0.12.0 release zip. They contained an absolute file path (which carries the OS username on Windows) and cloud-voice usage metadata, no credentials. Deleted, and `desktop/verify-package.js`'s forbidden-file check now matches by extension (`.log`) as well as exact filename, so a file that was never explicitly named can't slip through the same way again.
- **Real bug, fixed:** `usage.json` had the same write-path class of bug as the original `.env` incident, defaulting to the app's own install directory instead of per-user data. `FAMA_USAGE_PATH` now routes it to `app.getPath('userData')`, verified live (reset the tracker against a running packaged build, confirmed the file landed in `%APPDATA%\Fama`, not the source tree).
- **Real bug, fixed:** thinking blocks were truncated to 220 characters *before* the rewrite step ever saw them, so "condenses raw reasoning" was only true for short thinking blocks — anything longer got rewritten from an already-truncated, often mid-sentence fragment. The 220-char version now exists purely for the lane display; a separate, much less truncated copy reaches the rewrite step.
- **Real bug, fixed:** "Check for updates" could fail completely silently in a packaged build (no console, no dialog) if the check rejected at the promise level rather than through the autoUpdater's own error event. Now shown as a real error dialog on a manual check, same as every other failure path already was.
- **Real bug, fixed:** notification bubbles showed as coming from `electron.app.Fama` instead of `Fama`, no Windows AppUserModelID had been set. Also missing an icon entirely (added), and the idle-notification threshold (20s of quiet after only 3 events) fired constantly during completely normal use, raised to a threshold that means something plus a cooldown so several lanes going idle together doesn't still stack bubbles.
- **Real bug, fixed:** the onboarding/setup window had no icon set, fell back to Electron's default. Its background color, and the main window's, were also still the pre-rebrand near-black instead of oxide.
- **Real bug, fixed:** `generate-icon.ps1` had a machine-specific hard-coded output path, would have failed for any other contributor. Now derives it from the script's own location.
- **Docs corrected, not just softened:** the privacy paragraph directly contradicted itself one sentence apart ("nothing... ever leaves your machine, under any configuration" followed immediately by describing what cloud voice sends). Rewritten to state plainly what's local and what isn't, no absolute claim that the very next sentence walks back. The "any OS" claim was inaccurate (the project-path encoder was Windows-only, now has a Linux/macOS code path too, implemented from Claude Code's known encoding scheme but not verified against a real Mac/Linux machine, said plainly rather than claimed as tested). `engines.node` was `>=16`; cloud voice needs global `fetch`, which requires 18+, bumped and documented. A README claim to see the changelog for "actual benchmark numbers" pointed at numbers that don't exist here, removed. The TTS cost estimate for `gpt-4o-mini-tts` was priced identically to `tts-1`'s older flat per-character rate; updated closer to the real number cross-referenced against OpenAI's own pricing docs, still labeled an estimate since that same cross-reference left real ambiguity about the exact billing unit.
- Added a Linux packaging target (`npm run dist:linux-packager`). Produced, not verified end to end — this development environment is Windows-only, there's no way to actually launch and test a Linux build here.

Explicitly **not** attempted in this pass, flagged rather than silently skipped: upgrading Electron/electron-builder (the audit's `npm audit` findings are real, but a major-version bump is its own dedicated testing pass, not a same-session add-on to a security fix); an automated test suite; a signed installer; bundling a Node runtime; real macOS/Linux hardware testing. See the audit notes for the fuller list.

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
