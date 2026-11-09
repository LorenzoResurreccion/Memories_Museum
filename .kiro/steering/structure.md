# Structure

The repo has two top-level areas: the game client and an asset-generation tool. The game is a static, self-contained site — there is no backend.

```text
Memories_Museum/
├── Front-end/                 # React + Phaser game client (Vite)
├── Memories/                  # Private content (git-ignored): photos, paintings, dialogue — served from S3
├── Tile_Creator/              # Python tileset generator (Pillow)
├── docs/                      # Project docs
└── .kiro/                     # Steering, specs, hooks
```

## Front-end/ (the working app)

```text
Front-end/
├── index.html
├── package.json               # scripts: dev, build, preview, lint, test
├── eslint.config.js
├── public/
│   └── assets/                # pixel assets only — tiny footprint
│       ├── maps/              # Tiled-exported .json maps
│       ├── tilesets/          # 16px tileset .png
│       ├── sprites/           # character walk sheets (32×32 frames, 4×4)
│       └── photos/            # bundled placeholder painting texture (heavy media stays external)
└── src/
    ├── main.jsx               # React entry
    ├── App.jsx                # top-level controller: owns overlay state, bridges EventBus
    ├── components/
    │   ├── GameCanvas.jsx     # mounts/destroys the Phaser.Game instance
    │   ├── DialogueBox.jsx    # paged sentimental text overlay
    │   ├── ImageViewer.jsx    # high-res photo overlay
    │   └── __tests__/         # component + integration + property tests
    ├── data/
    │   ├── memories.js        # MEMORIES manifest (dialogue text + photo URL) + future-memory text
    │   ├── paintings.js       # PAINTINGS source (per-memory wall art key + URL) + placeholder key
    │   ├── mediaBase.js       # MEDIA_BASE_URL + photoUrl()/paintingUrl() — one place to repoint media
    │   └── __tests__/
    ├── __tests__/             # cross-cutting tests (e.g. map conversion)
    └── phaser/
        ├── config.js          # Phaser game config (canvas size, scale/centering)
        ├── GameScene.js       # map loading, player spawn, layers, Y-sort, camera, input, segment wiring
        ├── PlayerController.js # movement + animations, freeze/unfreeze, two-sided + vertical clamp
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
- **Pixel assets go in `public/assets/`**; heavy media (photos/audio) does not — reference it by URL.

## Memory content (no backend)

There is no API or separate data store. Memory content lives in a static ES module, `src/data/memories.js` — the `MEMORIES` manifest, a plain object keyed by contiguous `Memory_Index` (`0 .. N-1`), each entry carrying `text` (dialogue pages, bundled) and `imageUrl` (the photo URL, or `null`). A parallel static module, `src/data/paintings.js` — the `PAINTINGS` source keyed by the same `Memory_Index` plus `PAINTING_PLACEHOLDER_KEY` — maps each memory to its wall-art texture `key` and `url`, loaded in `GameScene.preload()`.

**Media base.** The heavy media (photos + paintings) is NOT bundled; it lives in the git-ignored `Memories/` folder and is referenced by URL. `src/data/mediaBase.js` exports `MEDIA_BASE_URL` (from `VITE_MEDIA_BASE_URL`, else `/Memories`) and the `photoUrl(i)` / `paintingUrl(i)` helpers, so every media path derives from one place: `<base>/photos/NN.jpg`, `<base>/paintings/NN.png`. Repointing between local dev and the deployed S3 bucket is a one-line change. Dialogue `text` is the exception — it is small and ships inside `memories.js`. Adding/removing a memory = edit `memories.js`/`paintings.js` + drop files in `Memories/`; the hallway resizes to `N` automatically.

The Tiled `Object Layer 1` is **type-partitioned**: each object's Tiled class (`type ?? class`) must be `memory_zone` (becomes an interaction zone, sized to its authored rectangle) or `painting` (becomes wall art, stretched to its rectangle); any other/untyped object is ignored by both. The segment build step resolves each zone to a manifest entry via `memoryResolve.js`, or to the "future memory" placeholder when the zone index is `>= N`, and resolves each painting's image via `paintingResolve.js`. Zone indexing runs over `memory_zone` objects ONLY, so adding paintings never shifts `Memory_Index`. `N` (the authored count) drives the hallway's right bound. The small bundled placeholder painting lives in `public/assets/photos/`.

## Tile_Creator/ (asset generation)

```text
Tile_Creator/
├── tile_builder.py            # PIL CLI: JSON config -> master tileset PNG
├── museum_tiles_config.json   # palette + per-tile pixel layout definitions
└── output/                    # generated tileset image(s)
```

Compiles a JSON palette + tile layout into a 16px-grid tileset sheet (default 8 columns, rows derived from tile count). Generated sheets feed `Front-end/public/assets/tilesets/`.

## Conventions

- **Tests** live in `__tests__/` folders next to the code they cover, named `*.test.{js,jsx}`; property-based variants use `*.property.test.*`.
- **File naming:** React components in PascalCase `.jsx` with a matching `.css`; Phaser modules in PascalCase `.js`; the shared `EventBus` and `config` are lowercase.
- **Module style:** ES modules throughout the frontend. React = functional components + hooks. Phaser scenes/managers = ES classes with JSDoc.
- **Keep the boundary clean:** game logic in `phaser/`, presentation in `components/`, static content in `data/`, coordination in `App.jsx`, communication over `EventBus`.
- **Asset naming:** maps are `museum_start` / `museum_hallway`; tilesets are `museum_tileset` (firstgid 1) / `museum_decor` (firstgid 41). Keep each tileset `name` in the Tiled JSON matching the image key loaded in `GameScene.preload()`.
