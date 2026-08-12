# Fama

[![Release](https://img.shields.io/github/v/release/mrktchris/fama?label=release)](https://github.com/mrktchris/fama/releases/latest)
[![CI](https://github.com/mrktchris/fama/actions/workflows/ci.yml/badge.svg)](https://github.com/mrktchris/fama/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mrktchris/fama/actions/workflows/codeql.yml/badge.svg)](https://github.com/mrktchris/fama/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/github/license/mrktchris/fama)](LICENSE)
[![Platforms: Windows + macOS](https://img.shields.io/badge/platforms-Windows%20%2B%20macOS-0078D4)](https://github.com/mrktchris/fama/releases/latest)
[![Build provenance: Sigstore](https://img.shields.io/badge/provenance-Sigstore-3c8dbc)](https://github.com/mrktchris/fama/attestations)

**Fama is the calm, local desktop companion for Claude Code and Codex.**

Fama turns the transcript files already on your computer into an always-visible Messages and Activity dashboard, with optional spoken narration. One shared Electron app now builds for Windows x64 and universal macOS (Apple Silicon + Intel).

![Fama showing live Claude Code and Codex conversations](docs/screenshot-dashboard.png)

## Why Fama

- **One calm view across agents.** Follow Claude Code and Codex sessions by project and provider without keeping every task in focus.
- **Messages or activity.** Read a clean dialogue, then switch to reasoning summaries, tool calls, results, and errors when you need technical detail.
- **Voice when useful.** Use the free operating-system voice, or opt into OpenAI text-to-speech with your own API key, voice, persona, and accent instructions.
- **Built for ambient use.** Keep Fama on a second monitor or in the Windows system tray or macOS menu bar, pin the session you want to hear, and get bounded native idle/error notifications.
- **Local by default.** No Fama account, telemetry, analytics, or hosted application UI.

## Install

Download the [latest release](https://github.com/mrktchris/fama/releases/latest):

- `Fama-Setup.exe` — Windows installer with Start Menu shortcut and uninstaller.
- `Fama-win32-x64.zip` — portable build; extract it and run `Fama.exe`.
- `Fama-macOS-universal.dmg` — universal Mac app for Apple Silicon and Intel; drag Fama to Applications.
- `Fama-macOS-universal.zip` — universal Mac updater/portable archive.

The Windows binaries are not Authenticode-signed and the Mac app is not yet signed with an Apple Developer ID or notarized, so SmartScreen or Gatekeeper may warn on first launch. Fama does not claim certificates it does not possess. Each release instead includes SHA-256 checksums, a CycloneDX SBOM, and GitHub/Sigstore-signed provenance attestations. On macOS, use **Control-click → Open** for the first launch of an unsigned release you have verified.

To run from source (Node.js 18+):

```sh
git clone https://github.com/mrktchris/fama.git
cd fama
npm ci
npm start
```

Open `http://localhost:4317`. Windows x64 and universal macOS packages are built from the same source tree and gated by the same tests and package-secret scan.

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

```sh
shasum -a 256 Fama-macOS-universal.dmg
```

With the [GitHub CLI](https://cli.github.com/) installed, verify its signed build origin:

```powershell
gh attestation verify .\Fama-Setup.exe --repo mrktchris/fama
```

```sh
gh attestation verify Fama-macOS-universal.dmg --repo mrktchris/fama
```

The tagged-release workflow reruns the complete test suite, rejects high-severity dependency advisories, scans the unpacked application for credential patterns and forbidden files, generates an SBOM, creates signed attestations, and only then publishes the installer and portable bundle.

## Updates

Installed Windows and macOS builds check GitHub Releases on launch. When an update is available, Fama asks before downloading and asks again before restarting to install. Nothing downloads or installs without user confirmation. Both platforms are produced from one shared Electron codebase, and every pull request runs tests on Windows and macOS plus package builds before release.

## Current limitations

- The Windows binaries are not yet Authenticode-signed.
- The macOS app is not yet Developer ID-signed or notarized.
- Subagent transcripts are not displayed as nested lanes yet.
- Two unrelated tasks writing into the same agent project folder can appear in the same project feed; watch separate projects for strict visual separation.

## Public launch

Maintainers can use the [public-launch checklist](docs/LAUNCH-CHECKLIST.md) to
verify that the landing page, advertised platforms, downloadable release assets,
and Product Hunt materials are aligned before an announcement.

The matching [Product Hunt launch kit](docs/PRODUCT-HUNT-LAUNCH-KIT.md) has the
current positioning, gallery plan, first-maker-comment draft, and a launch-day
reply guide. Keep it factual: Fama is free and usable now, but its Windows and
macOS packages are currently unsigned.

## Contributing

Need help, found a bug, or want to share compatibility feedback? [Open a GitHub issue](https://github.com/mrktchris/fama/issues/new/choose). Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); run `npm test` before opening a PR. Security reports belong in GitHub's private **Security → Report a vulnerability** flow, not a public issue.

## License

[MIT](LICENSE)
