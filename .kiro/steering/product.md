# Product

## What this is

The Living Museum is a bespoke, interactive 2.5D retro side-scrolling game built as a personalized anniversary gift. A player controls a 16-bit character sprite and explores a warm-cream art gallery. Walking up to framed pixel canvases and pressing an interaction key opens a React UI overlay that shows a real-life couple photo and sentimental dialogue letters.

It is a gift first and a software project second. It is a single-purpose, single-audience experience, not a general-purpose game engine or reusable product.

## Core experience

- **Sign in** — before the museum opens, she enters the username and password she was given, then answers three questions about the relationship, one at a time. Answers forgive case, spacing and punctuation; if she gets stuck, the gift-giver tells her. She signs in once per browser session (a refresh keeps her in; closing the browser signs her out). The sign-in is a cute part of the gift, but the password also genuinely locks the letters, photos and paintings: they can't be fetched without it.
- **Explore the gallery** — move left/right and up/down across the floor with arrow keys or WASD. The player can walk in front of or behind benches, props, and building pieces via dynamic Y-sorting.
- **Walk together** — Kelly, a companion sprite, follows a few steps behind along the path the player walked, steps aside to stand beside the player when they stop, and pauses while a memory is open. She is purely visual: no collision, no interaction.
- **Discover memories** — invisible interaction zones sit in front of canvases, each spanning the full width of a framed canvas. Standing on one shows a floating `[E]` prompt; pressing `E` activates it.
- **See the memory on the wall** — every framed canvas displays a pixel-art painting for its memory, so a memory is represented both by its floor zone and by the art hanging in its frame. Paintings are purely visual (no interaction, no collision).
- **Read and reflect** — an activated hotspot opens a dialogue box (paged sentimental text) and/or an image viewer (a high-res photo). Game input freezes while an overlay is open and resumes on dismiss.

## Design priorities

1. **Emotional payoff over feature breadth.** Every decision serves the moment of walking up to a canvas and reading a memory. Do not add gameplay systems that dilute that.
2. **Pixel-perfect retro feel.** Integer camera zoom, 16px tile grid, crisp pixel art. Avoid anything that introduces sub-pixel blur.
3. **Smooth, seamless overlays.** The Phaser-to-React handoff should feel instant and never show jank, double-activation, or a stuck frozen player.
4. **Keep the runtime light.** Heavy media (photos, audio) is decoupled from the game bundle and served externally so the game stays fast to load.
5. **Private by default.** The memories are hers alone: nothing personal in git or the bundle, and nothing under `/Memories/*` served without the sign-in.

## Content model

Every memory is a set of files in the private, git-ignored `Memories/` folder, named by contiguous index `0 .. N-1`:
- `dialogue/NN.md` — the letter, split into dialogue pages by lines containing only `---`
- `photos/NN.jpg` — the high-res photo
- `paintings/NN.png` — the pixel art in that memory's frame (a frame with no art, or a "future memory", shows a placeholder)

The letters, photos and paintings are the recipient's actual content and are kept private: none of it is in the repo or the bundle. The `Memories/` folder is uploaded as-is beside the app and the game fetches it by URL, loading the letters at startup into the `MEMORIES` manifest. Adding a memory is just dropping its files in `Memories/` and uploading; the hallway resizes itself to the number of letters, with no code change.

When a memory opens, the photo appears centered (about the height of the map) and stays visible while the recipient reads through the letter page by page; finishing the letter closes the photo with it. The photo never dims or covers the text.

The game window sits in a dark wooden frame with gold corner flourishes, and the login panel, dialogue box and photo viewer share its brown-and-gold palette. The dialogue box keeps a steady size under the frame, so the letter doesn't jump around from page to page.

The gallery is a bounded, procedurally-stitched "infinite hallway": the authored count `N` sets how far it extends. Interaction zones beyond the authored memories resolve to a single "future memory" placeholder page rather than showing nothing. A zone always opens an overlay (authored or future) and freezes the player while open.

## Audience and scope

- Audience: one person (the recipient). Copy, tone, and content are personal and intentional.
- Not in scope: multiplayer, accounts, scoring, save systems, or configurability for other users. The single sign-in (one username, one password, three fixed questions) is not an account system: no sign-up, no reset, no "remember me", no sign-out button. If a request implies turning this into a reusable or multi-user product, confirm intent before building it.
