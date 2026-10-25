# Product

## What this is

The Living Museum is a bespoke, interactive 2.5D retro side-scrolling game built as a personalized anniversary gift. A player controls a 16-bit character sprite and explores a warm-cream art gallery. Walking up to framed pixel canvases and pressing an interaction key opens a React UI overlay that shows a real-life couple photo and sentimental dialogue letters.

It is a gift first and a software project second. It is a single-purpose, single-audience experience, not a general-purpose game engine or reusable product.

## Core experience

- **Explore the gallery** — move left/right and up/down across the floor with arrow keys or WASD. The player can walk in front of or behind benches, props, and building pieces via dynamic Y-sorting.
- **Discover memories** — invisible hotspot zones sit in front of canvases. Standing on one and pressing Space or Enter activates it.
- **Read and reflect** — an activated hotspot opens a dialogue box (paged sentimental text) and/or an image viewer (a high-res photo). Game input freezes while an overlay is open and resumes on dismiss.

## Design priorities

1. **Emotional payoff over feature breadth.** Every decision serves the moment of walking up to a canvas and reading a memory. Do not add gameplay systems that dilute that.
2. **Pixel-perfect retro feel.** Integer camera zoom, 16px tile grid, crisp pixel art. Avoid anything that introduces sub-pixel blur.
3. **Smooth, seamless overlays.** The Phaser-to-React handoff should feel instant and never show jank, double-activation, or a stuck frozen player.
4. **Keep the runtime light.** Heavy media (photos, audio) is decoupled from the game bundle and served externally so the game stays fast to load.

## Content model

A memory is authored as a hotspot with:
- `id` — stable identifier for the memory
- `text` — an array of dialogue pages (sentimental letter content)
- `imageUrl` — optional link to the high-res photo

Hotspots missing an `id` or `text` are skipped. A hotspot with neither text nor image shows nothing and does not freeze the player.

## Audience and scope

- Audience: one person (the recipient). Copy, tone, and content are personal and intentional.
- Not in scope: multiplayer, accounts, scoring, save systems, or configurability for other users. If a request implies turning this into a reusable or multi-user product, confirm intent before building it.
