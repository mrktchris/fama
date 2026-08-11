# Fama

[![CI](https://github.com/mrktchris/fama/actions/workflows/ci.yml/badge.svg)](https://github.com/mrktchris/fama/actions/workflows/ci.yml)

**See and hear Claude Code and Codex work, live, as it happens.**

Fama tails a live transcript and speaks it back to you as it happens — nothing invented, nothing sent anywhere it shouldn't be.

A local, always-on window into what your coding agents are doing right now: what they're thinking when a readable summary is available, which tool just ran, and what came back. Local-first by design: it tails the session transcript files Claude Code and Codex already write on your own machine, with no required API calls and no cloud dependency just to open it. Optional cloud voice is available if you want it to sound less robotic, with a persona and accent you control.

**Privacy, plainly:** local by default. The dashboard reads files already on your own disk and has no account, telemetry, analytics, or remotely hosted UI assets. When optional cloud voice is enabled, the text being narrated (and, if the rewrite step is on, the raw thinking/text it's condensed from) is sent to OpenAI, using your own key, billed to your own account, never Fama's. That's the only path any transcript content ever takes off your machine. The packaged desktop app also makes a content-free update check against this repo's GitHub Releases on launch; it carries nothing about you or your work. See [Voice, in detail](#voice-in-detail) below for the exact mechanics.

![screenshot placeholder: main dashboard with lanes and mascot](docs/screenshot-dashboard.png)
<!-- Real screenshots go here before this ships anywhere public. Run the app, capture: (1) the main dashboard with a lane or two active, (2) the Settings panel open, (3) the tray icon / native window. Drop them in docs/ with these exact filenames and the placeholders above resolve automatically. -->

## Why

Claude Code already streams everything it does into the chat pane. But that view disappears the moment you switch windows, and there's no ambient way to glance at several active sessions at once, let alone hear it while you're looking elsewhere. Fama is a second, always-visible surface for that same activity: pin it on a second monitor, or run it as a real desktop app, and know what's happening without keeping the chat pane in focus.

## Quick start

> **Beta.** v0.12.0 is the first release meant for anyone other than the author. Earlier builds were alpha, have been removed, and are unsupported.

**Desktop app (Windows):** see [Releases](../../releases) — either `Fama-Setup-*.exe` (a real installer, Start Menu shortcut + uninstaller) or `Fama-win32-x64.zip` (portable, unzip anywhere, run `Fama.exe`). Both unsigned for now, Windows will show a SmartScreen warning on first launch either way, click through it.

**From source (Node 18+):**
```
git clone https://github.com/mrktchris/fama.git
cd fama
npm start
```
Then open http://localhost:4317. Windows is the only platform this has actually been run and tested on end to end. The project-folder path encoding has a macOS/Linux code path too, implemented from Claude Code's known naming scheme, but it hasn't been verified against a real Mac or Linux machine, if it's wrong for you, please open an issue.

## What it does

- **Live visual dashboard.** One lane per active Claude Code or Codex session, streaming text, available reasoning summaries, tool calls, and results in real time over Server-Sent Events. A small animated mascot shows idle / thinking / speaking / running-a-tool at a glance.
- **Spoken narration**, free by default (your OS's built-in voice) or OpenAI cloud voice if you want it to sound human. Click **enable voice** once, that's the only manual step.
- **A rewrite step**, not just reading raw text verbatim: thinking and text events get a quick pass through a cheap language model first, turning rambling internal monologue into one short, natural spoken line. Length is a 3–30 second dial with a live cost estimate, persona and voice accent are both free-text fields you control (try "a sharp CMO giving a fast executive summary," or the built-in Dominican-English voice preset).
- **Usage tracking.** Running dollar total for the cloud voice, right in Settings, resets independently of your real OpenAI billing.
- **Desktop app** (Windows now, Mac buildable from source, see below): system tray,
  closes to tray instead of quitting, and user-confirmed download/install updates.

## How it works

1. Claude Code writes JSONL transcripts under `~/.claude/projects/<encoded-project-path>/`; Codex writes them under `~/.codex/sessions/YYYY/MM/DD/`.
2. The Selected Projects Module gives each watched project one stable identity, transcript directory, real working directory, and label. Old config shapes migrate automatically.
3. Live Activity Ingest discovers matching Claude and Codex sessions, starts each tailer at end-of-file (never replaying history), invokes the provider adapters, and publishes a bounded SSE feed.
4. The viewer groups normalized events into lanes. Its Narrator serializes speech intents through the free local voice or the optional server-side Cloud Narration Module.

The deployable shape stays intentionally simple: one local server plus its optional Electron shell. `server.js` and `desktop/main.js` are composition roots; domain behavior lives behind the Interfaces documented in [`CONTEXT.md`](CONTEXT.md) and [`docs/adr/0001-deepen-runtime-modules.md`](docs/adr/0001-deepen-runtime-modules.md).

Nothing leaves the machine unless you turn on cloud voice. Be precise about what "on" means: with the rewrite step enabled (the default once cloud voice is configured), the **raw thinking/text content is sent to OpenAI first**, to be condensed, and the rewritten result is then sent again for speech synthesis. If rewriting fails for any reason, the raw text goes to speech synthesis directly instead of being dropped. Either way, it's your own key, billed to your own account, and it's exactly one line at a time, on demand, never a bulk transcript upload, but "only the narrated line" undersold it, the source text goes out too when summarizing is on.

## Voice, in detail

By default it speaks narrated text and current thinking. Tool-call announcements are off by default (they fire constantly and get noisy fast), flip the **tools** switch in Settings if you want those too. Only the most recently active session speaks, so two sessions running at once don't talk over each other.

**Free tier:** Windows' built-in SAPI voices via the browser, robotic but zero cost, zero setup. Open the app in Edge instead of Chrome for noticeably better free "Natural" neural voices through the same API.

**Cloud tier (optional, costs money):** click the gear icon, paste an OpenAI key, pick a model. `gpt-4o-mini-tts` is the recommended default and the only current option here that honors the accent/style field. `tts-1` is a simpler per-character-priced alternative, while `tts-1-hd` trades speed and cost for quality. If a cloud call ever fails, that one line falls back to the free voice automatically, so you never get silence.

**Dominican-English direction:** Settings includes a dedicated preset. Fama expands the short label into a full voice-design instruction: warm, natural Dominican-American English, authentic cadence, subtle Caribbean Spanish influence, clear and conversational, never exaggerated or stereotyped. This follows the prompt-specific voice-design pattern described by [Hume's accent guidance](https://www.hume.ai/blog/how-to-generate-ai-voices-with-accents), but the provider in Fama today is still OpenAI; Hume/Octave is research input, not an implemented provider.

Cost math: lines are capped at 3–30 seconds of speech, with a live estimate in Settings and a running local estimate in the Usage panel. The Cloud Narration Module is the single source for both figures. Rates were checked against OpenAI's official model pages on 2026-08-11; `tts-1` and `tts-1-hd` use their exact per-character rates, while mini-TTS remains approximate because OpenAI bills it in text and audio tokens. These figures are not a substitute for your provider bill. Your `.env` file is gitignored and the real key is never echoed back to the browser after you save it, only whether one is configured.

### Two ways to follow the work

**Messages** is the default conversation view. Prompts and agent replies read as a real dialogue, while reasoning, tool calls, results, and errors stay one click away in expandable activity cards. **Activity** switches the same live events into a compact technical stream. The selected view is remembered on this device; neither view replays transcript history from before Fama started watching.

### Latency

Two real API calls happen per spoken line when the rewrite step is on (a short chat completion, then TTS), which puts a real floor of roughly 1–3 seconds on cloud voice, that's network reality, not a bug to file. For genuinely near-zero latency: turn rewrite off (cuts one hop), or use the free local voice (zero network calls, instant, just robotic). A proper fix is a **local neural TTS model** (Kokoro and Qwen-TTS both came up researching this, Qwen-TTS in particular takes natural-language style instructions the same way this app's voice-style field already does, no cloud round trip at all), that's the real answer to "as fast as thoughts are coming in" and is the top roadmap item, not built yet.

## Desktop app

**Windows:** see Quick start above for the portable zip. A real NSIS installer also exists now, unsigned: a Developer-Mode/symlink permission wall blocked building it on this project's own dev machine, GitHub Actions' Windows runners don't hit the same wall, confirmed with a real CI-built installer, not just a working command. Unsigned means the same SmartScreen warning either way for now, a code-signing certificate is a real purchase + identity verification only the repo owner can do, CI is ready to sign automatically the moment one exists (see `.github/workflows/ci.yml`).

**Mac:** not pre-built, buildable yourself from source:
```
git clone https://github.com/mrktchris/fama.git
cd fama
npm install
npm run electron        # test it first, dev mode
npx electron-builder --mac --publish never
```
Needs Xcode Command Line Tools (`xcode-select --install`) and Node 22.12+ for the current Electron build toolchain. The source server itself remains compatible with Node 18+. Unsigned, so macOS Gatekeeper will block it the first time, right-click the app → Open, once, to approve it.

**Updates:** the packaged app checks GitHub Releases on launch. When a tagged release
contains the installer, blockmap, and `latest.yml`, Fama offers to download it, then asks
again before restarting to install. The tagged-release workflow publishes those three
assets together and runs the package secret gate first. Nothing downloads or installs
without your click.

## Known limitations

- **It does not separate clients.** Every Claude Code session launched from the same working directory writes into the same project folder on disk, so if two unrelated threads are active at once, both narrate into the same feed. Click a lane's header to collapse one, or watch separate projects as separate entries instead (Settings → tray → Manage watched projects) for real separation.
- Windows only for a pre-built binary right now.
- Subagent transcripts aren't shown yet, only top-level sessions.

## How this compares to similar tools

This isn't the first tool that gives Claude Code a voice. Worth knowing about before assuming it's novel:

- **[AgentVibes](https://github.com/paulpreibisch/AgentVibes)** — Claude Code hooks that speak on task start/completion, 900+ voices via Piper (free, offline) or cloud providers.
- **[agent-tts](https://github.com/kiliman/agent-tts)** — real-time TTS for multiple agent CLIs (Claude, OpenCode, others), several provider backends.
- **Claude Code Narrator** — local Kokoro neural TTS, no cloud at all, sub-50ms synthesis.

Those are audio-only, hook- or CLI-triggered. What's different here: a standalone visual dashboard *and* voice together, a rewrite step that condenses raw reasoning instead of reading it verbatim, persona/accent control, a packaged desktop app with an update checker rather than a CLI plugin, and a live cost tracker. Fair to say this sits at a different point in the space, not that the space was empty.

## Roadmap

- [ ] **Local LLM for the rewrite step**, not just local TTS: the condense-before-speaking pass currently always calls OpenAI (`gpt-4o-mini`) when cloud voice is on. Running that rewrite through a small local model (same family of options as the TTS one below, e.g. Ollama/llama.cpp with a small instruct model) would cut both latency and the one remaining place raw thinking text leaves the machine.
- [ ] Local neural TTS (Kokoro or Qwen-TTS) for genuinely near-zero latency, no cloud round trip
- [x] **Codex transcript support.** `lib/parse-codex.js` normalizes real Codex session records into the same event vocabulary as Claude, and `server.js` tails matching active sessions as a second provider. Provider-native reasoning summaries are displayed only when Codex records expose them; opaque encrypted reasoning is never presented as readable text.
- [ ] Support additional coding agents beyond Claude Code and Codex through the same provider-adapter pattern.
- [ ] Sign the existing Windows installer when a certificate or Microsoft Trusted Signing enrollment is available
- [ ] Subagent lanes, nested under their parent session
- [ ] Detect when a session is specifically waiting on a permission decision, not just gone quiet, and say so in the notification differently
- [x] Use Electron's bundled Node runtime so the packaged app needs no separate Node.js install or PATH dependency.
- [x] Upgrade Electron/electron-builder and clear the build-tool dependency audit; CI now enforces a high-severity audit gate.
- [ ] Actual code-signing certificate (or Microsoft Trusted Signing) — the CI pipeline is ready and waiting for one, this is a real purchase/identity-verification step for the repo owner, not an engineering task
- [x] Wire the installer into a user-confirmed auto-update flow with release metadata and a secret-scanned tagged-release gate

## Contributing

Issues and PRs welcome, this is a small project and every bit helps. See [CONTRIBUTING.md](CONTRIBUTING.md) for how the code's organized, how to run it locally, and what a good PR looks like here. Found a security issue (not just a bug)? See [SECURITY.md](SECURITY.md) instead of opening a public issue.

`npm test` runs the automated suite (path encoding, transcript parsing, file tailing, a real HTTP integration test against the server) — zero new dependencies, just Node's own built-in test runner. CI runs it on every push and PR, plus a Windows job that builds the real package and scans it for anything that shouldn't ship.

## License

MIT
