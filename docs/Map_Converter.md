# Map_Converter

How the authored Tiled maps become the finite JSON the game loads at runtime.

## Why

Phasers tilemapTiledJSON loader consumes finite (non-chunked) Tiled JSON most reliably: each tile layer carries a single flat data array sized width * height. The authored .tmx sources are infinite maps whose layer data lives in <chunk> elements at negative chunk origins, which the runtime does not consume directly.

The converter re-exports each map as finite JSON with embedded tilesets so the per-tile collision objectgroup polygons travel into the map file (the runtime never fetches external .tsx tilesets referenced from a JSON map).

## Steps (author-time, Tiled app)

1. Open the .tmx in Tiled.
2. Map -> Map Properties -> turn Infinite off. This collapses the chunk grid into a flat 58 x 15 array anchored at (0,0).
3. Embed the tilesets into the map (Tilesets panel -> Embed Tileset for both museum_tileset and museum_decor) so their per-tile collision object groups export.
4. Export to Tiled JSON as museum_start.json / museum_hallway.json into Front-end/public/assets/maps/.

Equivalent headless (if the Tiled CLI is available), after toggling Infinite off:

    tiled --export-map museum_start.tmx museum_start.json
    tiled --export-map museum_hallway.tmx museum_hallway.json

The .tmx sources are kept outside this repo (local authoring copies); only the generated .json is committed.

## Invariants the conversion must preserve

- infinite is false; every tile layer has a flat data array of length width*height.
- Map dimensions are 58 x 15 tiles (16px grid) => 928 x 240 px per map/segment. The segment stride used by SegmentManager is 58 * 16 = 928.
- Layers Tile Layer 1, Tile Layer 2, and Object Layer 1 are present.
- The hallways Object Layer 1 carries exactly 6 interaction-zone objects.
- Embedded tilesets carry tiles[].objectgroup collision for the known local ids: museum_tileset -> 12, 24, 26, 27, 28, 35, 36, 37; museum_decor -> 7, 13.
- GID flip flags may appear on Tile Layer 2 cells (e.g. 2147483673, 2147483684); these are masked at runtime via gid & 0x1FFFFFFF.

## Naming-drift note

Per .kiro/steering/structure.md: older code referenced madison map/tileset assets while public/assets/ held placeholders. When wiring the real assets, keep the tileset name in the exported JSON (museum_tileset, museum_decor) matching the image key loaded in GameScene.preload(). The committed maps already use those names; the GameScene loader is updated to match in task 14.1.

## Media convention (photos / dialogue)

Dialogue text is not compiled into the game: the letters (Memories/dialogue/NN.md) are fetched once at startup by src/data/loadMemories.js. Photos/audio are not bundled either -- they are referenced by URL and loaded lazily on interaction. The game and its media are served from a single bucket under separate prefixes (game at /, media under a media prefix), so redeploying the game does not touch media. Local media is staged in the git-ignored sibling Memories/ folder.
