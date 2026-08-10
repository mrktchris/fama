# claude-narrator

A local, always-on window into what Claude Code is actually doing right now: what it's thinking, which tool it just ran, what came back. No API calls, no extra tokens, no cloud dependency. It tails the session transcript files Claude Code already writes to `~/.claude/projects/`, on your own machine, and nothing else.

## Why

Claude Code already streams everything it does into the chat pane. But that view disappears the moment you switch windows, and there's no ambient way to glance at several active sessions at once. claude-narrator is a second, always-visible surface for that same activity: pin it on a second monitor and watch what's happening across your active sessions without keeping the chat pane in focus.

## How it works

1. Claude Code (and Claude Desktop) write one JSONL transcript file per session under `~/.claude/projects/<encoded-project-path>/`.
2. `server.js` watches that directory, tails new lines as they're appended (byte-offset based, it never re-reads history), and normalizes each into a small event: a line of text, a thinking snippet, a tool call, a tool result, or an error.
3. Those events stream to the browser over Server-Sent Events. The viewer groups them into one lane per active session and lets them scroll live.

Nothing leaves the machine. No API key required, because this never talks to Claude, it only reads files Claude Code already writes locally.

## Hearing it

There's a small animated mascot in the header (idle / thinking / speaking / running-a-tool are four different poses) and a voice panel next to it. Click **enable voice** once, browsers refuse to make sound until a page has had one real click, that's the only manual step. After that it reads narration out loud as it happens, using the browser's built-in speech engine (`speechSynthesis`), which means the same zero-API, zero-cost rule applies to the voice too: no key, no cloud call, no per-character billing, it's your OS's own installed voices.

By default it speaks the narrated text (`text` blocks) and current thinking (`thinking` blocks). Tool-call announcements ("running Read", "running Bash"...) are off by default since they fire far more often and get noisy fast, flip the **tools** switch if you want those read too. Only the most recently active session speaks, so two sessions running at once don't talk over each other, the quiet one just narrates silently in its lane until it becomes the active one.

Thinking is spoken opportunistically, not queued: if you're mid-thought faster than the voice can keep up, it speaks whatever's current and skips the backlog rather than reading three-minute-old reasoning while you're already five steps further along.

### About the sprites

The original ask was to pull sprites from craftpix.net. Most of that marketplace's packs aren't licensed for redistribution in a public repo, and some are paid, so instead of embedding someone else's licensed art in a repo with your name on it, the mascot is original: plain SVG shapes animated with CSS, no image files, no license to track, loads instantly. If you own a craftpix (or any) sprite sheet you want in its place, drop the PNG in `viewer/assets/` and swap the `<svg>` block in `viewer/index.html` for an `<img>` using the same `idle` / `thinking` / `speaking` / `tool` classes, the animation state machine in `mascot.js` doesn't care what's rendering inside it.

## Setup

Requires Node.js 16+ (already on this machine, Claude Code's own hooks run on it).

```
cd claude-narrator
npm start
```

Then open http://localhost:4317. Leave it running and it picks up new sessions in that project directory automatically, no restart needed.

By default it watches whatever project directory you launch it from (matching Claude Code's own project-folder encoding). Override with:

```
$env:CLAUDE_NARRATOR_DIR = "C:\Users\User\.claude\projects\some-other-project"
npm start
```

### Run it as a standing widget

Pin a browser app window instead of a tab so it feels like part of the OS rather than another browser tab:

```
chrome.exe --app=http://localhost:4317
```

Add `server.js` to a Startup shortcut, or a scheduled task, if it should be running before a session even starts.

## Known limitation: it does not separate clients

Every Claude Code session launched from the same working directory writes into the same project folder on disk, regardless of what it's actually about. That means if two unrelated threads are both active (say, one client's campaign data and another's), both narrate into the same feed. This tool does not attempt content-based separation.

Click a lane's header to collapse it if you don't want it visible. For real isolation, run separate instances against separate `CLAUDE_NARRATOR_DIR` values, or don't leave sensitive threads active while this is pinned on a shared screen.

## Roadmap

- [ ] Subagent lanes, nested under their parent session (currently skipped)
- [ ] Per-lane manual "listen to this one" pin, right now it auto-follows whichever session was most recently active
- [ ] Tray icon / native window instead of a browser tab
- [ ] Desktop notification when a session needs a permission decision
- [ ] Higher-quality voice option (cloud TTS) as an opt-in, deliberately not the default since it costs money and a key, unlike everything else here

## License

MIT
