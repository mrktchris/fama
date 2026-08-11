# Security policy

## Supported versions

This is a small, actively-developed project with no long-term-support branches. Security fixes land on the latest release only; if you're running an older version, update first before reporting, the issue may already be fixed.

## Release integrity

Official downloads come only from this repository's GitHub Releases page. Each stable release includes `SHA256SUMS.txt`, a CycloneDX SBOM, and GitHub/Sigstore-signed build and SBOM attestations. The tagged-release workflow rebuilds on GitHub-hosted Windows and macOS runners, runs tests and the dependency audit, and scans both unpacked apps for credential patterns and forbidden files before upload.

The Windows binaries are not currently Authenticode-signed, and the macOS app is not currently Developer ID-signed or notarized. SmartScreen or Gatekeeper may therefore warn on first launch; the project does not claim signing identities it does not possess. See the README's **Verify a release** section for hash and attestation commands.

## Reporting a vulnerability

**Please don't open a public GitHub issue for a security report.** Use GitHub's private vulnerability reporting instead: go to this repo's **Security** tab → **Report a vulnerability**. That opens a private advisory only the maintainer can see until it's resolved, so a real issue doesn't sit exposed while a fix is worked out.

If you can't use that for some reason, a regular issue with as little detail as possible (just "possible security issue, please reach out") works as a fallback to get a conversation started privately.

Include, if you can:
- What the issue is and why it's exploitable (a proof of concept helps, but isn't required)
- Which version/build you're running (source checkout, or a specific packaged release)
- Any relevant logs, with your own API keys/tokens redacted first

## What counts

Fama's server runs entirely on your own machine (`127.0.0.1` only, never bound to your LAN). Transcript content leaves the device only when you configure optional OpenAI cloud voice. The packaged desktop shell separately checks GitHub Releases for updates, and links embedded in transcript image events are never fetched automatically. Given that scope, things worth reporting include:

- A way to reach the local server from something other than the loopback interface
- A way to bypass the CSRF token check on a mutating request
- Any path where an OpenAI API key you've configured could end up somewhere it shouldn't (logged, echoed back to the browser, written into a location that gets packaged/distributed, etc.)
- Path traversal in the static file server or the transcript-reading code
- Anything that lets a Claude Code transcript's *content* (which this app treats as trusted local data, not user input from a network) execute code or reach the network in a way it shouldn't

## Past incidents

In the interest of not pretending this project has a spotless history: during pre-beta development, the maintainer's own OpenAI API key was packaged into alpha release artifacts twice, via two distinct root causes.

1. The app wrote its `.env` into its own installed application folder instead of per-user app data, so saving Settings inside a packaged build left a credential in a distributable location. Fixed: `.env` now only ever writes to the OS per-user app data directory.
2. Separately, the packaging tool copied a real `.env` from the project source root into the built package. `.gitignore` covers `.env`, so every git-based check reported clean and kept reporting clean — but `electron-packager` does not read `.gitignore`, and the `files` whitelist that had previously prevented this was lost when the build moved off `electron-builder`.

All affected releases were deleted. No key was ever committed to source control (verified across full git history, including a pattern search of every blob in every commit); the exposure was confined to release artifacts, which are now gone.

The second cause is the more instructive one, and the reason for the current build gate: a check that passes for the wrong reason is worse than no check. Packaging now runs `desktop/verify-package.js`, which fails the build outright if the packaged output contains a `.env`, a `usage.json`, a `.pid` file, or any content matching a credential pattern — independently of the `--ignore` rules that are supposed to prevent it, so that a silently-broken build flag cannot ship a secret again. Any release process for this project must run that gate before upload.
