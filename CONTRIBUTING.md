# Contributing to Fama

Thanks for even considering it, this is a small project maintained in spare time, so contributions genuinely move it forward.

## Before you start

For anything more than a small fix, open an issue first to talk through the approach. Saves both of us the awkwardness of a big PR going a direction that doesn't fit.

## Running it locally

No build step, no bundler, plain Node.

```
git clone https://github.com/mrktchris/fama.git
cd fama
npm install       # only pulls electron-updater + dev tooling, the server itself is dependency-free
npm start
```

Open `http://localhost:4317`. To also exercise the desktop shell:

```
npm run electron
```

To test against a specific project's transcripts without `cd`-ing into it:

```
CLAUDE_NARRATOR_DIR=/path/to/some/.claude/projects/<encoded-folder> npm start
```

## Where things live

- **`server.js`** — the whole backend: transcript watching, SSE, the optional OpenAI rewrite/TTS calls, settings persistence. Single file on purpose, it's not that big yet.
- **`lib/tail.js`** — byte-offset file tailing (`FileTailer`), reused by nothing else, kept separate because it's the one piece with real correctness subtlety (partial UTF-8 reads, `fs.readSync` return values).
- **`lib/parse.js`** — turns a raw transcript JSON line into normalized events. This is the part most likely to need updates if Claude Code's own transcript format changes.
- **`viewer/`** — the browser UI: `app.js` (lanes, SSE handling), `speech.js` (the `Narrator` class, both voice backends), `settings.js` (the gear-icon modal), `mascot.js`, `style.css`, `index.html`.
- **`desktop/`** — the Electron shell: `main.js` (window/tray/updater/notifications), `preload.js`/`preload-main.js` (the only two things the renderer can call into Node for), `onboarding.html`/`.js` (project picker).

## Testing a change for real

This project's house rule, learned the hard way more than once: **if you can verify it against the real running app, do that before calling it done**, don't just read the diff and assume it's right. A few of this project's own past bugs (a settings race condition, a test button that tested stale config, a `.env` write-path bug that shipped a real credential once) all looked correct on inspection and weren't.

- For server-side changes: start the app, hit the actual HTTP routes (`curl`, or the browser), don't just trace the code.
- For UI changes: open the browser and click through it.
- For desktop-shell changes: `npm run electron` and actually exercise the flow (tray menu, onboarding, notifications), the main process has almost no automated coverage, manual verification is the coverage.

## Style

- No framework, no build step, no bundler. Keep it that way unless a PR discussion concludes otherwise, it's a deliberate choice (see the README's "why" section on dependency-free-by-default).
- Comments explain *why*, not *what* — if a comment just restates the line below it, cut it.
- Match the existing tone: direct, a little dry, no marketing language in code comments.

## Reporting bugs

Open a GitHub issue. Include: what you expected, what happened instead, your OS, and whether you're running from source or a packaged build. A copy of the relevant server console output (the terminal Fama was started from, or `desktop/main.js`'s console if running the Electron shell) is usually the single most useful thing you can paste in.

Found something that looks like a security issue (credential exposure, injection, anything like that) rather than a regular bug? Please see [SECURITY.md](SECURITY.md) instead of a public issue.
