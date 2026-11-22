# Structure

The repo has three top-level code areas: the game client, the login function, and an asset-generation tool. The game is a static site; the only server-side piece is the small login function (spec: `.kiro/specs/museum-login`; built and tested locally, AWS deploy pending).

```text
Memories_Museum/
├── Front-end/                 # React + Phaser game client (Vite)
├── Auth-function/             # Museum login (AWS Lambda, Node ESM): own package.json, tests, esbuild bundle
├── Memories/                  # Private content (git-ignored): dialogue/*.md, photos, paintings — fetched by URL, served from S3
├── Tile_Creator/              # Python tileset generator (Pillow)
├── docs/                      # Project docs
└── .kiro/                     # Steering, specs, hooks
```

## Front-end/ (the working app)

```text
Front-end/
├── index.html                 # favicon: public/pixel_icon.png
├── package.json               # scripts: dev, dev:auth, build, preview, lint, test
├── eslint.config.js           # browser globals for src/; Node globals for dev/ and the configs
├── vite.config.js             # adds dev/authDemoPlugin.js only in --mode demo
├── .env.production            # VITE_AUTH_ENABLED=true (no secrets: VITE_* is public)
├── .env.demo                  # VITE_AUTH_ENABLED=true for npm run dev:auth
├── dev/
│   ├── authDemoPlugin.js      # Demo_Mode: CloudFront + Lambda stand-in for the dev server (never bundled)
│   └── __tests__/
├── public/
│   ├── border.jpg             # wooden frame around the game window (9-slice, see App.css)
│   ├── pixel_icon.png         # favicon
│   ├── Memories -> ../../Memories   # git-ignored local symlink for dev
│   └── assets/                # pixel assets only — tiny footprint
│       ├── maps/              # Tiled-exported .json maps
│       ├── tilesets/          # 16px tileset .png
│       ├── sprites/           # character walk sheets (32×32 frames, 4×4): Lorenzo (player), Kelly (follower)
│       └── photos/            # bundled placeholder painting texture (heavy media stays external)
└── src/
    ├── main.jsx               # React entry: renders <StartupGate><App /></StartupGate>
    ├── App.jsx                # top-level controller: owns overlay state, bridges EventBus
    ├── App.css                # page layout + the wooden frame around the canvas (CSS variables)
    ├── components/
    │   ├── StartupGate.jsx    # checking -> login | loading -> ready; renders App only when ready
    │   ├── LoginScreen.jsx    # username/password, then 3 questions one at a time
    │   ├── loginMessages.js   # every login message, in one place
    │   ├── GameCanvas.jsx     # mounts/destroys the Phaser.Game instance
    │   ├── DialogueBox.jsx    # paged sentimental text overlay (fixed-size box)
    │   ├── ImageViewer.jsx    # high-res photo overlay
    │   └── __tests__/         # component + integration + property tests
    ├── data/
    │   ├── authClient.js      # AUTH_ENABLED, session probe, start/finish login (body-hash header)
    │   ├── loadMemories.js    # startup fetch of Memories/dialogue/NN.md -> MEMORIES (N = first missing)
    │   ├── memories.js        # MEMORIES live manifest (empty until loaded) + setMemories() + future-memory text
    │   ├── paintings.js       # PAINTINGS derived from MEMORIES (syncPaintings) + placeholder key
    │   ├── mediaBase.js       # MEDIA_BASE_URL + photoUrl()/paintingUrl()/dialogueUrl() — one place to repoint media
    │   └── __tests__/
    ├── __tests__/             # cross-cutting tests (e.g. map conversion)
    └── phaser/
        ├── config.js          # Phaser game config (canvas size, scale/centering)
        ├── GameScene.js       # map loading, player spawn, layers, Y-sort, camera, input, segment wiring
        ├── PlayerController.js # movement + animations, freeze/unfreeze, two-sided + vertical clamp
        ├── FollowerController.js # Kelly: trails the player's path, settles beside them, freezes on overlays
        ├── followerTrail.js    # pure trail math (record, replay, trim, facing, depth, settle helpers)
        ├── followerCollision.js # pure footprint/overlap/sweep + settle target choice
        ├── CollisionBuilder.js # static collision bodies from per-tile objectgroup shapes
        ├── SegmentManager.js   # bounded procedural hallway segment generation/recycling
        ├── InteractionManager.js # E-key edge detection, zone registry, emits hotspot-activated
        ├── PromptLabel.js      # floating [E] prompt pinned above the player
        ├── memoryResolve.js    # zone ordering + memory-index resolution against MEMORIES
        ├── paintingResolve.js  # object type partition + painting ordering/image resolution
        ├── EventBus.js         # pub/sub singleton bridging Phaser <-> React
        └── __tests__/          # scene/manager/eventbus property + example tests
```

### Where things live
- **React owns UI/overlays** (`components/`). It never manipulates Phaser objects directly.
- **Phaser owns the game world** (`phaser/`). It never imports React.
- **The only cross-boundary channel is `EventBus`.** Add new Phaser↔React interactions as named events, not direct references.
- **`App.jsx` is the coordinator** — it subscribes to game events and drives overlay state.
- **`StartupGate` owns what happens before the museum** (session probe, login, loading the letters) and mounts `App` only when ready. Don't move sign-in logic into `App.jsx`.
- **Pixel assets go in `public/assets/`**; heavy media (photos/audio) does not — reference it by URL.

## Memory content (no backend)

There is no API or separate data store, and no personal content in the code. All of it lives in the git-ignored `Memories/` folder (`dialogue/NN.md`, `photos/NN.jpg`, `paintings/NN.png`), uploaded beside the app. At startup `src/data/loadMemories.js` fetches the letters (pages split on a line containing only `---`), sets N to the first missing index, and fills `MEMORIES` (`src/data/memories.js`) in place — a plain object keyed by contiguous `Memory_Index` (`0 .. N-1`), each entry carrying `text` (dialogue pages) and `imageUrl` (`photoUrl(i)`). `PAINTINGS` (`src/data/paintings.js`) is then rebuilt from it — one `{ key: painting_NN, url }` per memory, plus `PAINTING_PLACEHOLDER_KEY` — and loaded in `GameScene.preload()`. Both are filled before the Phaser game is created, so game code reads them synchronously.

**Media base.** `src/data/mediaBase.js` exports `MEDIA_BASE_URL` (from `VITE_MEDIA_BASE_URL`, else `/Memories`) and the `photoUrl(i)` / `paintingUrl(i)` / `dialogueUrl(i)` helpers, so every content path derives from one place: `<base>/dialogue/NN.md`, `<base>/photos/NN.jpg`, `<base>/paintings/NN.png`. Repointing between local dev (the git-ignored `public/Memories` symlink) and the deployed S3 bucket is a one-line change. Adding a memory = drop `NN.md` (+ photo, painting) in `Memories/` and upload; no code edit, no rebuild. A missing painting shows the placeholder; a gap in dialogue numbers ends the hallway there.

The Tiled `Object Layer 1` is **type-partitioned**: each object's Tiled class (`type ?? class`) must be `memory_zone` (becomes an interaction zone, sized to its authored rectangle) or `painting` (becomes wall art, stretched to its rectangle); any other/untyped object is ignored by both. The segment build step resolves each zone to a manifest entry via `memoryResolve.js`, or to the "future memory" placeholder when the zone index is `>= N`, and resolves each painting's image via `paintingResolve.js`. Zone indexing runs over `memory_zone` objects ONLY, so adding paintings never shifts `Memory_Index`. `N` (the authored count) drives the hallway's right bound. The small bundled placeholder painting lives in `public/assets/photos/`.

## Tile_Creator/ (asset generation)

```text
Tile_Creator/
├── tile_builder.py            # PIL CLI: JSON config -> master tileset PNG
├── museum_tiles_config.json   # palette + per-tile pixel layout definitions
└── output/                    # generated tileset image(s)
```

Compiles a JSON palette + tile layout into a 16px-grid tileset sheet (default 8 columns, rows derived from tile count). Generated sheets feed `Front-end/public/assets/tilesets/`.

## Auth-function/ (museum login)

```text
Auth-function/
├── package.json               # scripts: test, lint, build (Node ESM, own deps)
├── eslint.config.js           # Node globals
├── scripts/build.mjs          # esbuild: src/handler.js -> dist/handler.mjs (everything bundled)
├── src/
│   ├── handler.js             # Lambda entry: createHandler() + handler; the two /api/login routes
│   ├── checks.js              # compare an attempt to the hashed Auth_Config (all comparisons run)
│   ├── normalize.js           # answer / username normalization
│   ├── hashing.js             # salted scrypt hash + constant-time verify
│   ├── cookies.js             # the 3 CloudFront signed cookies (12-hour policy)
│   ├── limiter.js             # in-memory per-IP attempt limiter
│   └── config.js              # read + validate the Lambda environment variables
├── tools/make-config.mjs      # local setup tool: hashed AUTH_CONFIG / Demo_Config
├── demo/                      # git-ignored: Demo_Config for npm run dev:auth
├── dist/                      # git-ignored: build output
└── __tests__/                 # property + example tests; helpers.js holds shared fixtures
```

Never depends on `Front-end/`. Secrets reach it only as Lambda environment variables (spec Req 9). Run its commands from `Auth-function/`: `npm run test`, `npm run lint`, `npm run build`. Everything takes its environment, clock, signer, limiter and verify function as options (`createHandler({...})`), so tests and Demo_Mode run the exact production code.

## Conventions

- **Tests** live in `__tests__/` folders next to the code they cover, named `*.test.{js,jsx}`; property-based variants use `*.property.test.*`.
- **File naming:** React components in PascalCase `.jsx` with a matching `.css`; Phaser modules in PascalCase `.js`; the shared `EventBus` and `config` are lowercase.
- **Module style:** ES modules throughout the frontend. React = functional components + hooks. Phaser scenes/managers = ES classes with JSDoc.
- **Keep the boundary clean:** game logic in `phaser/`, presentation in `components/`, content loading, manifests and the login client in `data/` (personal content itself only in `Memories/`), startup order in `StartupGate`, coordination in `App.jsx`, communication over `EventBus`, dev-server-only code in `dev/`.
- **Component CSS keeps its own look:** a component's styling lives only in its matching `.css` (e.g. restyle the login in `LoginScreen.css` without touching `LoginScreen.jsx`). Shared colors are the frame-tile palette (see tech.md).
- **Asset naming:** maps load under the cache keys `museum_start` / `museum_hallway` from the files `museum_start_v2.json` / `museum_hallway_v2.json` (`MAP_FILES` in `GameScene.js`); tilesets are `museum_tileset` (firstgid 1) / `museum_decor` (firstgid 41) / `museum_tileset_greige_16x16_2x5-v2` (firstgid 65, listed in `EXTRA_TILESETS`). Keep each tileset `name` in the Tiled JSON matching the image key (and `.png` file name) loaded in `GameScene.preload()`.
