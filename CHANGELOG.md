# Fama v1.0.0 — first stable release

Released 2026-08-11.

Fama is a local-first Windows desktop companion for Claude Code and Codex. It turns the transcript files those agents already write on your computer into a live conversation/activity dashboard, with optional spoken narration.

## Highlights

- Follow Claude Code and Codex sessions side by side, grouped by project and provider.
- Read messages in a conversation view or inspect reasoning summaries, tool calls, results, and errors in the activity view.
- Hear the latest active session through the free operating-system voice or optional OpenAI text-to-speech using your own API key.
- Watch multiple selected projects, rename and reorder lanes, and keep the app available from the Windows system tray.
- Receive bounded native notifications when active agents finish, fail, or go quiet.
- Install with the Windows setup executable or use the portable zip; updates are always user-confirmed before download and again before installation.

## Privacy and security

- The local server binds only to `127.0.0.1` and requires a per-process token for mutations.
- Fama has no account, telemetry, analytics, or remotely hosted application UI.
- Transcript content stays on the device unless optional cloud voice is enabled. In that mode, only narration requests are sent to OpenAI with the user's own key.
- Transcript images are size-bounded and external image URLs are never fetched automatically.
- Every release build runs tests, a high-severity dependency audit, and a package scan that blocks credentials and forbidden files.
- Release downloads include SHA-256 checksums, a CycloneDX software bill of materials, and GitHub/Sigstore-signed build-provenance and SBOM attestations.

## Compatibility

- Prebuilt and end-to-end tested on Windows x64.
- Source server requires Node.js 18 or newer.
- macOS and Linux packaging paths are available for contributors but are not published or claimed as end-to-end supported in this release.

## Known limitation

The Windows binaries are not Authenticode-signed yet, so Microsoft Defender SmartScreen may warn on first launch. A real certificate requires owner identity verification and enrollment; Fama does not claim a certificate it does not possess. Download integrity and build origin can instead be checked with `SHA256SUMS.txt` and GitHub artifact attestations on the release page.

For private vulnerability reports, use GitHub's **Security → Report a vulnerability** flow. See [SECURITY.md](SECURITY.md) for the complete disclosure and data-flow policy.
