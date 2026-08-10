# Changelog

All notable changes to this project, newest first. Versions match `package.json` and the git tags each commit was made under.

## 0.5.0

- **Usage tracker.** New section at the top of Settings, running $ total for this OpenAI key on this machine (TTS characters + rewrite tokens, priced against OpenAI's published rates), with a reset button that only zeroes the local counter, it has no effect on real billing.
- **Narration length is now a continuous 3-30s slider**, not fixed presets, with a live word-count and cost estimate that updates as you drag it. Calibration was actually broken on the first pass (short end ran long, long end got cut off), both were real bugs, both fixed and reverified against real API responses, not just re-read code.
- **Speed slider now drives both voices at once.** One control instead of two, applies live with no Save needed, sent through to the cloud voice as OpenAI's own `speed` parameter and to the local fallback as `utterance.rate`.
- **"Attached" badge** on whichever session lane is currently the one that would speak next, the honest answer to "which thread are you on": this tool only knows which session is doing something right now, not which window has your focus.
- **Thinking/tools toggles and speech rate now persist across reloads** (localStorage), previously reset to defaults every time the page reloaded.
- Rewrite prompt tightened (hard word limit stated twice, lower temperature) after testing showed the model was ignoring the original soft limit by more than 2x.
- Confirmed via full git history audit, including the remote: no API key has ever been committed, `.env` is gitignored from before any real key ever touched disk, and the shipped `.env.example` is blank so anyone else cloning this gets zero pre-filled credentials, they configure their own key from Settings or `.env`.

## 0.4.0

- **Settings panel in the UI.** Gear icon in the header opens a modal to paste an OpenAI key, pick model/voice, and toggle rewrite, no more hand-editing `.env` required (though that still works fine too, the panel just writes the same file).
- **Live rewrite step.** When cloud voice is on, `thinking` and `text` events get a fast pass through `gpt-4o-mini` before being spoken, turning raw internal-monologue prose into one short, natural spoken sentence instead of reading it verbatim. Falls back to the raw text if the rewrite call fails.
- **Lower latency.** Transcript poll interval cut from 700ms to 250ms.
- **Header decluttered.** Speech-behavior toggles (thinking/tools) and the fallback-voice picker moved out of the header into the Settings modal, keeping the main view to just the mascot, status, voice-mode badge, enable button, and the gear icon.

## 0.3.0

- Optional OpenAI cloud voice (`tts-1-hd` by default), server-side, with automatic graceful fallback to the free local voice if the cloud call ever fails for any reason (bad key, no credits, network blip). Configured via `.env`.
- Cost math and setup steps documented in the README.

## 0.2.0

- Animated SVG mascot in the header: idle (blink/bob), thinking (pulsing dot trail), speaking (mouth-flap), tool (brief color pulse). Fully original, no external image assets, see the README section on why.
- Spoken narration via the browser's built-in Web Speech API (free, zero setup). Thinking spoken by default, tool calls off by default.
- Full visual redesign: responsive lane grid, glow states, custom toggle switches, live pulse indicators, custom scrollbars.

## 0.1.0

- Initial local live viewer. Tails Claude Code's own session transcripts (`~/.claude/projects/**/*.jsonl`) and streams events to a browser over Server-Sent Events. Zero dependencies, zero API calls, loopback-only.
