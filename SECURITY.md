# Security policy

## Supported versions

This is a small, actively-developed project with no long-term-support branches. Security fixes land on the latest release only; if you're running an older version, update first before reporting, the issue may already be fixed.

## Reporting a vulnerability

**Please don't open a public GitHub issue for a security report.** Use GitHub's private vulnerability reporting instead: go to this repo's **Security** tab → **Report a vulnerability**. That opens a private advisory only the maintainer can see until it's resolved, so a real issue doesn't sit exposed while a fix is worked out.

If you can't use that for some reason, a regular issue with as little detail as possible (just "possible security issue, please reach out") works as a fallback to get a conversation started privately.

Include, if you can:
- What the issue is and why it's exploitable (a proof of concept helps, but isn't required)
- Which version/build you're running (source checkout, or a specific packaged release)
- Any relevant logs, with your own API keys/tokens redacted first

## What counts

Fama runs entirely on your own machine (`127.0.0.1` only, never bound to your LAN) and its only outbound network calls are to OpenAI's API, and only when you've configured your own key for the optional cloud voice. Given that scope, things worth reporting include:

- A way to reach the local server from something other than the loopback interface
- A way to bypass the CSRF token check on a mutating request
- Any path where an OpenAI API key you've configured could end up somewhere it shouldn't (logged, echoed back to the browser, written into a location that gets packaged/distributed, etc.)
- Path traversal in the static file server or the transcript-reading code
- Anything that lets a Claude Code transcript's *content* (which this app treats as trusted local data, not user input from a network) execute code or reach the network in a way it shouldn't

## Past incidents

In the interest of not pretending this project has a spotless history: an early packaged build (v0.7.0) had a real bug where the app's own Settings panel could write a configured OpenAI API key into the installed application folder instead of per-user app data, meaning that folder (if redistributed) could carry a real credential. That release was pulled as soon as it was found, the root cause is fixed and verified (`.env` now only ever writes to the OS per-user app data directory), and every git commit in this repo's history has been checked, the key itself was never committed to source control, only ever present in that one already-removed release artifact. See `CHANGELOG.md`'s 0.9.0 entry for the technical detail.
