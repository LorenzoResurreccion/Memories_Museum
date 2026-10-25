# Structure

The repo has two top-level areas: the game client and an asset-generation tool. The game is a static, self-contained site — there is no backend.

```text
Memories_Museum/
├── Front-end/                 # React + Phaser game client (Vite)
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
│       └── sprites/           # character walk sheets (16×32 frames)
└── src/
    ├── main.jsx               # React entry
    ├── App.jsx                # top-level controller: owns overlay state, bridges EventBus
    ├── components/
    │   ├── GameCanvas.jsx     # mounts/destroys the Phaser.Game instance
    │   ├── DialogueBox.jsx    # paged sentimental text overlay
    │   ├── ImageViewer.jsx    # high-res photo overlay
    │   └── __tests__/         # component + integration + property tests
    └── phaser/
        ├── config.js          # Phaser game config
        ├── GameScene.js       # map loading, player spawn, layers, Y-sort, camera, input
        ├── PlayerController.js # movement + animations, freeze/unfreeze
        ├── HotspotManager.js  # loads memory_hotspot zones, emits hotspot-activated
        ├── EventBus.js        # pub/sub singleton bridging Phaser <-> React
        └── __tests__/         # scene/manager/eventbus property + example tests
```

### Where things live
- **React owns UI/overlays** (`components/`). It never manipulates Phaser objects directly.
- **Phaser owns the game world** (`phaser/`). It never imports React.
- **The only cross-boundary channel is `EventBus`.** Add new Phaser↔React interactions as named events, not direct references.
- **`App.jsx` is the coordinator** — it subscribes to game events and drives overlay state.
- **Pixel assets go in `public/assets/`**; heavy media (photos/audio) does not — reference it by URL.

## Memory content (no backend)

There is no API or separate data store. Memory content lives in the Tiled map as `memory_hotspot` objects (`id`, `text`, `imageUrl`), read at runtime by `HotspotManager`. Heavy media (photos/audio) is referenced by URL (e.g. an external bucket/CDN) rather than bundled or served by an app.

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
- **Keep the boundary clean:** game logic in `phaser/`, presentation in `components/`, coordination in `App.jsx`, communication over `EventBus`.
- **Note on naming drift:** code currently references `madison` map/tileset assets while `public/assets/` holds placeholders. When wiring real assets, keep map tileset `name` in the Tiled JSON matching the image key loaded in `GameScene.preload()`.
