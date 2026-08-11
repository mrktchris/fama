# Fama

[![Release](https://img.shields.io/github/v/release/mrktchris/fama?label=release)](https://github.com/mrktchris/fama/releases/latest)
[![CI](https://github.com/mrktchris/fama/actions/workflows/ci.yml/badge.svg)](https://github.com/mrktchris/fama/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mrktchris/fama/actions/workflows/codeql.yml/badge.svg)](https://github.com/mrktchris/fama/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/github/license/mrktchris/fama)](LICENSE)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D4)](https://github.com/mrktchris/fama/releases/latest)
[![Build provenance: Sigstore](https://img.shields.io/badge/provenance-Sigstore-3c8dbc)](https://github.com/mrktchris/fama/attestations)

**See and hear Claude Code, Codex, and opt-in agent heartbeats work, live.**

Fama is a local-first Windows desktop companion for coding agents. It turns the transcript files already on your computer into an always-visible conversation and activity dashboard, with optional spoken narration.

![Fama showing live Claude Code and Codex conversations](docs/screenshot-dashboard.png)

## Why Fama

- **One calm view across agents.** Follow Claude Code and Codex sessions by project and provider without keeping every task in focus.
- **Messages or activity.** Read a clean dialogue, then switch to reasoning summaries, tool calls, results, and errors when you need technical detail.
- **Voice when useful.** Use the free operating-system voice, or opt into OpenAI text-to-speech with your own API key, voice, persona, and accent instructions.
- **Built for ambient use.** Keep Fama on a second monitor or in the Windows tray, pin the session you want to hear, and get bounded native idle/error notifications.
- **Local by default.** No Fama account, telemetry, analytics, or hosted application UI.

## Install

Download the [latest release](https://github.com/mrktchris/fama/releases/latest):

- `Fama-Setup.exe` — Windows installer with Start Menu shortcut and uninstaller.
- `Fama-win32-x64.zip` — portable build; extract it and run `Fama.exe`.

The binaries are not Authenticode-signed yet, so Microsoft Defender SmartScreen may warn on first launch. Fama does not claim a certificate it does not possess. Each release instead includes SHA-256 checksums, a CycloneDX SBOM, and GitHub/Sigstore-signed provenance attestations.

To run from source (Node.js 18+):

```powershell
git clone https://github.com/mrktchris/fama.git
cd fama
npm ci
npm start
```

Open `http://localhost:4317`. The prebuilt app is Windows x64; macOS and Linux package paths exist for contributors but are not claimed as end-to-end supported releases.

## Privacy, plainly

Fama reads the Claude Code and Codex transcript files already stored on your device. The server binds only to `127.0.0.1`, and the desktop UI is shipped inside the app.

Nothing in a transcript leaves your computer unless you enable optional cloud voice. With cloud voice enabled, the current line—and, when “Summarize before speaking” is enabled, its source text—is sent to OpenAI using your own API key and account. Fama never sends a bulk transcript. If rewriting fails, the source line may be sent directly for speech synthesis so narration does not silently disappear.

The desktop app also makes a content-free update check against this repository's GitHub Releases. External image URLs embedded in transcript events are shown as links and are never fetched automatically.

See [SECURITY.md](SECURITY.md) for the threat model, private reporting process, and pre-release incident disclosure.

## How it works

1. Claude Code writes JSONL transcripts under `~/.claude/projects/`; Codex writes session JSONL under `~/.codex/sessions/`. A selected project may also expose a sanitized live-only BUZZ stream at `.fama/agent-heartbeats.jsonl`.
2. Fama matches only the projects selected by the user and starts each tailer at end-of-file, so opening the app does not replay old work.
3. Provider adapters normalize new records into one bounded event vocabulary and publish them over a local Server-Sent Events stream.
4. The viewer groups events into lanes. Narration is serialized so active sessions do not talk over one another.

The optional BUZZ adapter is intentionally narrow: it accepts only the FRAC7
persona, status, timestamp, trace ID, and a client-safe summary of at most 240
characters. It never reads BUZZ credentials, channel messages, internal
reasoning, role memory, or a client identifier. The selected-project rule and
live-only EOF rule apply exactly as they do to transcript sources.

The deployable shape is intentionally small: one loopback-only Node server and an optional Electron shell. `server.js` and `desktop/main.js` are composition roots; domain behavior lives behind the interfaces documented in [CONTEXT.md](CONTEXT.md) and [ADR 0001](docs/adr/0001-deepen-runtime-modules.md).

## Verify a release

Compare a download with `SHA256SUMS.txt`:

```powershell
Get-FileHash .\Fama-Setup.exe -Algorithm SHA256
```

With the [GitHub CLI](https://cli.github.com/) installed, verify its signed build origin:

```powershell
gh attestation verify .\Fama-Setup.exe --repo mrktchris/fama
```

The tagged-release workflow reruns the complete test suite, rejects high-severity dependency advisories, scans the unpacked application for credential patterns and forbidden files, generates an SBOM, creates signed attestations, and only then publishes the installer and portable bundle.

## Updates

Packaged installs check GitHub Releases on launch. When an update is available, Fama asks before downloading and asks again before restarting to install. Nothing downloads or installs without user confirmation.

## Current limitations

- Prebuilt releases are Windows x64 only.
- The Windows binaries are not yet Authenticode-signed.
- Subagent transcripts are not displayed as nested lanes yet.
- Two unrelated tasks writing into the same agent project folder can appear in the same project feed; watch separate projects for strict visual separation.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); run `npm test` before opening a PR. Security reports belong in GitHub's private **Security → Report a vulnerability** flow, not a public issue.

## License

[MIT](LICENSE)
