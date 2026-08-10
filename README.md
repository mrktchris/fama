# claude-narrator

A local, always-on window into what Claude Code is actually doing right now: what it's thinking, which tool it just ran, what came back. No API calls, no extra tokens, no cloud dependency. It tails the session transcript files Claude Code already writes to `~/.claude/projects/`, on your own machine, and nothing else.

## Why

Claude Code already streams everything it does into the chat pane. But that view disappears the moment you switch windows, and there's no ambient way to glance at several active sessions at once. claude-narrator is a second, always-visible surface for that same activity: pin it on a second monitor and watch what's happening across your active sessions without keeping the chat pane in focus.

## How it works

1. Claude Code (and Claude Desktop) write one JSONL transcript file per session under `~/.claude/projects/<encoded-project-path>/`.
2. `server.js` watches that directory, tails new lines as they're appended (byte-offset based, it never re-reads history), and normalizes each into a small event: a line of text, a thinking snippet, a tool call, a tool result, or an error.
3. Those events stream to the browser over Server-Sent Events. The viewer groups them into one lane per active session and lets them scroll live.

Nothing leaves the machine. No API key required, because this never talks to Claude, it only reads files Claude Code already writes locally.

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
- [ ] Thinking-block collapse toggle, on by default right now
- [ ] Tray icon / native window instead of a browser tab
- [ ] Desktop notification when a session needs a permission decision

## License

MIT
