# Fama public-launch checklist

Run this checklist for every Product Hunt launch or major public release. It
keeps the public page, release assets, and support promise aligned.

## Before publishing a tag

- [ ] `package.json`, `CHANGELOG.md`, README platform copy, and the intended
      tag all name the same version.
- [ ] Run `npm ci`, `npm test`, and `npm audit --audit-level=high` from a
      clean checkout.
- [ ] Let the protected pull-request checks complete on Windows and macOS.
- [ ] Test the release workflow on a version tag and confirm that every
      platform advertised in README has a matching downloadable asset.
- [ ] Download each public asset from GitHub Releases, verify it against
      `SHA256SUMS.txt`, and verify its GitHub attestation.
- [ ] Test a clean Windows install and a clean macOS install. Record any
      SmartScreen/Gatekeeper instructions accurately; do not say an unsigned
      app is signed or notarized.

## Before announcing Product Hunt

- [ ] Confirm <https://mrktchris.github.io/fama/> loads in a signed-out
      browser and every download button resolves to a real release asset.
- [ ] Confirm the Open Graph image, title, and description render correctly
      in a link preview.
- [ ] Record a 30&ndash;45 second demonstration: choose two active sessions,
      show Messages and Activity, enable/disable local voice, and point to
      the privacy explanation.
- [ ] Collect feedback from 10&ndash;20 beta users across the advertised
      platforms. Track installation success, transcript compatibility,
      resource use, and privacy/voice feedback.
- [ ] Publish a support contact path and answer launch-day comments quickly.

## Non-code prerequisites

Authenticode signing requires a Windows certificate or Microsoft Trusted
Signing enrollment. Developer ID signing and notarization require an Apple
Developer membership and credentials. These are owner-controlled purchases
and identity checks; until they exist, retain the plain unsigned-app warning
in the README and release notes.
