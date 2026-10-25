# Implementation Plan: Infinite Hallway

## Overview

This plan converts the Memories Museum into a bounded, procedurally stitched gallery that
loads the real authored maps/tilesets and ends after the last authored memory. Work is ordered
to build **pure, testable logic first** (GID decode, zone ordering, memory resolution, segment
arithmetic, collision AABB math), then integrate it into `GameScene`, then update the React
overlays, and finally wire the whole scene together and run full integration.

Implementation language is **JavaScript / JSX** (ES modules), matching the existing frontend.
Phaser managers are ES classes with JSDoc; React is functional components + hooks. All commands
run from `Front-end/`: `npm run test` (single pass) and `npm run lint`.

### Correctness-property obligation (MUST hold by the end)

All **18 correctness properties** from `design.md` MUST each have exactly one passing
fast-check property test (`{ numRuns: 100 }` minimum), tagged with the header convention
`// Feature: infinite-hallway, Property N: <text>` plus `**Validates: Requirements X.Y**`, and
mocking Phaser at module level (`vi.mock('phaser', …)`) in the style of the existing `__tests__`.
Property test file names MUST match the design's **Property → file mapping** table:

| Property | Target | Test file |
|---|---|---|
| 1 Left-boundary | `PlayerController` | `PlayerController.clamp.property.test.js` |
| 2 Floor continuity | `SegmentManager.worldOffsetForIndex` | `SegmentManager.continuity.property.test.js` |
| 3 Count monotonicity | `SegmentManager` | `SegmentManager.count.property.test.js` |
| 4 Count = maxIndex+1 | `SegmentManager` | `SegmentManager.count.property.test.js` (2nd block) |
| 5 Bounded generation | `SegmentManager` | `SegmentManager.bounded.property.test.js` |
| 6 Right-boundary | `PlayerController` (maxX) | `PlayerController.clamp.property.test.js` (2nd block) |
| 7 Loaded-window bound | `SegmentManager.update` | `SegmentManager.window.property.test.js` |
| 8 Return-path consistency | `SegmentManager` | `SegmentManager.returnPath.property.test.js` |
| 9 Prompt visibility | prompt predicate / `InteractionManager` | `PromptLabel.visibility.property.test.js` |
| 10 Single activation per press | `InteractionManager.checkInteraction` | `InteractionManager.activation.property.test.js` |
| 11 No activation outside zones | `InteractionManager` | `InteractionManager.noZone.property.test.js` |
| 12 No re-open while locked | `InteractionManager` | `InteractionManager.lock.property.test.js` |
| 13 Advance never opens | `InteractionManager` (Space) | `InteractionManager.spaceNoOpen.property.test.js` |
| 14 Collision classification + AABB + offset | `CollisionBuilder` | `CollisionBuilder.classification.property.test.js` |
| 15 Camera left bound | GameScene camera helper | `GameScene.camera.property.test.js` (extend) |
| 16 Memory-index determinism | `resolveZonePayload` | `MemoryIndex.determinism.property.test.js` |
| 17 Zone ordering determinism | `assignZoneIndices` | `ZoneOrdering.property.test.js` |
| 18 Future zone opens future-memory overlay | `resolveZonePayload` | `FutureMemory.property.test.js` |

Tasks marked with `*` are optional test sub-tasks and MAY be skipped for a faster MVP, but the
property obligation above is only satisfied once all 18 property tests exist and pass. Tasks
marked **[manual]** require the author-time Tiled app and are optional to automate in-repo.

## Tasks

- [x] 1. Asset conversion: committed finite Tiled JSON + schema validation
  - [x] 1.1 Produce and commit the converted maps **[manual]**
    - Export `public/assets/maps/museum_start.tmx` and `museum_hallway.tmx` to finite Tiled JSON
      (`museum_start.json`, `museum_hallway.json`) with Map → *Infinite* off (flat `58×15` `data`
      arrays anchored at `(0,0)`) and **embedded** tilesets so per-tile collision `objectgroup`
      data travels into the JSON. Equivalent headless: `tiled --export-map <tmx> <json>`.
    - Commit the two `.json` files under `public/assets/maps/`; keep the `.tmx` sources.
    - Document the conversion step in `docs/` (Map_Converter note); reference the naming-drift note.
    - _Requirements: 1.1, 1.2_ · _Design: Map_Converter_
  - [x] 1.2 Write `maps.conversion.test.js` schema/validation test
    - Load the committed `museum_start.json` / `museum_hallway.json` and assert each is **finite**
      (`infinite !== true`; every tile layer has a flat `data` array sized `width*height`).
    - Assert each map contains `Tile Layer 1`, `Tile Layer 2`, and `Object Layer 1`.
    - Assert the hallway's `Object Layer 1` has exactly **6** rectangle objects.
    - Assert embedded tilesets carry `tiles[].objectgroup` collision for the known local ids
      (`museum_tileset`: 12, 24, 26, 27, 28, 35, 36, 37; `museum_decor`: 7, 13).
    - _Requirements: 1.1, 1.2, 12.1_ · _Design: maps.conversion.test.js_

- [x] 2. GID decode helper (pure)
  - [x] 2.1 Implement `gidDecode` in `src/phaser/GameScene.js` (exported helper) or a small module
    - Return `{ frame: gid & 0x1FFFFFFF, flipH: (gid & 0x80000000)!==0, flipV: (gid & 0x40000000)!==0, flipD: (gid & 0x20000000)!==0 }`.
    - Total function: any integer GID decodes without throwing.
    - _Requirements: 7.1, 7.2_ · _Design: `_buildSortableLayer` GID decode, research note_
  - [x]* 2.2 Write `GameScene.gidDecode.property.test.js`
    - **Property N/A (supporting): decode totality & consistency** — over random GIDs (base id OR'd
      with a random subset of the 3 flip bits), `frame === gid & 0x1FFFFFFF`,
      `flipH === (gid & 0x80000000)!==0`, `flipV === (gid & 0x40000000)!==0`.
    - _Requirements: 7.1, 7.2_
  - [x]* 2.3 Write example tests for GID decode
    - `2147483673` ⇒ id `25` + `flipH true`; `2147483684` ⇒ id `36` + `flipH true`; plain id ⇒ no
      flip; masked frame `<= 0` ⇒ treated as empty; diagonal-flagged ⇒ ignored (no throw).
    - _Requirements: 7.1, 7.2_

- [x] 3. Memories manifest module
  - [x] 3.1 Create `src/data/memories.js`
    - Export the static `MEMORIES` manifest (keyed/indexed by `Memory_Index`, holding `N` authored
      entries at `0..N-1`), `FUTURE_MEMORY_TEXT = 'A future memory, not yet saved ❤'`, and
      `FUTURE_MEMORY_OVERLAY = { text: [FUTURE_MEMORY_TEXT], imageUrl: null }`. No network/fetch.
    - _Requirements: 12.8, 13.5_ · _Design: Memories manifest, Future memory overlay_
  - [x]* 3.2 Write `memories.test.js`
    - Manifest imports/exports with no network call; entries are `MemoryEntry`-shaped
      (`text: string[]`, `imageUrl: string|null`); `FUTURE_MEMORY_TEXT` is the exact string.
    - _Requirements: 12.8, 13.5_

- [x] 4. Pure zone-ordering and memory-resolution helpers
  - [x] 4.1 Implement `assignZoneIndices` in `src/phaser/memoryResolve.js`
    - Stable-sort the 6 `{x, y, id}` descriptors by ascending `x`, ties by ascending `y`, then
      ascending Tiled `id`; tag each with `zoneIndex` `0..5` (bijection onto `{0..5}`).
    - _Requirements: 12.1, 12.2_ · _Design: Zone ordering and memory resolution_
  - [x]* 4.2 Write `ZoneOrdering.property.test.js`
    - **Property 17: Zone ordering determinism** — over 6 distinct `{x,y,id}` records (incl. equal-x
      ties), the `zoneIndex` set equals `{0,1,2,3,4,5}` and is stable across repeated calls.
    - **Validates: Requirements 12.2**
  - [x] 4.3 Implement `resolveZonePayload(segIndex, zoneIndex, manifest, N)` in `src/phaser/memoryResolve.js`
    - `memoryIndex = segIndex*6 + zoneIndex`; `id = \`memory-${memoryIndex}\``; authored entry when
      `memoryIndex < N`, else the constant `FUTURE_MEMORY_OVERLAY` payload. Returns
      `{ id, memoryIndex, payload }`.
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 13.5, 13.6_ · _Design: resolveZonePayload_
  - [x]* 4.4 Write `MemoryIndex.determinism.property.test.js`
    - **Property 16: Memory-index determinism** — for all `s >= 0`, `z in 0..5`,
      `memoryIndex === s*6 + z`; re-resolving `(s,z)` yields identical `memoryIndex`, `id`, payload.
    - **Validates: Requirements 12.3, 12.7**
  - [x]* 4.5 Write `FutureMemory.property.test.js`
    - **Property 18: Future zone opens future-memory overlay** — for all `memoryIndex >= N`, payload
      `text === ["A future memory, not yet saved ❤"]`, `imageUrl === null`, `id === memory-{n}`.
    - **Validates: Requirements 12.6, 13.5**
  - [x]* 4.6 Write `MemoryResolve.test.js` example tests
    - With `N = 8`: `seg0 zone0 ⇒ memory-0`, `seg0 zone1 ⇒ memory-1`, `seg1 zone0 ⇒ memory-6`,
      `seg1 zone1 ⇒ memory-7` (authored); `seg1 zone2 ⇒ memory-8` ⇒ future payload; every `id`
      matches `memory-{n}`; re-resolving yields identical content.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [x] 5. Checkpoint — pure helpers
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. CollisionBuilder (per-tile AABB static bodies)
  - [x] 6.1 Implement `src/phaser/CollisionBuilder.js`
    - `classifyTile(tileData)` ⇒ `'collision'` when a parseable collision `objectgroup` is present,
      else `'floor'` (absent **or** unparseable ⇒ floor, no throw).
    - `tileLocalAABB(tileData)` ⇒ AABB in tile-local px (rect uses x/y/w/h; polygon uses min/max of
      points offset by object x/y); `null` for floor/unparseable.
    - `buildForLayer(layerData, tileset, worldOffsetX)` ⇒ invisible static arcade bodies at
      `worldOffsetX + col*16 + localAABB.x` / `row*16 + localAABB.y`; returns created bodies for
      later release; wired via `physics.add.collider`. No collision layer.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8_ · _Design: CollisionBuilder_
  - [x]* 6.2 Write `CollisionBuilder.classification.property.test.js`
    - **Property 14: Collision classification** — over tiles of `{no objectgroup}`, `{rectangle}`,
      `{polygon}`, `{malformed}`: floor/unparseable ⇒ occupiable, collision ⇒ enclosing AABB, and
      each AABB world position equals its tile-local AABB offset by the segment world offset.
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.7, 6.8**
  - [x]* 6.3 Write example tests for CollisionBuilder
    - Rectangle tile (e.g. `museum_tileset` 12) ⇒ expected AABB; polygon tile ⇒ min/max AABB;
      malformed objectgroup ⇒ classified floor, no body, build continues.
    - _Requirements: 6.2, 6.3, 6.4, 6.8_

- [x] 7. PlayerController two-sided clamp
  - [x] 7.1 Add `minX` / `maxX` clamp to `src/phaser/PlayerController.js`
    - Inject `minX` (start-map floor left edge) and `maxX` (final segment floor right edge). After
      velocity resolution each `update()`: `sprite.x = min(max(sprite.x, minX), maxX)`; zero
      leftward velocity at `minX` and rightward velocity at `maxX`. Keep `setCollideWorldBounds`
      with world left/right pinned to `minX`/`maxX`. No other movement change.
    - _Requirements: 5.3, 5.4, 13.3_ · _Design: PlayerController_
  - [x]* 7.2 Write `PlayerController.clamp.property.test.js`
    - **Property 1: Left-boundary invariant** — player X never `< minX`; leftward input at `minX`
      leaves X unchanged. **Validates: Requirements 5.3, 5.4**
    - **Property 6: Right-boundary invariant** (second block) — player X never `> maxX`; rightward
      input at `maxX` leaves X unchanged. **Validates: Requirements 13.3**
  - [x]* 7.3 Write example tests for the clamp
    - Input left at `minX` ⇒ X unchanged, leftward velocity zeroed; input right at `maxX` ⇒ X
      unchanged, rightward velocity zeroed.
    - _Requirements: 5.3, 5.4, 13.3_

- [x] 8. SegmentManager (generate / count / recycle / return path, bounded)
  - [x] 8.1 Implement `src/phaser/SegmentManager.js` arithmetic + lifecycle
    - `finalSegmentIndex = N >= 1 ? floor((N-1)/6) : 0` (or injected explicitly).
    - `worldOffsetForIndex(0) = startRightEdgeX`; `worldOffsetForIndex(n) = startRightEdgeX + n*928`.
    - `segmentCount` = highest generated index + 1 (0 initially); increments by exactly 1 only on a
      strictly new max; capped at `finalSegmentIndex + 1`.
    - `update(playerX)`: generate `maxGenerated+1` only while `maxGenerated < finalSegmentIndex`
      **and** `playerX >= rightmostRightEdge - 928`; `loadedWindow.size <= 3`, recycling the
      furthest-behind segment only if its right edge `<= playerX - 928` (release sprites/bodies/
      zones via injected `releaseSegment`); leftward re-instantiation in descending index order via
      deterministic `worldOffsetForIndex` + build; never holds index `< 0`.
    - Generation failure ⇒ `generationFailed = true`, retain rightmost, release nothing.
    - Delegate sprite/body/zone creation to injected `buildSegment(index, worldOffsetX)` (which uses
      `assignZoneIndices` + `resolveZonePayload`) so the manager is mock-testable.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.5, 5.6, 13.1, 13.2, 13.8_ · _Design: SegmentManager_
  - [x]* 8.2 Write `SegmentManager.continuity.property.test.js`
    - **Property 2: Floor continuity** — `worldOffsetForIndex(n)` equals the prior segment's right
      edge (start-map right edge for `n=0`), zero gap/overlap, identical floor Y.
    - **Validates: Requirements 3.1, 3.5, 5.2**
  - [x]* 8.3 Write `SegmentManager.count.property.test.js`
    - **Property 3: Segment-count monotonicity** — count non-decreasing, +1 only on a new max.
      **Validates: Requirements 4.2, 4.3**
    - **Property 4: Count = maxIndex+1** (second block) — count equals highest generated index + 1,
      0 before any generation. **Validates: Requirements 4.5, 4.6**
  - [x]* 8.4 Write `SegmentManager.bounded.property.test.js`
    - **Property 5: Bounded generation** — over random `N` → `finalSegmentIndex`, no generated index
      exceeds `finalSegmentIndex` and `segmentCount <= finalSegmentIndex + 1`.
    - **Validates: Requirements 3.3, 4.7, 13.1**
  - [x]* 8.5 Write `SegmentManager.window.property.test.js`
    - **Property 7: Loaded-window bound** — concurrently instantiated segments never exceed 3.
    - **Validates: Requirements 3.6, 3.7**
  - [x]* 8.6 Write `SegmentManager.returnPath.property.test.js`
    - **Property 8: Return-path consistency** — leftward index sequence is the reverse of the
      rightward sequence, terminating at the start map; no index `< 0`.
    - **Validates: Requirements 5.1, 5.5**
  - [x]* 8.7 Write `SegmentManager.bounded.test.js` example tests
    - Bounded generation + right clamp: with `N` memories, driving fully right generates no index
      `> finalSegmentIndex`, `segmentCount <= finalSegmentIndex + 1`.
    - `N == 0` edge case: exactly one segment (index 0), nothing to its right, all 6 zones future.
    - _Requirements: 3.3, 3.4, 4.7, 13.1, 13.2, 13.8_

- [x] 9. Checkpoint — core subsystems
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. InteractionManager (replaces HotspotManager)
  - [x] 10.1 Implement `src/phaser/InteractionManager.js`
    - Open key is `E`, edge-detected (one emit per press cycle, released ≥1 frame). `addZones` /
      `removeZones` register/release a segment's world-offset zones (each already carrying resolved
      `{zoneIndex, memoryIndex, id, payload}`). `isPlayerOverlappingZone(player)` drives the prompt.
      `checkInteraction(player)`: emit `hotspot-activated` with the overlapped zone's payload only
      when unlocked + E rising edge + overlapping; never on Space/Enter/Esc; no-op while locked.
      `setLocked(locked)`. EventBus-only; never touches React. Remove/replace `HotspotManager` usage.
    - _Requirements: 8.1, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.13, 9.14_ · _Design: InteractionManager_
  - [x]* 10.2 Write `InteractionManager.activation.property.test.js`
    - **Property 10: Single activation per press** — at most one emit per discrete E press cycle.
    - **Validates: Requirements 9.3**
  - [x]* 10.3 Write `InteractionManager.noZone.property.test.js`
    - **Property 11: No activation outside zones** — no emit when overlapping no zone.
    - **Validates: Requirements 9.4**
  - [x]* 10.4 Write `InteractionManager.lock.property.test.js`
    - **Property 12: No re-open while locked** — no emit while locked.
    - **Validates: Requirements 9.5**
  - [x]* 10.5 Write `InteractionManager.spaceNoOpen.property.test.js`
    - **Property 13: Advance never opens** — Space while no overlay open never emits.
    - **Validates: Requirements 9.2**
  - [x]* 10.6 Write InteractionManager example tests
    - E over a zone emits once; Space/Enter/Esc never emit; locked manager ignores E.
    - _Requirements: 9.1, 9.2, 9.5_

- [x] 11. PromptLabel floating [E] label
  - [x] 11.1 Implement `src/phaser/PromptLabel.js`
    - `[E]` text/container; `setVisible(visible)` at fixed depth `>= 10000` (overhead);
      `follow(player)` repositions at a fixed offset above the player's top each frame. Visibility
      rule (applied in `GameScene.update`): visible iff `isPlayerOverlappingZone && !overlayOpen`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_ · _Design: PromptLabel_
  - [x]* 11.2 Write `PromptLabel.visibility.property.test.js`
    - **Property 9: Prompt visibility iff zone overlap and no overlay** — visible iff
      `overlaps && !overlayOpen`. **Validates: Requirements 8.1, 8.3, 8.4**
  - [x]* 11.3 Write PromptLabel example tests
    - Overlap + no overlay ⇒ visible; overlay open ⇒ hidden; no overlap ⇒ hidden; `follow` keeps the
      fixed offset as the player moves.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 12. React overlay key-semantics updates
  - [x] 12.1 Update `src/components/DialogueBox.jsx`
    - Space advances when not on the last page and dismisses (via `onDismiss`) on the last page; Esc
      dismisses at any page; Enter no longer advances or dismisses; keep the 300ms debounce and
      paged-text rendering.
    - _Requirements: 9.8, 9.9, 9.10, 9.11_ · _Design: DialogueBox.jsx_
  - [x]* 12.2 Extend `DialogueBox.test.jsx`
    - Space advances mid-pages; Space on last page calls `onDismiss`; Esc dismisses at any page;
      Enter does nothing; 300ms debounce honored.
    - _Requirements: 9.8, 9.9, 9.10, 9.11_
  - [x] 12.3 Update `src/components/ImageViewer.jsx`
    - Space dismisses; Esc dismisses; Enter removed; keep the close button and `onError` fallback.
    - _Requirements: 9.9, 9.11_ · _Design: ImageViewer.jsx_
  - [x]* 12.4 Extend `ImageViewer.test.jsx`
    - Space and Esc dismiss; Enter does nothing; close button works; broken image shows fallback.
    - _Requirements: 9.9, 9.11_

- [x] 13. Checkpoint — managers and overlays
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. GameScene asset loading rewrite
  - [x] 14.1 Rewrite `GameScene.preload()` / tileset association
    - Load `assets/maps/museum_start.json` and `assets/maps/museum_hallway.json` via
      `tilemapTiledJSON`; load `museum_tileset` and `museum_decor` images with keys equal to the
      tileset names; `addTilesetImage('museum_tileset', …)` firstgid 1 and
      `addTilesetImage('museum_decor', …)` firstgid 41. Remove **all** `madison` references. Keep the
      player spritesheet load + 10s timeout and the `loaderror` → `_loadError` path, extended to
      name the missing tileset (`"Error: Missing tileset: museum_decor"`). Build nothing on error.
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 11.1, 11.2, 11.3, 11.4_ · _Design: GameScene.preload/create_
  - [x] 14.2 Extend `GameScene.test.js` for loading + graceful failure
    - `preload` registers the four real assets and no `madison`; map/tileset `loaderror` renders the
      error and builds nothing; `addTilesetImage` returning null yields a named missing-tileset error.
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 11.1, 11.2, 11.3, 11.4_

- [x] 15. GameScene layer build: Y-sort Layer 2 with GID flips
  - [x] 15.1 Update `GameScene._buildSortableLayer()` (and floor/back-wall build)
    - For each `Tile Layer 2` cell: decode GID (task 2.1); skip when `frame <= 0`; create feet-origin
      `(0.5, 1)` sprite from the correct tileset image key at the masked frame; apply
      `setFlipX(flipH)` / `setFlipY(flipV)`; log+ignore `flipD`; add to `Y_Sort_Group`. Build
      `Tile Layer 1` floor + back wall at fixed low depth. Re-depth every `Y_Sort_Group` member to
      its feet world Y each frame (done in `update`, task 17).
    - _Requirements: 7.1, 7.2, 7.3, 7.7_ · _Design: `_buildSortableLayer`_
  - [x]* 15.2 Extend Y-sort example tests in `GameScene.test.js`
    - Exactly one feet-origin sprite per non-empty (flag-masked) cell, none for `-1/0`; H-flip cells
      (`2147483673`→id 25, `2147483684`→id 36) yield `flipX === true`; diagonal cell ignored;
      after a depth pass every member `depth === y` and floor depth `< min(member depth)`.
    - _Requirements: 7.1, 7.2, 7.3, 7.7_

- [x] 16. GameScene create(): spawn, camera, subsystem wiring, event subscriptions
  - [x] 16.1 Spawn + subsystem instantiation in `create()`
    - If `_loadError`, display error and build nothing. Instantiate `CollisionBuilder`,
      `SegmentManager`, `InteractionManager`, `PromptLabel` (inject `buildSegment`/`releaseSegment`
      using `assignZoneIndices` + `resolveZonePayload` + the manifest). Spawn player from
      `player_spawn` with a left-of-everything floor fallback inside start-map bounds; set
      `PlayerController` `minX` (start-map floor left edge) and `maxX` (final segment floor right
      edge once that segment exists).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 5.3, 13.3_ · _Design: GameScene.create, PlayerController_
  - [x] 16.2 Camera setup + dismiss/activate event subscriptions
    - Camera zoom `2`, follow player, `roundPixels`; left bound at start-map left edge; right bound
      grows with generated segments but is **capped and fixed** at the final segment's right edge.
      Subscribe `hotspot-activated` (freeze player + lock InteractionManager), and
      `dialogue-dismissed` / `image-dismissed` (unfreeze + unlock within one frame); track
      `overlayOpen`. Drop `collisionLayer` / `setCollisionByExclusion` entirely.
    - _Requirements: 6.6, 9.6, 9.7, 9.12, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 13.4_ · _Design: GameScene.create_
  - [x]* 16.3 Extend `GameScene.test.js` + `GameScene.camera.property.test.js`
    - Spawn at `player_spawn` else left-of-everything fallback within start bounds.
    - Camera `zoom === 2`, `roundPixels` true, left bound at start-map left edge, right bound extends
      on generation but capped/fixed at the final segment right edge, unchanged on failure.
    - **Property 15: Camera never reveals pre-start space** (in `GameScene.camera.property.test.js`)
      — visible left edge never `< start-map left edge`. **Validates: Requirements 10.3**
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 10.1, 10.3, 10.4, 10.5, 10.6, 13.4_

- [x] 17. GameScene update() loop wiring
  - [x] 17.1 Implement the per-frame `update()` sequence
    - `playerController.update()` → `segmentManager.update(player.x)` → re-depth every `Y_Sort_Group`
      member to its feet Y → `promptLabel.follow(player)` + visibility rule
      (`isPlayerOverlappingZone && !overlayOpen`) → `interactionManager.checkInteraction(player)` →
      extend camera right bound on new segment (capped at final segment right edge). Respect
      `overlayOpen` for the prompt + interaction-lock gates.
    - _Requirements: 7.3, 8.1, 8.2, 8.3, 8.4, 9.3, 9.5, 10.4, 13.4_ · _Design: GameScene.update_
  - [x]* 17.2 Extend `GameScene.test.js` for the update loop
    - Depth pass sets `depth === y` for all members each frame; prompt follows + toggles on
      overlap/overlay; interaction checked each frame; camera right bound capped at final segment.
    - _Requirements: 7.3, 8.1, 8.2, 8.3, 8.4, 10.4, 13.4_

- [x] 18. App integration (freeze gating)
  - [x]* 18.1 Extend `App.integration.test.jsx`
    - A payload with text/image opens the overlay and (via the GameScene listener) freezes/locks;
      the future-memory payload (`text ["A future memory, not yet saved ❤"]`, `imageUrl null`) is
      non-empty so it also opens + freezes; a genuinely empty payload opens nothing and does not
      freeze; dismiss events unfreeze/unlock.
    - _Requirements: 9.6, 9.7_ · _Design: App.jsx_

- [x] 19. Final checkpoint — full suite, lint, and cleanup
  - Run `npm run test` (single pass) from `Front-end/`; fix any failures.
  - Run `npm run lint` from `Front-end/`; fix any lint errors.
  - Confirm all 18 property tests exist, are named per the Property → file table, and pass.
  - Remove any temporary files created during implementation.
  - _Requirements: all_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; tasks
  marked **[manual]** need the author-time Tiled app (the committed JSON + validation test 1.2 are
  still expected in-repo).
- Each task references specific requirement sub-clauses and/or design elements for traceability.
- Checkpoints (5, 9, 13, 19) ensure incremental validation.
- The 18 property tests collectively discharge the correctness-property obligation stated at the
  top; unit/example tests cover concrete behavior and integration points.
- Order is pure-logic-first (2, 3, 4, 6, 7, 8) → managers (10, 11) + overlays (12) → GameScene
  integration (14–17) → App integration (18) so each task builds on the prior ones with no orphaned
  code.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.2", "4.1", "4.3", "6.1", "7.1"] },
    { "id": 2, "tasks": ["4.2", "4.4", "4.5", "4.6", "6.2", "6.3", "7.2", "7.3", "8.1"] },
    { "id": 3, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "10.1", "11.1", "12.1", "12.3"] },
    { "id": 4, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6", "11.2", "11.3", "12.2", "12.4", "14.1"] },
    { "id": 5, "tasks": ["14.2", "15.1"] },
    { "id": 6, "tasks": ["15.2", "16.1"] },
    { "id": 7, "tasks": ["16.2"] },
    { "id": 8, "tasks": ["16.3", "17.1"] },
    { "id": 9, "tasks": ["17.2", "18.1"] }
  ]
}
```
