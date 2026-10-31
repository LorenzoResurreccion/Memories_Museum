# Product

## What this is

The Living Museum is a bespoke, interactive 2.5D retro side-scrolling game built as a personalized anniversary gift. A player controls a 16-bit character sprite and explores a warm-cream art gallery. Walking up to framed pixel canvases and pressing an interaction key opens a React UI overlay that shows a real-life couple photo and sentimental dialogue letters.

It is a gift first and a software project second. It is a single-purpose, single-audience experience, not a general-purpose game engine or reusable product.

## Core experience

- **Explore the gallery** — move left/right and up/down across the floor with arrow keys or WASD. The player can walk in front of or behind benches, props, and building pieces via dynamic Y-sorting.
- **Discover memories** — invisible interaction zones sit in front of canvases, each spanning the full width of a framed canvas. Standing on one shows a floating `[E]` prompt; pressing `E` activates it.
- **See the memory on the wall** — every framed canvas displays a pixel-art painting for its memory, so a memory is represented both by its floor zone and by the art hanging in its frame. Paintings are purely visual (no interaction, no collision).
- **Read and reflect** — an activated hotspot opens a dialogue box (paged sentimental text) and/or an image viewer (a high-res photo). Game input freezes while an overlay is open and resumes on dismiss.

## Design priorities

1. **Emotional payoff over feature breadth.** Every decision serves the moment of walking up to a canvas and reading a memory. Do not add gameplay systems that dilute that.
2. **Pixel-perfect retro feel.** Integer camera zoom, 16px tile grid, crisp pixel art. Avoid anything that introduces sub-pixel blur.
3. **Smooth, seamless overlays.** The Phaser-to-React handoff should feel instant and never show jank, double-activation, or a stuck frozen player.
4. **Keep the runtime light.** Heavy media (photos, audio) is decoupled from the game bundle and served externally so the game stays fast to load.

## Content model

Memories are authored in a static manifest (`src/data/memories.js`, `MEMORIES`), keyed by contiguous index `0 .. N-1`. Each entry carries:
- `text` — an array of dialogue pages (sentimental letter content)
- `imageUrl` — optional link to the high-res photo (`null` if none)

Each memory also has a painting, authored in a parallel static source (`src/data/paintings.js`, `PAINTINGS`), keyed by the same `Memory_Index`. A frame with no authored art (or a "future memory") shows a placeholder.

The real photos and pixel paintings are the recipient's actual content and are kept private — they live in the git-ignored `Memories/` folder (not the repo, not the bundle) and are served by URL from the same place as the app. Only the small dialogue text ships in the manifest. Adding or removing a memory is just editing the two manifests and dropping the files in `Memories/`; the hallway resizes itself to the authored count.

When a memory opens, the photo appears centered (about the height of the map) and stays visible while the recipient reads through the letter page by page; finishing the letter closes the photo with it. The photo never dims or covers the text.

The gallery is a bounded, procedurally-stitched "infinite hallway": the authored count `N` sets how far it extends. Interaction zones beyond the authored memories resolve to a single "future memory" placeholder page rather than showing nothing. A zone always opens an overlay (authored or future) and freezes the player while open.

## Audience and scope

- Audience: one person (the recipient). Copy, tone, and content are personal and intentional.
- Not in scope: multiplayer, accounts, scoring, save systems, or configurability for other users. If a request implies turning this into a reusable or multi-user product, confirm intent before building it.
