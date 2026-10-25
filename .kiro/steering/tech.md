# Tech

## Stack

### Frontend (built and shipped)
- **Phaser 4** — game engine. Tilemap rendering, arcade physics, camera, player movement, Y-sort depth, interaction overlap zones, bounded procedural hallway segment generation.
- **React 19** — UI layer rendered around and on top of the Phaser canvas. Owns the dialogue box and image viewer overlays.
- **Vite 8** — dev server and bundler. React plugin uses the React Compiler (babel-plugin-react-compiler).
- **Vitest 4** + **@testing-library/react** + **jsdom** — unit and component tests.
- **fast-check 4** — property-based tests (used heavily alongside example-based tests).
- **ESLint 10** — linting, including react-hooks and react-refresh plugins.

### Asset tooling (Python)
- **Tile_Creator/tile_builder.py** — a Pillow (PIL) based CLI that compiles a JSON tile/palette config (`museum_tiles_config.json`) into a master tileset PNG under `Tile_Creator/output/`. Default sheet width is 8 columns at 16px tiles; rows are derived from tile count.

### Backend
- **None.** The game is fully self-contained and static — there is no server. All memory content is authored directly in the app as a static ES module (`src/data/memories.js`, the `MEMORIES` manifest) and read at runtime by the segment/interaction subsystems. Do not add a backend/API without an explicit decision to change this; the project was intentionally scoped down to a static site.

### Hosting (target)
- **Static hosting** such as Amazon S3 + CloudFront. The build output is a static site. Heavy media (photos/audio) can live in a separate bucket/CDN and be referenced by URL.

## Architecture: the Phaser–React bridge

The game and UI are decoupled and communicate through a single pub/sub singleton, `src/phaser/EventBus.js` (`on` / `off` / `emit`, ordered delivery, events with no subscribers are silently dropped).

Flow:
1. In the Phaser scene, `InteractionManager.checkInteraction()` detects player overlap of a zone + the interaction key `E` (edge-detected so a held key fires once; Space/Enter/Esc are never open keys) and emits `hotspot-activated` with `{ id, text, imageUrl }` resolved from the `MEMORIES` manifest.
2. `GameScene` listens for `hotspot-activated` and freezes the player + locks the `InteractionManager`.
3. React `App.jsx` also listens for `hotspot-activated`, guards against double activation with a ref, and opens the dialogue and/or image overlay.
4. On dismiss, React emits `dialogue-dismissed` / `image-dismissed`; `GameScene` unfreezes the player and unlocks interaction.

When adding cross-boundary behavior, extend this event pattern rather than reaching into Phaser objects from React (or vice versa).

## Key engine conventions

- **Tile grid is 16px.** Player sprite frames are 16×32. Maps are 58×15 tiles (928×240 px).
- **Feet origin for sorting.** The player and every sortable decor sprite use origin `(0.5, 1)`; world Y is the depth sort key, re-sorted every frame in `update()`.
- **Layers:** `Tile Layer 1` (floor + back wall, fixed low depth `FLOOR_DEPTH` = 0, drawn beneath everything) → `Tile Layer 2` (decor, exploded into per-tile Y-sortable sprites) → optional `foreground`/overhead (fixed high depth `10000`). There is **no collision tile layer**: collision is derived by `CollisionBuilder` from per-tile collision shapes (`objectgroup`) embedded in the tilesets, built as static bodies for both tile layers.
- **Maps come from Tiled** as JSON (`museum_start` = fixed left end, `museum_hallway` = the repeating segment template). Interaction zones are Tiled object-layer points; each marks the left edge of a 3-tile framed canvas. The player start is a `player_spawn` object in the spawn object layer, with an in-bounds floor fallback.
- **Interaction zones** span the full 3-tile frame (`ZONE_WIDTH_PX`/`ZONE_HEIGHT_PX` = 48px) so the prompt/activation works anywhere along a canvas, not just its left tile.
- **Graceful asset failures.** The scene tracks load errors and renders a readable error message instead of crashing. Preserve this when touching `preload()`/`create()`.
- **Canvas & camera.** Canvas is 1120×480; camera uses integer zoom (2×) and follows the player. The canvas height is the map height (240px) × zoom (2) so the viewport's world height matches the map exactly — this avoids a black band below the floor. Scale mode is `NONE` with `CENTER_BOTH` auto-centering. The camera's left bound is pinned at the start-map left edge; the right bound grows as segments generate and is capped at the final segment's right edge.

## Infinite hallway

The gallery is a bounded, procedurally-stitched hallway rather than a single fixed map:
- **`SegmentManager`** generates, positions, counts, and recycles hallway segments as the player moves, bounded on the right at `Final_Segment_Index = N >= 1 ? floor((N-1)/6) : 0` where `N` is the number of authored memories. Max 3 segments are instantiated at once. Pure index/offset arithmetic is testable without a live scene; scene-touching work is injected via `buildSegment`/`releaseSegment` closures in `GameScene`.
- **`memoryResolve.js`** (`assignZoneIndices`, `resolveZonePayload`) orders a segment's zones deterministically and maps each to a `MEMORIES` entry, or to the "future memory" placeholder (`FUTURE_MEMORY_OVERLAY`) when the zone index is `>= N`.
- **`InteractionManager`** owns the `E` key edge detection, registers/releases each segment's zones, reports overlap (drives `PromptLabel`), and emits `hotspot-activated`.
- **`PromptLabel`** is the floating `[E]` prompt pinned above the player, shown iff the player overlaps a zone and no overlay is open.

## Commands

Run frontend commands from `Front-end/`:

```bash
npm install        # install dependencies
npm run dev        # Vite dev server (run manually in your terminal)
npm run build      # production build
npm run preview    # preview the production build
npm run test       # vitest --run (single pass, no watch)
npm run lint       # eslint
```

Asset tooling, from `Tile_Creator/`:

```bash
python tile_builder.py   # compile the tileset PNG from the JSON config
```

## Conventions and guardrails

- Prefer `npm run test` (single run) over watch mode. Do not start long-running dev servers or watchers on the user's behalf — hand the user the command to run.
- Match existing style: ES modules, functional React components with hooks, class-based Phaser scene/manager modules with JSDoc.
- When adding features or fixing bugs, add both example-based and property-based (fast-check) tests to match the existing test suite's style, and run the suite before declaring done.
- Keep heavy media out of the game bundle; reference it by URL.
