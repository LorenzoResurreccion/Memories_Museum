# Implementation Plan: Follower Companion

## Overview

Build Kelly, the trailing companion, bottom-up in JavaScript (ES modules, Vitest + fast-check). Pure Phaser-free modules come first (`followerTrail.js`, `followerCollision.js`), then `FollowerController`, then `GameScene` wiring, then integration and smoke tests. All paths are under `Front-end/`. Source goes in `src/phaser/`, tests in `src/phaser/__tests__/`. Property tests use `*.property.test.js` with `{ numRuns: 100 }` or more and a tag comment `Feature: follower-companion, Property N: ...`. Controller and scene tests reuse the existing `vi.mock('phaser', ...)` harness (see `PlayerController.clamp.property.test.js` and `GameScene.test.js`). Never start the dev server; run `npm run test` and `npm run lint` from `Front-end/` at checkpoints.

## Tasks

- [x] 1. Share player animation constants
  - [x] 1.1 Export `WALK_FRAME_RATE = 4` and `FRAMES_PER_ROW = 4` from `src/phaser/PlayerController.js`
    - Initialise `this._animFrameRate` from `WALK_FRAME_RATE`; no behavior change
    - _Requirements: 5.2_
  - [x]* 1.2 Add assertion to the existing PlayerController tests
    - Assert `_animFrameRate === WALK_FRAME_RATE` and that both constants are exported
    - _Requirements: 5.2_

- [x] 2. Implement the pure trail module `src/phaser/followerTrail.js` (no Phaser imports)
  - [x] 2.1 Implement constants and core trail functions
    - Constants: `FOLLOW_DISTANCE_PX` (24), `TRAIL_SLACK_PX` (32), `MAX_TRAIL_SAMPLES` (256), `TELEPORT_THRESHOLD_PX` (64), `MOVE_EPSILON_PX` (0.1), `MAX_FRAME_DELTA_MS` (100), `DEPTH_TIE_EPSILON` (0.001), `FACING_ROW`, `FRAMES_PER_ROW`
    - Functions: `distance`, `pathLength`, `createTrail`, `appendSample`, `pointAtDistanceFromEnd`, `followerPosition`, `advanceGap`, `trimTrail`, `stepTrail`, `clampPoint`, `facingFromDelta`, `frameIndexFor`, `resolveFollowerDepth`, `isValidStepInput`
    - `trimTrail` limit is `max(followDistance + slack, gap)` and cuts the oldest segment exactly; `appendSample` clamps `gap` after eviction; all functions are pure
    - `stepTrail` returns the same state object for invalid inputs and resets the trail when displacement exceeds 64 px
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.5, 5.6, 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 1.5, 1.6, 12.1, 12.2, 12.3_
  - [x] 2.2 Add the settle helpers to `followerTrail.js`
    - Constants: `MIN_SEPARATION_PX` (16), `SETTLE_ARRIVAL_PX` (1), `SETTLE_GAP_TOLERANCE_PX` (1)
    - Functions: `restSpotCandidates` (order: behind, front, above, below), `shouldSettle`, `stepToward`, `reseedTrail`
    - `stepToward` never overshoots, returns `{ pos: from, arrived: false }` for negative or non-finite `maxStep`; `reseedTrail` returns one sample when the points coincide
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.6, 13.7, 13.8, 13.12, 12.1_
  - [x]* 2.3 Write property test for recording
    - File: `followerTrail.path.property.test.js`
    - **Property 1: Recording appends exactly the changes, in order**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.5, 4.3**
  - [x]* 2.4 Write property test for path membership
    - File: `followerTrail.path.property.test.js`
    - **Property 2: Path membership (Following mode)**
    - **Validates: Requirements 3.6, 4.4, 4.7, 12.7**
  - [x]* 2.5 Write property test for monotone progress
    - File: `followerTrail.path.property.test.js`
    - **Property 3: Monotone progress along the recorded path**
    - **Validates: Requirements 4.1, 4.2**
  - [x]* 2.6 Write property test for trim neutrality
    - File: `followerTrail.path.property.test.js`
    - **Property 7: Trim neutrality and bounded length**
    - **Validates: Requirements 2.4, 12.5**
  - [x]* 2.7 Write property test for idempotence at rest
    - File: `followerTrail.path.property.test.js`
    - **Property 8: Idempotence at rest**
    - **Validates: Requirements 12.6, 2.2**
  - [x]* 2.8 Write property test for teleport reset
    - File: `followerTrail.path.property.test.js`
    - **Property 10: Teleport reset versus continuity**
    - **Validates: Requirements 8.6, 8.7**
  - [x]* 2.9 Write property test for invalid inputs (pure `stepTrail` part)
    - File: `followerTrail.path.property.test.js`
    - **Property 11: Invalid inputs are a no-op**
    - **Validates: Requirements 12.3**
  - [x]* 2.10 Write property test for distance invariant and convergence
    - File: `followerTrail.motion.property.test.js`
    - **Property 4: Distance invariant and convergence (Following mode)**
    - **Validates: Requirements 3.1, 3.2, 3.4, 12.4**
  - [x]* 2.11 Write property test for hold inside follow distance
    - File: `followerTrail.motion.property.test.js`
    - **Property 5: Hold inside the follow distance (Following mode)**
    - **Validates: Requirements 3.5, 3.7, 4.5, 4.8, 6.7**
  - [x]* 2.12 Write property test for per-frame speed bound
    - File: `followerTrail.motion.property.test.js`
    - **Property 6: Per-frame speed bound**
    - **Validates: Requirements 3.3, 4.6**
  - [x]* 2.13 Write property test for bounds clamp
    - File: `followerTrail.motion.property.test.js`
    - **Property 9: Hallway bounds clamp**
    - **Validates: Requirements 8.1, 8.4, 8.5, 8.8**
  - [x]* 2.14 Write property test for facing
    - File: `followerTrail.helpers.property.test.js`
    - **Property 12: Facing follows the dominant axis**
    - **Validates: Requirements 5.1, 5.5**
  - [x]* 2.15 Write property test for frame index mapping
    - File: `followerTrail.helpers.property.test.js`
    - **Property 13: Frame index mapping**
    - **Validates: Requirements 5.6, 1.3**
  - [x]* 2.16 Write property test for depth ordering
    - File: `followerTrail.helpers.property.test.js`
    - **Property 14: Depth ordering with stable ties**
    - **Validates: Requirements 1.5, 1.6**
  - [x]* 2.17 Write property test for the settle trigger predicate
    - File: `followerTrail.helpers.property.test.js`
    - **Property 18: Settle trigger predicate**
    - **Validates: Requirements 13.1, 13.8, 13.12**
  - [x]* 2.18 Write property test for `stepToward`
    - File: `followerTrail.helpers.property.test.js`
    - **Property 19: Settle step speed, snap, rounding and clamp (`stepToward` part)**
    - **Validates: Requirements 13.2, 13.3, 13.10, 4.6**
  - [x]* 2.19 Write property test for `reseedTrail`
    - File: `followerTrail.helpers.property.test.js`
    - **Property 23: Reseed trail**
    - **Validates: Requirements 13.6, 13.7, 2.3**
  - [x]* 2.20 Write example tests in `followerTrail.test.js`
    - `createTrail` seeds one sample; hand-computed L-shaped walk passes the exact corner; out-and-back walk reaches the reversal point first; short trail holds at game start
    - 64 px exactly keeps the trail, 64.01 px resets it; trim cuts the oldest segment at the exact limit
    - Motivating case: walk right 40, double back 12, stop facing left: `shouldSettle` true and the behind candidate is x = 52
    - `restSpotCandidates` hand values per facing; `stepToward` snaps within 1 px; `reseedTrail` coincident case returns one sample
    - _Requirements: 2.6, 3.7, 4.1, 4.2, 8.6, 8.7, 13.1, 13.4_

- [x] 3. Checkpoint - Ensure all tests pass
  - Run `npm run test` and `npm run lint` from `Front-end/`. Ask the user if questions arise.

- [x] 4. Implement the pure collision module `src/phaser/followerCollision.js` (no Phaser imports)
  - [x] 4.1 Implement footprint, overlap, validity, sweep and target selection
    - `FOLLOWER_FOOTPRINT_PX` (16), `footprintAt`, `rectsOverlap` (strict, positive-area only), `isValidPosition` (inclusive bounds), `segmentClear` (Minkowski-expanded open rectangle with slab clipping), `sanitizeBoxes` (never throws, non-array gives `[]`), `chooseSettleTarget` (first candidate that is valid and route-clear, else `null`, never clamps)
    - Import `restSpotCandidates` from `followerTrail.js`
    - _Requirements: 12.8, 13.4, 13.5, 13.13, 13.14, 13.15, 13.17_
  - [x]* 4.2 Write property test for footprint and overlap
    - File: `followerCollision.property.test.js`
    - **Property 24: Footprint and rectangle overlap agree with an area oracle**
    - **Validates: Requirements 12.8, 13.4, 13.13**
  - [x]* 4.3 Write property test for the segment sweep
    - File: `followerCollision.property.test.js`
    - **Property 25: Segment sweep matches a dense-sampling oracle**
    - **Validates: Requirements 12.8, 13.14**
  - [x]* 4.4 Write property test for settle target selection
    - File: `followerCollision.property.test.js`
    - **Property 17: Settle target is the first valid candidate, or null**
    - **Validates: Requirements 13.4, 13.5, 13.14**
  - [x]* 4.5 Write example tests in `followerCollision.test.js`
    - `footprintAt((100, 80))` is `{ x: 92, y: 64, width: 16, height: 16 }`
    - Box touching the footprint edge is valid, 1 px overlap is not; flush bench at the stop point does not block other candidates
    - `chooseSettleTarget`: behind blocked picks front; behind and front blocked picks above; route-only block falls through; all blocked returns `null`
    - `sanitizeBoxes` drops null, NaN and non-positive entries
    - _Requirements: 13.4, 13.5, 13.13, 13.14_

- [x] 5. Checkpoint - Ensure all tests pass
  - Run `npm run test` and `npm run lint` from `Front-end/`. Ask the user if questions arise.

- [x] 6. Implement `src/phaser/FollowerController.js`
  - [x] 6.1 Implement constructor, animations and Following-mode `update`
    - Export `FOLLOWER_SPRITE_KEY = 'follower'`; constructor takes `(scene, sprite, eventBus, options)` with `followDistance`, `speed`, `frameRate`, `initialFacing`, `startPosition`, `getCollisionBoxes` (default `() => []`), `minSeparation`
    - Register `follower-walk-{dir}` and `follower-idle-{dir}` guarded by `scene.anims.exists`; set initial neutral frame; seed trail
    - `update(player, deltaMs, playerFacing)`: no-op when frozen, destroyed or input invalid; call `stepTrail`, clamp, derive facing and walk/idle animation in the same call, handle teleport (place on Player, keep facing, idle), keep an unrounded float position and set the sprite to `Math.round`
    - `setBounds`, `setVerticalBounds` (default `±Infinity`), `getFacingDirection`, `trail` getter
    - _Requirements: 1.2, 1.3, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.1, 8.6, 8.8, 9.1, 12.2, 12.3_
  - [x] 6.2 Add freeze, unfreeze, EventBus subscriptions and `destroy`
    - Named bound handlers `_onActivated` and `_onDismissed` on `hotspot-activated`, `dialogue-dismissed`, `image-dismissed`
    - `freeze` and `unfreeze` are idempotent; freeze plays the idle frame; unfreeze changes no position; `isFrozen` getter; the controller never emits events
    - `destroy` removes exactly its three handlers, clears the trail, destroys the sprite if it still exists, and is safe to call twice
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.7, 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 6.3 Add Settling mode, box snapshot and `_settleBlocked` latch
    - Compute `playerStopped` before `stepTrail` (exact comparison against the newest sample); `mode` and `settleTarget` getters
    - Following to Settling: query `getCollisionBoxes` once in a `try`, `sanitizeBoxes`, `chooseSettleTarget`; on `null` or a throw, set `_settleBlocked` and hold; clear the latch on the first frame the Player moves
    - Settling steps: `stepToward` at `speed × min(dt, 100) / 1000`, clamp, validate the rounded position against the snapshot (abort, hold, reseed `[followerPos, playerFeet]`, set latch on failure), facing and walk animation from displacement; first step happens in the same update that settling starts
    - Arrival: snap, reseed `[target, playerFeet]`, idle frame; cancel on Player move: reseed `[followerPos, playerFeet]` with zero position change; teleport over 64 px wins over cancel
    - Freeze during Settling keeps mode and target; settling does not start or advance while frozen
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17, 13.18, 7.8, 8.6_
  - [x]* 6.4 Write property test for invalid inputs at controller level
    - File: `FollowerController.property.test.js` (mock sprite, real `EventBus` instance)
    - **Property 11: Invalid inputs are a no-op**
    - **Validates: Requirements 12.3**
  - [x]* 6.5 Write property test for the freeze state machine
    - File: `FollowerController.property.test.js`
    - **Property 15: Freeze state machine** (model-based; spy confirms no `emit`)
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.7**
  - [x]* 6.6 Write property test for whole-pixel placement
    - File: `FollowerController.property.test.js`
    - **Property 16: Whole-pixel sprite placement** (Following and Settling frames)
    - **Validates: Requirements 9.1, 8.1, 13.10**
  - [x]* 6.7 Write property test for settle step speed at controller level
    - File: `FollowerController.settle.property.test.js`
    - **Property 19: Settle step speed, snap, rounding and clamp (frame part)**
    - **Validates: Requirements 13.2, 13.3, 13.10, 4.6**
  - [x]* 6.8 Write property test for settle separation
    - File: `FollowerController.settle.property.test.js`
    - **Property 20: Settle separation**
    - **Validates: Requirements 13.11, 13.5, 13.3, 13.6**
  - [x]* 6.9 Write property test for cancel continuity
    - File: `FollowerController.settle.property.test.js`
    - **Property 21: Cancel continuity**
    - **Validates: Requirements 13.7, 13.6**
  - [x]* 6.10 Write property test for no settling while moving or frozen
    - File: `FollowerController.settle.property.test.js`
    - **Property 22: No settling while moving or frozen**
    - **Validates: Requirements 13.8, 13.9, 13.12**
  - [x]* 6.11 Write property test for valid settle steps and clear routes
    - File: `FollowerController.settle.property.test.js` (generated box sets, throwing stub, call-counting spy)
    - **Property 26: Settle steps stay valid and the route is clear**
    - **Validates: Requirements 13.5, 13.13, 13.14, 13.16, 13.18**
  - [x]* 6.12 Write example tests in `FollowerController.test.js`
    - Animations registered for four facings at the injected frame rate; `anims.create` skipped when `anims.exists` is true
    - Initial neutral frame per facing; walk/idle switching and facing retention
    - `hotspot-activated` freezes with idle in the same call; dismissals unfreeze
    - Motivating-case settle plays `follower-walk-right`, ends idle facing right, trail is `[target, player]`
    - Cancel leaves the sprite in place with a two-sample trail; freeze during Settling holds, then resumes
    - All candidates blocked: Follower holds and `getCollisionBoxes` is called exactly once over many stopped frames; a Player move clears the latch
    - Throwing `getCollisionBoxes` holds without throwing; `[null, {x: NaN}, validRect]` uses only `validRect`; default query is `() => []`; no query while the Player is moving
    - `destroy` removes only its three listeners, is idempotent; repeated create/destroy leaves one handler per event
    - _Requirements: 1.3, 5.2, 5.4, 6.1, 6.3, 11.1, 11.2, 11.3, 11.4, 11.5, 13.2, 13.3, 13.5, 13.6, 13.7, 13.9_

- [x] 7. Checkpoint - Ensure all tests pass
  - Run `npm run test` and `npm run lint` from `Front-end/`. Ask the user if questions arise.

- [x] 8. Wire the Follower into `src/phaser/GameScene.js`
  - [x] 8.1 Constructor fields, spritesheet load and `loaderror` branch
    - Add `followerController = null` and `_followerSpriteError = false`; reset the flag at the top of `preload()`
    - `this.load.spritesheet('follower', 'assets/sprites/Kelly_Sprite.png', { frameWidth: 32, frameHeight: 32 })` next to the player sheet
    - In the `loaderror` handler add a `FOLLOWER_SPRITE_KEY` branch before the generic `else`: set `_followerSpriteError`, one `console.warn` containing the key, never set `_loadError`
    - _Requirements: 1.1, 1.7, 10.1, 10.2, 10.4, 10.6_
  - [x] 8.2 Add `_createFollower`, `_getCollisionBoxes` and the shutdown hook
    - `_createFollower(minX, maxX, band)` called after the Player and its bounds exist: skip silently if `_followerSpriteError`, the texture is missing or `add.sprite` is unavailable; `add.sprite` (not `physics.add.sprite`) at the Player's rounded feet, origin `(0.5, 1)`, add to `sortGroup`; no collider or overlap; construct `FollowerController` with `speed = PLAYER_SPEED_PX_PER_SEC`, `frameRate = WALK_FRAME_RATE`, guarded `getFacingDirection` defaulting to `'down'`, `getCollisionBoxes: () => this._getCollisionBoxes()`; set horizontal and vertical bounds; `this.events.once('shutdown', this._onShutdown, this)` when `events` exists
    - `_getCollisionBoxes()` maps `collisionGroup.getChildren()` to `{ x, y, width, height }` from each `body`, returns `[]` for a missing group, skips body-less children
    - `_onShutdown()` destroys the controller and nulls the reference without error when none exists
    - _Requirements: 1.2, 1.3, 1.4, 7.1, 7.2, 7.3, 9.3, 10.1, 10.5, 11.1, 11.2, 11.3, 11.4, 11.5, 13.15, 13.16, 13.17_
  - [x] 8.3 Change `update(time, delta)` and add the depth override
    - After `playerController.update(...)` call `followerController.update(this.player, delta, this.playerController?.getFacingDirection?.() ?? 'down')` when the follower exists
    - After the Y-sort loop set the follower depth with `resolveFollowerDepth(follower.y, player.y)`
    - `InteractionManager` calls keep receiving only the player sprite
    - _Requirements: 1.4, 1.5, 1.6, 3.1, 7.3, 7.5, 7.6, 12.2_
  - [x]* 8.4 Write scene tests in `GameScene.follower.test.js` (existing `vi.mock('phaser', ...)` harness)
    - `preload()` loads the spritesheet with 32×32 frames; a `follower` `loaderror` leaves `_loadError` false and warns once; another sheet's `loaderror` still sets `_loadError`
    - Missing texture: `create()`, `update()` and shutdown run without throwing or extra warnings
    - Texture present: `add.sprite` used (not `physics.add.sprite`), origin `(0.5, 1)`, at the Player's rounded feet, scale 1, in `sortGroup`, no collider or overlap registered, no body
    - `update(time, delta)` passes `delta` and facing (default `'down'` when `getFacingDirection` is missing) after `playerController.update`; depth override applied
    - `InteractionManager` receives only the player; prompt stays hidden when only the Follower overlaps a zone
    - `_releaseSegment` leaves the trail unchanged
    - `_getCollisionBoxes()` against a fake static group: returns body rects, `[]` for a null group, skips body-less children, drops boxes of destroyed segment bodies while keeping start-map boxes, never includes the Player
    - Shutdown destroys the controller; a second `create()` builds exactly one new controller with a fresh trail
    - Existing `GameScene.test.js` stays green with `scene.update()` called without arguments
    - _Requirements: 1.1, 1.2, 1.4, 1.7, 7.1, 7.2, 7.3, 7.6, 8.2, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.3, 11.4, 13.16, 13.17_

- [x] 9. Integration and smoke tests
  - [x]* 9.1 Write the shipped-maps integration test in `follower.maps.integration.test.js`
    - Run the real `museum_start.json` and `museum_hallway.json` through `CollisionBuilder` with a plain group stub (no Phaser); assert every bench body is a plain axis-aligned rectangle and that `chooseSettleTarget` is non-null at a stop next to a bench
    - _Requirements: 13.4, 13.14, 13.16, 12.8_
  - [x]* 9.2 Write the smoke test in `follower.smoke.test.js`
    - Read the `Kelly_Sprite.png` PNG header and assert 128×128
    - Assert `config.js` still has `pixelArt: true`
    - Assert neither `followerTrail.js` nor `followerCollision.js` contains a `phaser` import
    - _Requirements: 1.1, 9.2, 12.1, 12.8_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run `npm run test` and `npm run lint` from `Front-end/`. Ask the user if questions arise.
  - Do not start the dev server; hand the user `npm run dev` (from `Front-end/`) to eyeball Kelly trailing, backtracking, settling beside Lorenzo, and freezing during memory overlays.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests validate the universal properties in the design; unit tests cover examples and edge cases
- Property test sub-tasks that share a file are scheduled in different waves to avoid write conflicts
- `GameScene.js` tasks 8.1 to 8.3 edit the same file and run in sequence

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.10", "2.14", "2.20", "4.1"] },
    { "id": 3, "tasks": ["2.4", "2.11", "2.15", "4.2", "4.5", "6.1"] },
    { "id": 4, "tasks": ["2.5", "2.12", "2.16", "4.3", "6.2"] },
    { "id": 5, "tasks": ["2.6", "2.13", "2.17", "4.4", "6.3"] },
    { "id": 6, "tasks": ["2.7", "2.18", "6.4", "6.7", "6.12", "8.1", "9.1", "9.2"] },
    { "id": 7, "tasks": ["2.8", "2.19", "6.5", "6.8", "8.2"] },
    { "id": 8, "tasks": ["2.9", "6.6", "6.9", "8.3"] },
    { "id": 9, "tasks": ["6.10", "8.4"] },
    { "id": 10, "tasks": ["6.11"] }
  ]
}
```
