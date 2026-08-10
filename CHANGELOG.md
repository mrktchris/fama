# Changelog

All notable changes to this project, newest first. Versions match `package.json` and the git tags each commit was made under.

## 0.12.0

- **Renamed to Fama** (from Pico). Ovid's Fama lives in a house of bronze at the center of the world, hearing everything and repeating it back, instantly, without rest — that's the literal mechanism this app already had (tail a transcript, speak it back live), the name just finally says it. The myth's Fama mixes lies into what she repeats; the brand position is the twist on that: this one doesn't.
- New visual identity: oxide/parchment/bronze/verdigris/ink/rust palette (replacing the teal-on-near-black scheme from the previous rename), Cinzel for the wordmark and major headings, EB Garamond for long-form copy, a new icon mark (bronze ring, verdigris waveform, small wing accents) replacing the bird-silhouette app icon. The in-app animated mascot keeps its existing bird/winged-herald shape and animation rig, just recolored, a full illustrated redesign wasn't achievable at the fidelity of the brand reference without real risk of looking worse, not better.
- **Rename continuity, tested, not assumed:** `app.getPath('userData')` is derived from the app's product name, so this rename would otherwise move every existing install's config and OpenAI key to a folder the app has never looked in. A one-time migration now copies `config.json`, `.env`, and `usage.json` from the old Pico data folder on first launch if the new one doesn't have them yet, verified against a real prior install on this machine, not just read as correct.
- Every `PICO_*` env var, the `X-Pico-Token` auth header, and the `picoDesktop`/`narratorSetup` IPC bridge names are now `FAMA_*` / `X-Fama-Token` / `famaDesktop`/`famaSetup` respectively.
- `localStorage` keys migrate forward one more time (now a three-deep cascade: claude-narrator → Aloud/Pico → Fama) so existing users don't lose saved voice choice, thinking/tools/speed prefs, or lane renames on this update.
- GitHub repo renamed `mrktchris/pico` → `mrktchris/fama` (GitHub keeps the old URL redirecting). Release asset is now `Fama-win32-x64.zip`.

## 0.11.1

- **Fixed auto-update, which had been silently non-functional in every packaged build since 0.7.0.** Found by reviewing this project's own test logs rather than by inspection: every launch logged an `ENOENT` on `resources/app-update.yml`, a file electron-builder normally generates automatically but electron-packager (used here, see README on why) has no idea to write. Root cause went deeper than that one file: the original design also called `autoUpdater.downloadUpdate()`/`quitAndInstall()`, electron-updater's NSIS-installer update flow, which was never going to work end to end against this app's actual distribution method (an unpacked folder, not an NSIS install). Fixed properly rather than patched around: `desktop/write-update-manifest.js` and `desktop/write-latest-yml.js` now generate both files electron-updater needs (from the real built zip's own hash, so it can't drift stale), and "Update available" now opens the Releases page instead of attempting an in-place install the distribution method can't support. Verified against a real published release, not just a local build.
- Added `CONTRIBUTING.md`, `SECURITY.md` (including a private vulnerability-reporting path via GitHub's advisory feature), `CODE_OF_CONDUCT.md`, and GitHub issue/PR templates. First real contribution infrastructure this repo has had.
- README's Known limitations and Roadmap sections updated to match current reality (the pin-a-session and multi-project items were already shipped and listed as pending; the update-checking limitation above is now documented instead of silently broken).

## 0.11.0

- **Watch several projects at once.** Onboarding is now a checklist instead of a single pick, and the tray menu's "Manage watched projects…" reopens it later pre-checked with whatever's currently watched, so it reads as "edit the list" rather than "start over." One server process tails all of them; each event carries which project it came from.
- **Per-lane project badge**, shown automatically once more than one project is actually active, hidden in the common single-project case where it would just repeat the header tooltip.
- **Rename any lane.** Double-click a lane's title to give it a name that'll actually mean something later ("the migration", "bug hunt"), persists across reloads (keyed by session id), overrides the default first-prompt-derived title.
- **Drag to reorder lanes.** Plain HTML5 drag-and-drop, no library, live only, not persisted across reload (session ids are one-run-only anyway, so there's nothing meaningful to restore a saved order onto).
- **New accent color.** The default blue read as generic "AI product blue," identical to most of the category. Replaced with a distinct teal across the app, the landing page, and onboarding, semantic colors (thinking/tool/result/error) unchanged since those carry real meaning.
- Config migration: existing single-project installs (`watchDirEncoded`) upgrade to the new list shape (`watchDirsEncoded`) automatically on first launch after updating, nothing to reconfigure.

## 0.10.0

- **Desktop notifications.** Small native bubbles (Settings toggle, on by default) for real errors and for "Claude looks done for now" after a burst of activity goes quiet. Skipped automatically if the window's already visible and focused, no bubble on top of the thing you're already looking at. Reads the same `/events` feed the browser tab does, no duplicated tailing logic.
- **Launch Pico when Windows starts**, a second Settings toggle next to notifications, off by default. Both are Electron-only and the whole "Desktop app" Settings section stays hidden when this same viewer is opened plain in a browser tab, where neither concept applies.
- **Desktop shortcut**, created automatically once on first successful launch of a packaged build (also available anytime from the tray menu). electron-packager doesn't produce an installer, so nothing else was going to put an icon on the Desktop.
- **Jarvis-style preset**, both persona and voice-style, alongside the existing CMO/casual/terse and calm/upbeat/British presets, same mechanism, no new plumbing.
- **Packaged build size cut ~15%** (272MB → 232MB on the win32-x64 build): Electron ships all 55 Chromium locale `.pak` files by default, Pico's UI is English-only, so a `postdist:win-packager` step now keeps just `en-US.pak`. Verified against a real build, including relaunching the trimmed exe to confirm it still starts.
- **Fixed a config-loss bug**: switching watched projects called `saveConfig({ watchDirEncoded })`, replacing the whole config file and silently resetting the two new toggles above back to defaults every time. Now merges with the existing config instead.
- **No more absolute filesystem path sent to the browser.** The `/events` system event used to include the full watch path (Windows always embeds the OS username in an absolute path); it now sends only a friendly project name.
- Renamed the last of the pre-Pico internal naming (a startup log line, an `.env` header comment, a couple of `localStorage` keys) with a one-time migration so existing users don't lose persisted Settings toggles on update.
- `package-lock.json` re-synced to the `pico` package name (was still `aloud` from before that rename).

## 0.9.0

- **`.env` write-path fix.** The packaged v0.7.0 build wrote its local `.env` config file next to `server.js`, inside the app's own installed resources folder, on every Settings save, since `ENV_PATH` had no override and always resolved there regardless of packaged vs. source-checkout context. That build has been removed from Releases. `.env` now always writes to the OS per-user app data folder (`app.getPath('userData')`), verified against a fresh packaged build. If you ran v0.7.0 and saved an OpenAI key through Settings, rotate it as a precaution.
- **Renamed to Pico** (from Aloud), including a new bird mascot (wing/crest/beak, replacing the earlier robot-block design) with matching bob/blink/chirp/wing-flutter animations.
- **Manual per-lane pin.** Click a lane's speaker icon to lock narration to that session regardless of which one is most recently active; a "stop talking" button cancels the current line without turning voice off entirely.
- CSRF hardening: a per-process random token, injected into the served page and required as a custom header on every mutating request, defeats both cross-origin fetches and classic form-POST CSRF.
- Fixed an XSS-shaped bug in lane rendering (session id was interpolated into HTML instead of set as text).
- `Narrator.stop()` now genuinely cancels in-flight speech (an `AbortController` plus a generation counter) instead of just resetting visible UI state while an old request could still land and play.

## 0.8.0

- Batch of fixes from an external review, each verified against the real running app rather than just re-read code: `electron-updater` listeners were re-registering on every manual "check for updates" click, stacking duplicate dialogs; switching watched projects never stopped the previous server child, leaking a process and risking a port conflict; the onboarding project picker showed raw encoded folder names instead of real paths because it only checked the first line of a transcript file for a `cwd` field (the real record is usually a few lines in, after bookkeeping lines); no single-instance lock meant a second launch could spawn a second server against the same port.
- `FileTailer` now uses the actual bytes read from `fs.readSync` instead of assuming it read to EOF, and decodes with `StringDecoder` instead of raw `toString('utf8')`, both fix real corruption at multi-byte UTF-8 boundaries under fast polling.
- Settings "Hear a test line" now saves current form values before testing (it was testing whatever was last saved, not what was on screen), and the length/cost estimate shown before Save matches the server's real pricing table (`gpt-4o-mini-tts` had fallen out of sync between the two).

## 0.7.0

- Renamed to Aloud (from claude-narrator).
- One-click updates via `electron-updater` against GitHub Releases.
- First real packaged Windows build (later found to have the `.env` write-path bug fixed in 0.9.0, see above).

## 0.6.0

- **Standalone Windows desktop app** (Electron): system tray, hide-on-close instead of quit, a project onboarding picker for a double-clicked app with no "directory you launched it from," taskbar icon.
- **Persona and voice-style controls** in Settings: free-text accent/tone for the cloud voice, and a separate persona field that shapes the rewrite step (works with any voice, free or cloud).
- Playback failures now get reported back to the server (`/client-error`) instead of failing silently in the browser console.
- Fixed a Settings race condition where an in-flight `/config` refresh could resolve after a fast edit and silently overwrite it before Save was clicked.

## 0.5.0

- **Usage tracker.** New section at the top of Settings, running $ total for this OpenAI key on this machine (TTS characters + rewrite tokens, priced against OpenAI's published rates), with a reset button that only zeroes the local counter, it has no effect on real billing.
- **Narration length is now a continuous 3-30s slider**, not fixed presets, with a live word-count and cost estimate that updates as you drag it. Calibration was actually broken on the first pass (short end ran long, long end got cut off), both were real bugs, both fixed and reverified against real API responses, not just re-read code.
- **Speed slider now drives both voices at once.** One control instead of two, applies live with no Save needed, sent through to the cloud voice as OpenAI's own `speed` parameter and to the local fallback as `utterance.rate`.
- **"Attached" badge** on whichever session lane is currently the one that would speak next, the honest answer to "which thread are you on": this tool only knows which session is doing something right now, not which window has your focus.
- **Thinking/tools toggles and speech rate now persist across reloads** (localStorage), previously reset to defaults every time the page reloaded.
- Rewrite prompt tightened (hard word limit stated twice, lower temperature) after testing showed the model was ignoring the original soft limit by more than 2x.
- Confirmed via full git history audit, including the remote: no API key has ever been committed, `.env` is gitignored from before any real key ever touched disk, and the shipped `.env.example` is blank so anyone else cloning this gets zero pre-filled credentials, they configure their own key from Settings or `.env`.

## 0.4.0

- **Settings panel in the UI.** Gear icon in the header opens a modal to paste an OpenAI key, pick model/voice, and toggle rewrite, no more hand-editing `.env` required (though that still works fine too, the panel just writes the same file).
- **Live rewrite step.** When cloud voice is on, `thinking` and `text` events get a fast pass through `gpt-4o-mini` before being spoken, turning raw internal-monologue prose into one short, natural spoken sentence instead of reading it verbatim. Falls back to the raw text if the rewrite call fails.
- **Lower latency.** Transcript poll interval cut from 700ms to 250ms.
- **Header decluttered.** Speech-behavior toggles (thinking/tools) and the fallback-voice picker moved out of the header into the Settings modal, keeping the main view to just the mascot, status, voice-mode badge, enable button, and the gear icon.

## 0.3.0

- Optional OpenAI cloud voice (`tts-1-hd` by default), server-side, with automatic graceful fallback to the free local voice if the cloud call ever fails for any reason (bad key, no credits, network blip). Configured via `.env`.
- Cost math and setup steps documented in the README.

## 0.2.0

- Animated SVG mascot in the header: idle (blink/bob), thinking (pulsing dot trail), speaking (mouth-flap), tool (brief color pulse). Fully original, no external image assets, see the README section on why.
- Spoken narration via the browser's built-in Web Speech API (free, zero setup). Thinking spoken by default, tool calls off by default.
- Full visual redesign: responsive lane grid, glow states, custom toggle switches, live pulse indicators, custom scrollbars.

## 0.1.0

- Initial local live viewer. Tails Claude Code's own session transcripts (`~/.claude/projects/**/*.jsonl`) and streams events to a browser over Server-Sent Events. Zero dependencies, zero API calls, loopback-only.
