# Requirements Document

## Introduction

The Living Museum currently has a single controlled character, Lorenzo, who walks the gallery hallway. This feature adds a second character, Kelly, who follows Lorenzo in the manner of a Pokémon party member: Kelly trails behind the player along the exact path the player has walked, rather than moving straight toward the player.

Kelly's movement is driven by a recorded history of the player's positions (a "breadcrumb trail"). Because Kelly replays the player's path, backtracking and direction changes look natural: when the player turns around, Kelly walks to the turning point and then follows back, instead of cutting through the player or snapping to a new position.

Kelly is purely a visual companion. Kelly has no collision body, never blocks the player, never triggers or blocks interaction zones, and freezes together with the player whenever a memory overlay is open. Kelly uses the existing `Kelly_Sprite.png` sheet and follows the engine conventions already in place: 16px tile grid, feet origin `(0.5, 1)` Y-sort depth, integer camera zoom, bounded hallway with recycled segments, and graceful asset failure handling. The game remains a static site with no backend.

## Glossary

- **Player**: The Lorenzo sprite controlled by the user, owned by `PlayerController`.
- **Follower**: The Kelly sprite that trails the Player. Rendered from `Kelly_Sprite.png`.
- **FollowerController**: The Phaser module that records the Player's path and moves, animates, and freezes the Follower.
- **Path_Trail**: The ordered list of recorded Player feet positions (world X, Y), oldest first, from which the Follower's position is sampled.
- **Trail_Sample**: A single entry in the Path_Trail, holding a world position of the Player's feet.
- **Follow_Distance**: The distance along the Path_Trail, measured in pixels of path length, that the Follower stays behind the Player. Set to 24 px by default and defined as a single named constant.
- **Path_Length**: The cumulative distance between consecutive Trail_Samples, summed from the Follower's position to the Player's position.
- **Facing**: One of `up`, `down`, `left`, `right`, matching the sprite sheet rows Down/Left/Right/Up.
- **Overlay**: A React dialogue box and/or image viewer opened by `hotspot-activated`, during which the Player is frozen.
- **Y_Sort_Group**: The set of sprites whose depth equals their feet world Y each frame (Player and decor).
- **Hallway_Bounds**: The horizontal range `[minX, maxX]` and vertical range `[minFeetY, maxFeetY]` that confine the Player's feet.
- **Follower_Sprite_Key**: The Phaser texture key for the Follower's sprite sheet (`follower`).
- **GameScene**: The Phaser scene that creates the Player, Follower, segments, and subsystems.
- **Min_Separation**: 16 px (one tile). The minimum straight-line (Euclidean) distance between the Follower's feet and the Player's feet once the Follower has settled. Defined as a single named constant.
- **Rest_Spot**: The point Follow_Distance (24 px) directly behind the Player, opposite the Player's Facing.
- **Player_Stopped**: The condition in which the Player's feet position is unchanged for the current frame update.
- **Settling**: The state in which the Follower walks from its current position to the settle target after the Player has stopped, as defined in Requirement 13.
- **Collision_Boxes**: The set of world-space axis-aligned rectangles built by CollisionBuilder from per-tile collision shapes for all currently instantiated map pieces (the start map and the live hallway segments). CollisionBuilder reduces every shape, including bench rectangles, to an axis-aligned bounding box.
- **Follower_Footprint**: A 16×16 px rectangle centered horizontally on the Follower's feet X and spanning from feet Y − 16 to feet Y, matching the Player's physics body footprint.
- **Valid_Position**: A feet position inside Hallway_Bounds whose Follower_Footprint does not overlap (positive-area intersection) any Collision_Box.

## Requirements

### Requirement 1: Load and display the Follower

**User Story:** As the recipient, I want Kelly to appear next to Lorenzo when the museum starts, so that I feel like we are exploring the gallery together.

#### Acceptance Criteria

1. WHEN GameScene preloads assets, THE GameScene SHALL load `assets/sprites/Kelly_Sprite.png` as a spritesheet with 32×32 pixel frames (4 columns × 4 rows, 16 frames total) under the Follower_Sprite_Key.
2. WHEN GameScene finishes creating the Player, THE GameScene SHALL create the Follower sprite with origin `(0.5, 1)` at the Player's spawn position, so that the Follower's feet world X and Y equal the Player's spawn feet world X and Y within 0 px.
3. WHEN the Follower is created, THE FollowerController SHALL set the Follower's initial Facing to the Player's Facing at that moment, and SHALL display the neutral frame (column 0) of the matching Facing row.
4. THE GameScene SHALL include the Follower in the Y_Sort_Group so that the Follower's depth equals its feet world Y, re-evaluated every frame in `update()`.
5. WHILE the Follower's feet world Y is greater than the Player's feet world Y, THE GameScene SHALL render the Follower in front of the Player.
6. WHILE the Follower's feet world Y is less than or equal to the Player's feet world Y, THE GameScene SHALL render the Follower behind the Player, so that the draw order is stable on every frame.
7. IF `assets/sprites/Kelly_Sprite.png` fails to load, THEN THE GameScene SHALL skip creating the Follower, SHALL continue creating the Player and the map, and SHALL NOT display the load-error message solely because of this failure.

### Requirement 2: Record the Player's path

**User Story:** As the recipient, I want Kelly to retrace the route I walked, so that her movement looks deliberate and natural.

#### Acceptance Criteria

1. WHEN the Player's feet position (x, y in world pixels) differs from the position of the newest Trail_Sample at the start of a frame update, THE FollowerController SHALL append exactly one Trail_Sample holding the Player's new feet position to the end of the Path_Trail.
2. WHILE the Player's feet position equals the position of the newest Trail_Sample, THE FollowerController SHALL leave the Path_Trail unchanged.
3. THE FollowerController SHALL keep Trail_Samples ordered from oldest to newest in the order the Player visited them, with no duplicate consecutive positions.
4. WHEN the Path_Length from the oldest to the newest Trail_Sample exceeds Follow_Distance plus 32 px, THE FollowerController SHALL discard Trail_Samples from the oldest end until the Path_Length is at most Follow_Distance plus 32 px, while retaining at least 1 Trail_Sample and never discarding any Trail_Sample the Follower has not yet passed.
5. IF appending a Trail_Sample would make the Path_Trail hold more than 256 Trail_Samples, THEN THE FollowerController SHALL discard the oldest Trail_Sample so that the Path_Trail holds at most 256 Trail_Samples.
6. WHEN the Path_Trail is empty at the first frame update after the scene starts, THE FollowerController SHALL seed the Path_Trail with exactly 1 Trail_Sample holding the Player's current feet position.

### Requirement 3: Follow along the recorded path

**User Story:** As the recipient, I want Kelly to stay a short, consistent distance behind me, so that she trails me like a party member.

#### Acceptance Criteria

1. WHILE the Path_Length from the Follower to the Player exceeds Follow_Distance, THE FollowerController SHALL move the Follower along the Path_Trail toward the Player on every frame.
2. WHILE the Player is moving and the Path_Length from the Follower to the Player is at least Follow_Distance, THE FollowerController SHALL keep the Follower on the Path_Trail at the point whose Path_Length to the Player equals Follow_Distance, within 1 px.
3. WHILE the Follower moves along the Path_Trail, THE FollowerController SHALL limit the Follower's speed to no more than the Player's walk speed (`PLAYER_SPEED_PX_PER_SEC`, 80 px/s), measured over any 100 ms window.
4. WHEN the Player stops moving, THE FollowerController SHALL continue moving the Follower along the Path_Trail until the Path_Length from the Follower to the Player is within 1 px of Follow_Distance, and SHALL then stop the Follower within 1 frame.
5. WHILE the Path_Length from the Follower to the Player is at most Follow_Distance, THE FollowerController SHALL hold the Follower at its current position, except while settling per Requirement 13.
6. THE FollowerController SHALL set the Follower's position only to points on the Path_Trail, excluding the whole-pixel rounding in Requirement 9 and except while settling per Requirement 13.
7. IF the Path_Trail is too short to place the Follower at Follow_Distance (for example at game start), THEN THE FollowerController SHALL hold the Follower at its current position without producing an error.

### Requirement 4: Handle backtracking and direction changes

**User Story:** As the recipient, I want Kelly to handle me turning around or zig-zagging, so that she never cuts through me or teleports.

#### Acceptance Criteria

1. WHEN the Player reverses direction, THE FollowerController SHALL keep moving the Follower along the Path_Trail at its normal follow speed to the Trail_Sample recorded at the reversal point, and only then SHALL move the Follower along the samples recorded after the reversal.
2. WHEN the Player changes direction at a corner, THE FollowerController SHALL move the Follower through the corner Trail_Sample (within 0 px) before it moves onto the next trail segment.
3. WHEN the Player walks back over positions already recorded in the Path_Trail, THE FollowerController SHALL append the new Trail_Samples to the end without removing, modifying, or reordering any earlier Trail_Sample the Follower has not yet passed.
4. WHILE the Player moves back toward the Follower, THE FollowerController SHALL keep the Follower on the Path_Trail rather than moving it in a straight line toward the Player.
5. WHEN the Player moves back toward the Follower and the Path_Length from the Follower to the Player is less than Follow_Distance, THE FollowerController SHALL hold the Follower at its current position until the Path_Length is at least Follow_Distance, except while settling per Requirement 13.
6. THE FollowerController SHALL move the Follower by no more than the Player's walk speed multiplied by the frame delta, plus 1 px, in any single frame, including the frame in which the Player reverses.
7. FOR ALL sequences of Player moves, WHILE the Player is moving and the Follower is not settling per Requirement 13, the Follower's position after processing SHALL lie on the polyline formed by the Path_Trail, within 0.01 px (path-membership property).
8. IF the Path_Trail contains no Trail_Sample ahead of the Follower, THEN THE FollowerController SHALL hold the Follower at its current position until a new Trail_Sample is appended.

### Requirement 5: Animate the Follower with correct facing

**User Story:** As the recipient, I want Kelly's walking animation to match the direction she is heading, so that she looks alive and stays in sync with her movement.

#### Acceptance Criteria

1. WHEN the Follower's position changes by at least 0.1 px on either axis between two updates, THE FollowerController SHALL set the Follower's Facing to the dominant axis direction of that movement (`left`/`right` for x, `up`/`down` for y), and SHALL use the horizontal direction when both displacements are equal.
2. WHILE the Follower is moving (at least 0.1 px per update), THE FollowerController SHALL play the walk animation for the Follower's Facing at the same frame rate as the Player's walk animation (4 fps), and SHALL switch animations in the same update that the Facing changes.
3. WHILE the Follower is not moving, THE FollowerController SHALL display the idle frame (column 0) of the row for the Follower's Facing.
4. THE FollowerController SHALL register walk and idle animations for all four Facings with keys prefixed `follower-walk-` and `follower-idle-`, so they do not collide with the Player's `player-walk-` / `player-idle-` keys, and SHALL reuse existing registrations without error when the scene restarts.
5. WHEN the Follower stops after moving, THE FollowerController SHALL keep the Facing from its last movement until the next movement occurs.
6. THE FollowerController SHALL map sprite sheet rows to Facing as row 0 = down, row 1 = left, row 2 = right, row 3 = up, and frame index as `row * 4 + column`.

### Requirement 6: Freeze with the Player during Overlays

**User Story:** As the recipient, I want Kelly to pause while I read a memory, so that nothing moves behind the dialogue box and she carries on correctly afterward.

#### Acceptance Criteria

1. WHEN `hotspot-activated` is emitted, THE FollowerController SHALL freeze the Follower and show the idle frame for its Facing within the same frame update.
2. WHILE the Follower is frozen, THE FollowerController SHALL hold the Follower at its current position, SHALL NOT advance the walk animation, and SHALL leave the Path_Trail unchanged.
3. WHEN `dialogue-dismissed` or `image-dismissed` is emitted while the Follower is frozen, THE FollowerController SHALL unfreeze the Follower within the same frame update.
4. IF `dialogue-dismissed` or `image-dismissed` is emitted while the Follower is not frozen, THEN THE FollowerController SHALL leave its state, position, and the Path_Trail unchanged.
5. IF `hotspot-activated` is emitted while the Follower is already frozen, THEN THE FollowerController SHALL keep it frozen and leave its position and the Path_Trail unchanged.
6. WHEN the Follower is unfrozen, THE FollowerController SHALL resume following the Path_Trail from its position at the time of the freeze, with no position jump.
7. WHEN the Follower is unfrozen, THE FollowerController SHALL leave its position unchanged until the Player next moves, the Path_Length from the Follower to the Player exceeds Follow_Distance, or the conditions for settling in Requirement 13 criterion 1 hold.

### Requirement 7: Leave movement and interaction unaffected

**User Story:** As the recipient, I want Kelly to never get in my way, so that I can walk up to any painting and press E without trouble.

#### Acceptance Criteria

1. THE GameScene SHALL create the Follower without an Arcade Physics body, so that it has no body in the physics world for the scene's lifetime.
2. THE GameScene SHALL register no collider or overlap between the Follower and the static bodies built by CollisionBuilder.
3. THE GameScene SHALL exclude the Follower from every overlap check used by InteractionManager, so that the set of active interaction zones depends on the Player's position alone.
4. WHILE the Follower is within 16 px of the Player, THE GameScene SHALL keep the Player's speed at `PLAYER_SPEED_PX_PER_SEC`, its physics body at 16×16 px, and its collision results identical to those without the Follower.
5. WHEN the Player overlaps an interaction zone and `E` is pressed, THE InteractionManager SHALL emit `hotspot-activated` exactly once, regardless of the Follower's position.
6. WHILE the Player overlaps no interaction zone, THE PromptLabel SHALL remain hidden, even if the Follower overlaps one.
7. THE FollowerController SHALL NOT emit any EventBus event.
8. THE Follower SHALL remain without an Arcade Physics body even though Requirement 13 checks Collision_Boxes during settling; those checks are rectangle-overlap arithmetic only and SHALL NOT make the Follower block, or be blocked by, any static body.

### Requirement 8: Stay within the hallway and across segments

**User Story:** As the recipient, I want Kelly to stay on the floor and keep up as the hallway extends, so that she never disappears or walks through walls.

#### Acceptance Criteria

1. THE FollowerController SHALL keep the Follower within the same Hallway_Bounds that apply to the Player on every frame.
2. WHEN SegmentManager recycles a segment behind the Player, THE FollowerController SHALL leave the Follower's position and every stored Trail_Sample unchanged.
3. THE FollowerController SHALL store Trail_Samples in world coordinates, so that segment generation and recycling never shift them.
4. WHILE the Player is at the left bound, THE FollowerController SHALL keep the Follower's x at or to the right of the left bound.
5. WHILE the Player is at the right bound of the final segment (Final_Segment_Index), THE FollowerController SHALL keep the Follower's x at or to the left of that bound.
6. WHEN the Player's position changes by more than 64 px between two consecutive frames without walking input, THE FollowerController SHALL in that frame clear the Path_Trail, place the Follower at the Player's position, and restart recording from there.
7. WHEN the Player's position changes by 64 px or less between frames, THE FollowerController SHALL keep the existing Path_Trail.
8. IF the Follower's target position falls outside the Hallway_Bounds, THEN THE FollowerController SHALL clamp it to the nearest point inside the bounds.

### Requirement 9: Preserve the pixel-art look

**User Story:** As the recipient, I want Kelly to look as crisp as Lorenzo, so that the retro feel is unbroken.

#### Acceptance Criteria

1. THE FollowerController SHALL set the Follower's world X and Y to integer values on every frame, including the frame in which it stops.
2. THE GameScene SHALL render the Follower's texture with the same nearest-neighbor filtering as the Player's, so no blur is introduced.
3. THE GameScene SHALL render the Follower at the same display scale as the Player.

### Requirement 10: Handle asset failures gracefully

**User Story:** As the recipient, I want the game to keep working even if Kelly's sprite cannot load, so that a missing file never stops me from seeing the memories.

#### Acceptance Criteria

1. IF the Follower sprite sheet fails to load, THEN THE GameScene SHALL complete `create()` and run the update loop without a Follower, rendering the gallery and the Player as it does when the Follower exists.
2. IF the Follower sprite sheet fails to load, THEN THE GameScene SHALL leave `_loadError` unset and SHALL NOT show the asset-error message.
3. IF the Follower sprite sheet fails to load, THEN THE GameScene SHALL keep Player movement, camera follow, interaction zones with the `[E]` prompt, overlays, and Player freeze/unfreeze working with no difference from the Follower-present case.
4. IF the Follower sprite sheet fails to load, THEN THE GameScene SHALL log exactly one warning containing the Follower_Sprite_Key.
5. IF the Follower does not exist, THEN THE GameScene SHALL skip every Follower update, freeze, and unfreeze call without throwing or logging additional warnings.
6. IF any other required sprite sheet fails to load, THEN THE GameScene SHALL set `_loadError` and show the readable error message as before this feature.

### Requirement 11: Clean up on scene shutdown

**User Story:** As the developer, I want the Follower to release its resources when the scene shuts down, so that restarts do not leak listeners or sprites.

#### Acceptance Criteria

1. WHEN GameScene shuts down, THE FollowerController SHALL clear the Path_Trail and drop its reference to the Follower sprite.
2. WHEN GameScene shuts down, THE GameScene SHALL remove the `hotspot-activated`, `dialogue-dismissed`, and `image-dismissed` listeners that the Follower registered, so none invoke a Follower handler afterward.
3. WHEN GameScene shuts down, THE GameScene SHALL destroy the Follower sprite.
4. WHEN GameScene is created again after a shutdown, THE GameScene SHALL create exactly 1 new Follower, an empty Path_Trail, and exactly 1 Follower handler per event.
5. IF GameScene shuts down before the Follower was created, THEN THE GameScene SHALL finish shutdown without error and without removing listeners registered by other components.

### Requirement 12: Testability of the trail logic

**User Story:** As the developer, I want the trail and follow arithmetic to be pure and testable without a live Phaser scene, so that I can cover backtracking edge cases with property-based tests.

#### Acceptance Criteria

1. THE FollowerController SHALL expose the Path_Trail recording, trimming, and sampling arithmetic as functions whose inputs and outputs are plain objects with numeric x and y values, with no Phaser objects or imports.
2. THE FollowerController SHALL accept the Follower sprite, Follow_Distance, and the frame delta as injected inputs rather than reading module-level or global state.
3. IF Follow_Distance or the frame delta is negative or not a finite number, THEN THE FollowerController SHALL leave the Path_Trail and the Follower position unchanged without throwing.
4. FOR ALL sequences of Player positions, the sampled Follower position SHALL be at a Path_Length of at most Follow_Distance plus 0.001 px from the Player's current position (distance invariant), except while settling per Requirement 13.
5. FOR ALL sequences of Player positions, trimming the Path_Trail SHALL leave the sampled Follower position unchanged within 0.001 px per coordinate (trim-neutrality property).
6. FOR ALL Player position sequences, applying the same sequence again with no Player movement in between SHALL produce the same Follower position within 0.001 px per coordinate (idempotence property).
7. FOR ALL sequences of Player moves that end by returning exactly along the path just walked, the Follower SHALL end on a segment of the walked path within 0.001 px (backtracking property), evaluated before any settle step per Requirement 13 begins.
8. THE FollowerController SHALL expose the validity check (Follower_Footprint construction, rectangle-overlap test, and segment-versus-box sweep) as pure functions over plain rectangles and points with numeric values, with no Phaser objects or imports.

### Requirement 13: Settle without overlapping when the Player stops

**User Story:** As the recipient, when I stop, I want Kelly to step out from under me so we're standing together, not on top of each other.

#### Acceptance Criteria

1. WHEN the Player_Stopped condition holds AND the Follower has finished following (the Path_Length from the Follower to the Player is at most Follow_Distance plus 1 px) AND the straight-line distance between the Follower's feet and the Player's feet is less than Min_Separation, THE FollowerController SHALL begin settling by moving the Follower toward the target selected per criterion 4.
2. WHILE settling, THE FollowerController SHALL move the Follower toward the target at a speed greater than 0 and no more than the Player's walk speed, play the walk animation for the Follower's direction of travel, and set the Follower's Facing to that direction of travel using the rule in Requirement 5.1.
3. WHEN the Follower arrives at the target (the Follower's feet are within 1 px of the target), THE FollowerController SHALL snap the Follower's feet to the target, stop the walk animation, and show the idle frame for the Facing of its last movement, consistent with Requirement 5.5.
4. WHEN settling begins, THE FollowerController SHALL select as the target the first Valid_Position from this ordered list of candidates: the Rest_Spot (behind the Player), the point Follow_Distance from the Player in the direction of the Player's Facing (in front), the point Follow_Distance above the Player, the point Follow_Distance below the Player.
5. IF no candidate in criterion 4 is a Valid_Position, THEN THE FollowerController SHALL NOT settle and SHALL hold the Follower at its current position, with no clamped fallback.
6. WHEN the Follower arrives at the target, THE FollowerController SHALL reseed the Path_Trail as exactly 2 Trail_Samples, [target, Player feet], with the Follower at the target, so that normal path following resumes when the Player next moves.
7. WHEN the Player starts moving while the Follower is settling, THE FollowerController SHALL cancel the settling, reseed the Path_Trail as exactly 2 Trail_Samples, [the Follower's current position, the Player's feet position], and resume normal following with a Follower position change of 0 px on the frame of cancellation.
8. WHILE the Player is moving, THE FollowerController SHALL NOT apply the settle behavior, so that brief overlap between the Follower and the Player while moving is permitted.
9. WHILE the Follower is frozen, THE FollowerController SHALL NOT settle, and WHEN the Follower is unfrozen, THE FollowerController SHALL begin settling on the first update in which the conditions in criterion 1 hold.
10. THE FollowerController SHALL apply the Hallway_Bounds clamp (Requirement 8), the whole-pixel rounding (Requirement 9), and the per-frame speed bound (Requirement 4.6) to every settle step.
11. FOR ALL walks that end with the Player stopped for long enough to settle, the final straight-line distance between the Follower's feet and the Player's feet SHALL be at least Min_Separation, unless no candidate is a Valid_Position (settle-separation property). "Long enough to settle" means the Player remains stopped for at least the time the Follower needs to travel Follow_Distance at the Player's walk speed plus 500 ms.
12. IF the Follower is already at least Min_Separation from the Player's feet when the Player_Stopped condition first holds, THEN THE FollowerController SHALL NOT begin settling and SHALL leave the Follower's position unchanged.
13. WHILE settling, THE FollowerController SHALL move the Follower only through Valid_Positions, so that every intermediate position is a Valid_Position.
14. IF the straight segment from the Follower's current position to a candidate passes through a Collision_Box, THEN THE FollowerController SHALL treat that candidate as invalid and try the next candidate in the list of criterion 4.
15. THE FollowerController SHALL perform the checks in criteria 4, 5, 13, and 14 using rectangle-overlap tests only, without creating a physics body for the Follower, so that Requirement 7 continues to hold.
16. THE GameScene SHALL supply the FollowerController with the current Collision_Boxes through an injected query function, and Collision_Boxes belonging to recycled segments SHALL NOT be considered.
17. THE FollowerController SHALL ignore the Player's own body in every validity check, so that the Follower may still pass through the Player.
18. FOR ALL settle sequences, the Follower_Footprint SHALL NOT overlap any Collision_Box at any settle step (settle-validity property).
