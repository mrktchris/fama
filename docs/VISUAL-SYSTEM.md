# Fama visual system: Signal Aperture

## Identity

The primary mark is three translucent signals folding through one shared open
center. It represents multiple coding agents, live conversation, and narration
without using a literal microphone, chat bubble, robot, letter, mascot, or gem.

The approved ImageGen source is
`docs/assets/fama-signal-aperture-source.png`. `npm run generate-icon` produces
the optimized runtime derivatives:

- `desktop/icon.ico` for Windows application and installer surfaces;
- `desktop/icon.png` for desktop/tray use;
- `viewer/identity-signal.png` for the header, empty state, and onboarding.

The source prompt intentionally asked for an impossible loop of three
translucent ribbon-like signals, a near-black ground, cobalt/ultraviolet/cyan,
strong small-size silhouette, and no text or literal voice/chat symbols.

## Interface icons

Small controls use the inline SVG symbol family in `viewer/index.html`, not
raster crops. Current symbols cover Messages, Activity, projects, voice, stop,
settings, pin, collapse, user, agent signal, thinking, tool, result, error,
image, and drag. They use currentColor, 1.7px rounded strokes, and no decorative
fill so theme contrast remains predictable.

## Information hierarchy

- **Messages** is the default. Prompts align toward the user edge, agent replies
  remain open and readable, and supporting activity uses expandable cards.
- **Activity** compresses the identical DOM and event record into a technical
  stream. It is a presentation change, never a different data source.
- Session headers keep live state, project/provider identity, following/pinned
  state, rename, reorder, and collapse controls visible without competing with
  the conversation.

## Motion and accessibility

Motion communicates state: a slow aperture breath at idle, small orientation
change while thinking, a short response pulse for tools, and a brighter rhythm
while speaking. New events ease upward by seven pixels. Every animation and
transition collapses under `prefers-reduced-motion` or the manual Reduce motion
setting.

All icon-only buttons have accessible names. The view switch and pin expose
pressed state, session collapse works by keyboard, focus is visually explicit,
long text wraps, and layouts avoid horizontal overflow down to narrow desktop
windows. Do not encode meaning by color alone.
