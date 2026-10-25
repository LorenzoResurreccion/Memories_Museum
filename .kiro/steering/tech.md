# Tech

## Stack

### Frontend (built and shipped)
- **Phaser 4** — game engine. Tilemap rendering, arcade physics, camera, player movement, Y-sort depth, hotspot overlap zones.
- **React 19** — UI layer rendered around and on top of the Phaser canvas. Owns the dialogue box and image viewer overlays.
- **Vite 8** — dev server and bundler. React plugin uses the React Compiler (babel-plugin-react-compiler).
- **Vitest 4** + **@testing-library/react** + **jsdom** — unit and component tests.
- **fast-check 4** — property-based tests (used heavily alongside example-based tests).
- **ESLint 10** — linting, including react-hooks and react-refresh plugins.

### Asset tooling (Python)
- **Tile_Creator/tile_builder.py** — a Pillow (PIL) based CLI that compiles a JSON tile/palette config (`museum_tiles_config.json`) into a master tileset PNG under `Tile_Creator/output/`. Default sheet width is 8 columns at 16px tiles; rows are derived from tile count.

### Backend
- **None.** The game is fully self-contained and static — there is no server. All memory content is authored directly in the Tiled map (`memory_hotspot` objects) and read at runtime by `HotspotManager`. Do not add a backend/API without an explicit decision to change this; the project was intentionally scoped down to a static site.

### Hosting (target)
- **Static hosting** such as Amazon S3 + CloudFront. The build output is a static site. Heavy media (photos/audio) can live in a separate bucket/CDN and be referenced by URL.

## Architecture: the Phaser–React bridge

The game and UI are decoupled and communicate through a single pub/sub singleton, `src/phaser/EventBus.js` (`on` / `off` / `emit`, ordered delivery, events with no subscribers are silently dropped).

Flow:
1. In the Phaser scene, `HotspotManager.checkInteraction()` detects player overlap + an interaction keypress (Space/Enter, edge-detected so a held key fires once) and emits `hotspot-activated` with `{ id, text, imageUrl }`.
2. `GameScene` listens for `hotspot-activated` and freezes the player + locks the hotspot manager.
3. React `App.jsx` also listens for `hotspot-activated`, guards against double activation with a ref, and opens the dialogue and/or image overlay.
4. On dismiss, React emits `dialogue-dismissed` / `image-dismissed`; `GameScene` unfreezes the player and unlocks hotspots.

When adding cross-boundary behavior, extend this event pattern rather than reaching into Phaser objects from React (or vice versa).

## Key engine conventions

- **Tile grid is 16px.** Player sprite frames are 16×32.
- **Feet origin for sorting.** The player and every sortable building/prop sprite use origin `(0.5, 1)`; world Y is the depth sort key, re-sorted every frame in `update()`.
- **Layers:** `ground` (fixed low depth) → `buildings`/`props` (exploded into per-tile sortable sprites) → `collision` (invisible, data only) → `foreground`/overhead (fixed high depth `10000`). Collision is set by exclusion of empty tiles (`-1`, `0`).
- **Maps come from Tiled** as JSON. Hotspots are Tiled objects of type `memory_hotspot`; the player start is a `player_spawn` object in the `spawn` object layer.
- **Graceful asset failures.** The scene tracks load errors and renders a readable error message instead of crashing. Preserve this when touching `preload()`/`create()`.
- **Camera** uses integer zoom (2x) and is bounded to the map; it follows the player.

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
