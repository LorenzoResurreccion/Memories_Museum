# Implementation Plan: Wall Paintings

## Overview

This plan hangs a pixel-art image inside every framed canvas on the gallery wall and makes the
`Object Layer 1` read **type-aware** so adding painting objects cannot corrupt memory-zone
indexing. Work is ordered **pure, testable logic first** (object type partition, painting
ordering, painting-image resolution, the static image source), then the `GameScene` render pass
and release/preload wiring, then a map-authoring step, then full integration.

Implementation language is **JavaScript / JSX** (ES modules), matching the existing frontend.
Phaser scenes/managers are ES classes with JSDoc; static content is a plain ES module imported,
never fetched. All commands run from `Front-end/`: `npm run test` (single pass) and `npm run lint`.

This feature builds on the Infinite Hallway spec. It changes **only** how `_buildSegment` reads
`Object Layer 1` (partition by Tiled `type`) and adds a painting render pass + release; all
segment generation, zone indexing, memory resolution, and bounded-growth behavior are unchanged.

### Correctness-property obligation (MUST hold by the end)

All **11 correctness properties** from `design.md` MUST each have exactly one passing fast-check
property test (`{ numRuns: 100 }` minimum), tagged `// Feature: wall-paintings, Property N: <text>`
plus `**Validates: Requirements X.Y**`, mocking Phaser at module level (`vi.mock('phaser', …)`) in
the style of the existing `__tests__`. Property test file names MUST match this table:

| Property | Target | Test file |
|---|---|---|
| 1 Type-partitioned reads | `partitionObjectsByType` | `ObjectPartition.property.test.js` |
| 2 Zone-index invariance under paintings | `assignZoneIndices` over filtered zones | `PaintingZoneInvariance.property.test.js` |
| 3 Zone-count invariance | partition + `assignZoneIndices` | `PaintingZoneInvariance.property.test.js` (2nd block) |
| 4 Painting–memory index agreement | `assignPaintingIndices` vs `assignZoneIndices` | `PaintingIndex.property.test.js` |
| 5 Painting determinism on return | `resolvePaintingImage` | `PaintingResolve.property.test.js` |
| 6 Future painting placeholder | `resolvePaintingImage` | `PaintingResolve.property.test.js` (2nd block) |
| 7 Full bounds coverage | `GameScene._createPaintingSprite` | `GameScene.paintings.property.test.js` |
| 8 Wall depth ordering | `WALL_DEPTH` vs feet-Y band | `GameScene.paintings.property.test.js` (2nd block) |
| 9 Non-collidable | `_createPaintingSprite` | `GameScene.paintings.property.test.js` (3rd block) |
| 10 Graceful image fallback | `_createPaintingSprite` absent key | `GameScene.paintings.property.test.js` (4th block) |
| 11 No events from paintings | `_buildSegment` + `InteractionManager` | `Paintings.noEvents.property.test.js` |

Tasks marked with `*` are optional test sub-tasks and MAY be skipped for a faster MVP, but the
property obligation above is only satisfied once all 11 property tests exist and pass. Tasks
marked **[manual]** require the author-time Tiled app and the author's content.

## Tasks

- [x] 1. Static Painting_Image_Source module
  - [x] 1.1 Create `src/data/paintings.js`
    - Export `PAINTING_PLACEHOLDER_KEY` (texture key for the fallback art) and `PAINTINGS` — a
      static object keyed by `Memory_Index` (`0..N-1`, same `N` as `MEMORIES`), each entry
      `{ key: string, url: string|null }`. Entries start as placeholders (every `key` =
      `PAINTING_PLACEHOLDER_KEY`). No network/fetch; imported only.
    - Document that swapping in real art later = edit the `key`/`url` references here + add the
      asset + load it in `preload()`, with no other code change (Req 5.3).
    - _Requirements: 5.1, 5.3, 5.5_ · _Design: `src/data/paintings.js`_
  - [x]* 1.2 Write `paintings.test.js`
    - Module imports/exports with no network call; `PAINTING_PLACEHOLDER_KEY` is a non-empty
      string; every `PAINTINGS` entry is `{ key, ... }`-shaped with a string `key`.
    - _Requirements: 5.1, 5.5_

- [x] 2. Pure painting ordering + image resolution
  - [x] 2.1 Implement `assignPaintingIndices` in `src/phaser/paintingResolve.js`
    - Stable-sort painting descriptors `{x, y, id, width, height}` by ascending `x`, ties by
      ascending `y`, then ascending Tiled `id`; tag each with `paintingIndex` `0..5`. Identical
      ordering rule to `assignZoneIndices` so painting rank `k` aligns with memory-zone rank `k`.
    - _Requirements: 3.1, 3.2_ · _Design: paintingResolve.js_
  - [x] 2.2 Implement `resolvePaintingImage(segIndex, paintingIndex, source, N)` in `src/phaser/paintingResolve.js`
    - `memoryIndex = segIndex*6 + paintingIndex`; authored (`memoryIndex < N`) ⇒ the `PAINTINGS`
      entry `key` (falling back to `PAINTING_PLACEHOLDER_KEY` when the entry/key is missing); future
      (`memoryIndex >= N`) ⇒ `PAINTING_PLACEHOLDER_KEY`. Return `{ memoryIndex, key, isPlaceholder }`.
    - _Requirements: 3.2, 3.3, 3.5, 5.2_ · _Design: paintingResolve.js_
  - [x]* 2.3 Write `PaintingIndex.property.test.js`
    - **Property 4: Painting–memory index agreement** — for all `s` and ranks `z in 0..5`, ranking
      painting objects and memory-zone objects by the same `(x,y,id)` rule yields identical
      `memoryIndex = s*6 + z` at each rank. **Validates: Requirements 3.1, 3.2**
  - [x]* 2.4 Write `PaintingResolve.property.test.js`
    - **Property 5: Painting determinism on return** — re-resolving the same `(segIndex,
      paintingIndex, source, N)` yields the identical `key`. **Validates: Requirements 3.4**
    - **Property 6: Future painting placeholder** (second block) — for all `memoryIndex >= N`,
      `key === PAINTING_PLACEHOLDER_KEY` and `isPlaceholder === true`. **Validates: Requirements 3.5**
  - [x]* 2.5 Write `PaintingResolve.test.js` example tests
    - With `N = 8` and placeholder entries: `seg0 p0 ⇒ memory-0` placeholder key, `seg1 p0 ⇒
      memory-6`, `seg1 p2 ⇒ memory-8` future placeholder; missing entry ⇒ placeholder; authored key
      present ⇒ that key.
    - _Requirements: 3.2, 3.3, 3.5, 5.2_

- [x] 3. Object type-partition helper (pure)
  - [x] 3.1 Implement `partitionObjectsByType(objects)` in `src/phaser/paintingResolve.js` (or a small `objectPartition.js`)
    - Read each object's class as `obj.type ?? obj.class ?? ''`. Return
      `{ memoryZones: [...], paintings: [...] }` containing only `type === 'memory_zone'` and
      `type === 'painting'` objects respectively; all other/empty/missing types are excluded from
      both. Pure; no Phaser dependency.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1_ · _Design: `_buildSegment` type partition_
  - [x]* 3.2 Write `ObjectPartition.property.test.js`
    - **Property 1: Type-partitioned reads** — for all mixed object arrays, `memoryZones` equals
      exactly the `memory_zone` objects and `paintings` equals exactly the `painting` objects; no
      other-typed/untyped object appears in either. **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
  - [x]* 3.3 Write `PaintingZoneInvariance.property.test.js`
    - **Property 2: Zone-index invariance under paintings** — for a fixed set of `memory_zone`
      objects, adding/removing/repositioning any number of `painting` objects leaves every zone's
      `zoneIndex`/`memoryIndex` unchanged (partition → `assignZoneIndices`).
      **Validates: Requirements 1.6, 2.1, 2.2**
    - **Property 3: Zone-count invariance** (second block) — with exactly 6 `memory_zone` objects,
      the zone count is 6 regardless of painting count. **Validates: Requirements 2.3, 2.4**

- [x] 4. Checkpoint — pure helpers
  - Run `npm run test`; ensure tasks 1–3 tests pass. Ask the user if questions arise.

- [x] 5. Preload the placeholder painting texture
  - [x] 5.1 Load `PAINTING_PLACEHOLDER_KEY` in `GameScene.preload()`
    - `this.load.image(PAINTING_PLACEHOLDER_KEY, 'assets/photos/placeholder.png')` (reuse the
      existing bundled placeholder). A `loaderror` on a painting texture is handled **locally** (a
      per-key "missing" marker) and MUST NOT set the scene-level `_loadError` or halt the scene
      (Req 5.4). Leave hooks/comments for loading authored painting textures later.
    - _Requirements: 5.1, 5.4_ · _Design: GameScene.preload_
  - [x]* 5.2 Extend `GameScene.test.js`
    - `preload` registers `PAINTING_PLACEHOLDER_KEY`; a simulated painting-texture `loaderror` does
      not set `_loadError` and does not block building.
    - _Requirements: 5.1, 5.4_

- [x] 6. GameScene painting render pass + helper + release + WALL_DEPTH
  - [x] 6.1 Add `WALL_DEPTH` constant in the `GameScene` constructor
    - `this.WALL_DEPTH = 1;` with JSDoc: must stay `> FLOOR_DEPTH (0)` and strictly `<` the minimum
      actor feet world Y so paintings draw above the back wall and below every `Y_Sort_Group` member.
    - _Requirements: 4.4_ · _Design: Scene depth constant_
  - [x] 6.2 Implement `_createPaintingSprite(worldX, worldY, width, height, textureKey)`
    - Use `this.add.image` (NOT `physics.add`) ⇒ no physics body (Req 4.5). Substitute
      `PAINTING_PLACEHOLDER_KEY` when `this.textures.exists(textureKey)` is false (Req 5.2). Set
      origin `(0, 0)`; `setDisplaySize(width, height)` when `width > 0 && height > 0` to fully cover
      the bounds (stretch-to-fill, Req 4.2, 4.4); `setDepth(this.WALL_DEPTH)`. Return null in
      headless/mock contexts (no `this.add.image`).
    - _Requirements: 4.2, 4.4, 4.5, 5.2_ · _Design: `_createPaintingSprite`_
  - [x] 6.3 Partition `Object Layer 1` and add the painting pass in `_buildSegment`
    - Replace the "every object is a zone" read with `partitionObjectsByType`. Build Interaction_
      Zones from `memoryZones` using the EXISTING `assignZoneIndices` + `resolveZonePayload` +
      `_createZone` loop **verbatim** (indexing unchanged). Add a painting pass: rank `paintings`
      with `assignPaintingIndices`, resolve each via `resolvePaintingImage(index, p.paintingIndex,
      PAINTINGS, authoredMemoryCount)`, create a sprite with `_createPaintingSprite(worldOffsetX +
      p.x, p.y, p.width, p.height, key)`, and collect into a new `paintingSprites` array on the
      returned `Segment` handle.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 6.2, 6.3, 6.4, 7.1_ · _Design: `_buildSegment`_
  - [x] 6.4 Release paintings in `_releaseSegment`
    - Destroy every sprite in `segment.paintingSprites` (plain `destroy()`, mirroring the
      `floorSprites` branch; paintings never joined the sort group and have no body).
    - _Requirements: 4.6, 4.7_ · _Design: `_releaseSegment`_
  - [x]* 6.5 Write `GameScene.paintings.property.test.js`
    - **Property 7: Full bounds coverage** — `_createPaintingSprite` sets origin `(0,0)`,
      `setDisplaySize(width, height)`, depth `WALL_DEPTH`. **Validates: Requirements 4.2, 4.4**
    - **Property 8: Wall depth ordering** (second block) — `WALL_DEPTH > FLOOR_DEPTH` and strictly
      `<` any positive feet-Y actor depth. **Validates: Requirements 4.4**
    - **Property 9: Non-collidable** (third block) — `_createPaintingSprite` creates no physics body
      (no `physics.add` call). **Validates: Requirements 4.5**
    - **Property 10: Graceful image fallback** (fourth block) — when the key is absent from the
      texture cache, the sprite is still created with `PAINTING_PLACEHOLDER_KEY` and no `_loadError`.
      **Validates: Requirements 5.2, 5.4**
  - [x]* 6.6 Write `GameScene.paintings.test.js` example tests
    - A hallway `Object Layer 1` with 6 `memory_zone` points + 6 sized `painting` rects yields
      exactly 6 zones (registered with InteractionManager) and 6 `paintingSprites`; an
      unrecognized-type object yields neither; a painting renders at `worldOffsetX + x`, origin
      `(0,0)`, display size `(w,h)`, depth `WALL_DEPTH`, no physics body; absent key ⇒ placeholder;
      `_releaseSegment` destroys all painting sprites.
    - _Requirements: 1.3, 1.4, 1.5, 2.3, 2.4, 4.2, 4.5, 4.6, 5.2_

- [x] 7. Backward-compatibility + no-events tests
  - [x]* 7.1 Write `Paintings.noEvents.property.test.js`
    - **Property 11: No events from paintings** — for player paths overlapping only `painting`
      objects (no `memory_zone` overlap), no `hotspot-activated` is emitted and the player does not
      freeze. **Validates: Requirements 7.1, 7.2**
  - [x]* 7.2 Extend the memory-resolution example tests for backward compatibility
    - With the 6 objects tagged `memory_zone`, the emitted `hotspot-activated` payloads for seg0
      zone0..5 and seg1 zone0 match the PRE-feature `memory-{n}` resolution exactly (paintings do
      not change any memory). No change to `App.integration` behavior (Req 7.3).
    - _Requirements: 2.3, 7.3_

- [x] 8. Checkpoint — render pass integrated
  - Run `npm run test`; ensure tasks 5–7 tests pass. Ask the user if questions arise.

- [x] 9. Map authoring: tag existing objects + add painting objects **[manual]**
  - [x] 9.1 Update `museum_hallway` `Object Layer 1` in Tiled and re-export the JSON **[manual]**
    - Give each of the 6 existing interaction objects the Tiled `type` = `memory_zone`.
    - Add 6 new objects with `type` = `painting`, each sized to one frame's inner wall rectangle
      (positioned exactly inside the gold border) so `width`/`height` are the frame-inner px.
    - Re-export to `public/assets/maps/museum_hallway.json` (finite, embedded tilesets, as before).
    - _Requirements: 6.1, 6.2, 6.3, 6.4_ · _Design: research note (Tiled type field)_
  - [x]* 9.2 Extend `maps.conversion.test.js`
    - Assert the hallway `Object Layer 1` contains exactly 6 objects of `type` `memory_zone` and
      exactly 6 of `type` `painting`, and that every `painting` object has positive `width`/`height`.
    - _Requirements: 6.2, 6.3, 6.4_

- [x] 10. Final checkpoint — full suite, lint, and cleanup
  - Run `npm run test` (single pass) from `Front-end/`; fix any failures.
  - Run `npm run lint` from `Front-end/`; fix any lint errors.
  - Confirm all 11 property tests exist, are named per the Property → file table, and pass.
  - Manually verify in `npm run dev` that each frame shows the placeholder painting within its
    bounds and that memories still open the correct content (hand the dev command to the user).
  - Remove any temporary files created during implementation.
  - _Requirements: all_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; task 9.1
  is **[manual]** (needs the Tiled app + the author's placement) and is the one step that must be
  done by the author before paintings appear in-game.
- Each task references specific requirement sub-clauses and/or design elements for traceability.
- Checkpoints (4, 8, 10) ensure incremental validation.
- The 11 property tests collectively discharge the correctness-property obligation; unit/example
  tests cover concrete behavior and integration points.
- Order is pure-logic-first (1, 2, 3) → preload (5) → GameScene render/release (6) → compat/no-event
  tests (7) → map authoring (9) → full integration (10), so each task builds on the prior ones with
  no orphaned code. The code changes in tasks 1–8 are safe to land before the map is re-authored:
  until `painting` objects exist in the JSON, the painting pass simply builds zero paintings and
  the game behaves exactly as today.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.3", "2.4", "2.5", "3.2", "3.3"] },
    { "id": 2, "tasks": ["5.1", "6.1", "6.2"] },
    { "id": 3, "tasks": ["5.2", "6.3", "6.4"] },
    { "id": 4, "tasks": ["6.5", "6.6", "7.1", "7.2"] },
    { "id": 5, "tasks": ["9.1"] },
    { "id": 6, "tasks": ["9.2"] }
  ]
}
```
