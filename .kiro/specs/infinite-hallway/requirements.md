# Requirements Document

## Introduction

The Infinite Hallway feature turns the Memories Museum from a single fixed room into a procedurally stitched gallery that reads as a finite walk through a relationship timeline. On load, the player spawns at the left end of the fixed start map (`museum_start`). Walking right procedurally extends the world by stitching copies of the hallway map (`museum_hallway`) ahead of the player, but the hallway extends only far enough to contain the last authored memory: generation stops at the final segment that holds the highest authored memory index. The museum is therefore bounded on the left by the start map and on the right by that final segment. Any frames in the final room that sit beyond the last authored memory are "future" frames that, when activated, show a short note rather than a saved memory. The game tracks how many hallway segments have been generated and traversed so that walking back left retraces every segment already created and eventually returns the player to the start map, which acts as the permanent leftmost boundary.

The feature also brings the runtime in line with the real authored assets. The current `GameScene` loads non-existent `madison-map.json` / `madison` tileset assets and derives collision from a dedicated `collision` tile layer; the authored maps are Tiled `.tmx` files using two tilesets (`museum_tileset`, `museum_decor`) with per-tile collision shapes and no collision layer. This feature corrects asset loading, drives collision from per-tile collision shapes (approximated as bounding boxes), keeps `Tile Layer 2` decor participating in feet-origin Y-sorting so the player can pass in front of or behind it, and adds a floating `[E]` interaction prompt that appears when the player stands in a frame's interaction zone.

The game remains a static, self-contained site with no backend. The Phaser↔React boundary continues to communicate only through the `EventBus` singleton.

## Glossary

- **Game**: The complete Memories Museum runtime (Phaser scene plus React UI).
- **Game_Scene**: The Phaser scene (`GameScene.js`) that loads maps, spawns the player, builds layers, drives movement, Y-sorting, camera, and collision.
- **Start_Map**: The `museum_start` map. The fixed leftmost region of the world and the permanent left boundary. Contains the `player_spawn` object and an empty object layer.
- **Hallway_Map**: The `museum_hallway` map, a 58×15, 16px-tile reusable section with floor, back wall (`Tile Layer 1`), decor/frames (`Tile Layer 2`), and interaction zones (`Object Layer 1`).
- **Hallway_Segment**: One instantiated copy of the Hallway_Map placed at a specific world offset to the right of the Start_Map.
- **Segment_Manager**: The Game_Scene subsystem responsible for generating, positioning, counting, and recycling Hallway_Segments.
- **Segment_Count**: The running total number of distinct Hallway_Segments that have been generated (the highest segment index reached plus one), used to define the rightward extent traversed so far.
- **Loaded_Window**: The bounded set of Hallway_Segments currently instantiated (rendered with live collision and decor) around the player at any moment.
- **Map_Converter**: The build-time/author-time step that converts the Tiled `.tmx` maps into Tiled JSON consumable by Phaser's `tilemapTiledJSON` loader.
- **Tileset_Image**: A tileset PNG referenced by the maps: `museum_tileset` and `museum_decor`.
- **Collision_Tile**: A tile whose tileset definition carries a tile-collision object group (a collision shape).
- **Floor_Tile**: A tile with no tile-collision object group; walkable.
- **Collision_AABB**: The axis-aligned bounding box of a Collision_Tile's collision shape, used as the blocking region for arcade physics.
- **Y_Sort_Group**: The feet-origin depth-sort group whose members are re-depthed to their world Y every frame (`origin (0.5, 1)`, `depth = y`).
- **Layer2_Sprite**: A per-tile sortable sprite created from a `Tile Layer 2` tile and added to the Y_Sort_Group.
- **Interaction_Zone**: A rectangular/polygonal object from a Hallway_Segment's `Object Layer 1` positioned on the floor in front of a frame; doubles as a memory activation region. An Interaction_Zone carries no authored content in Tiled; it resolves its memory content at runtime via its Memory_Index. A zone whose Memory_Index is less than the Authored_Memory_Count resolves to a Memories_Manifest entry; a zone whose Memory_Index is greater than or equal to the Authored_Memory_Count is a Future_Zone.
- **Zone_Index**: An integer from 0 to 5, the left-to-right rank (by local x position) of an Interaction_Zone within its Hallway_Segment (leftmost zone = 0).
- **Memory_Index**: The global 0-based memory number for an Interaction_Zone, computed as Segment_Index * 6 + Zone_Index.
- **Memories_Manifest**: A static, in-app data structure (JS/JSON) of Authored_Memory_Count entries, mapping each Memory_Index in 0..N-1 to `{ text: string[], imageUrl: string | null }`. It is the sole source of authored memory content. No backend or network dependency.
- **Authored_Memory_Count (N)**: The number of entries in the Memories_Manifest. Authored memory indices run 0..N-1.
- **Last_Memory_Index**: The highest authored Memory_Index, equal to N-1 when N is greater than or equal to 1; undefined when N is 0.
- **Final_Segment_Index**: The index of the rightmost (last) Hallway_Segment that ever exists, equal to floor((N-1)/6) when N is greater than or equal to 1, and 0 when N is 0. No Hallway_Segment with an index greater than Final_Segment_Index is ever generated.
- **Future_Zone**: An Interaction_Zone whose Memory_Index is greater than or equal to N. Because generation stops at Final_Segment_Index, Future_Zones exist only within the final segment. Activating a Future_Zone opens the Future_Memory_Overlay.
- **Future_Memory_Overlay**: A dialogue Overlay whose payload is a single dialogue page with the exact text "A future memory, not yet saved ❤" and no image (`imageUrl` null). It freezes the Player and is dismissed exactly like an authored memory Overlay.
- **Prompt_Label**: The floating `[E]` text shown above the player while the player is inside an Interaction_Zone.
- **Interaction_Key**: The single dedicated open key `E`, which opens the memory when pressed while the Player is inside an Interaction_Zone and no Overlay is open.
- **Open_Key**: The `E` key. Opens a memory when the Player overlaps an Interaction_Zone and no Overlay is open; does nothing while an Overlay is open.
- **Advance_Key**: The `Space` key. While an Overlay is open, advances (traverses) dialogue pages forward; pressing it on the last page dismisses the Overlay. Never opens a memory.
- **Dismiss_Key**: The `Esc` key. While an Overlay is open, dismisses the Overlay at any page. Never opens a memory.
- **Overlay**: A React dialogue box and/or image viewer displayed in response to `hotspot-activated`.
- **Event_Bus**: The pub/sub singleton (`EventBus.js`) that is the sole channel between Game_Scene and React.
- **Player**: The controllable 16×32 character sprite.

## Requirements

### Requirement 1: Correct asset conversion and loading

**User Story:** As the developer, I want the Game to load the real authored museum maps and tilesets, so that the game renders the intended gallery instead of failing on missing placeholder assets.

#### Acceptance Criteria

1. THE Map_Converter SHALL produce a Tiled JSON equivalent of the `museum_start` map that preserves `Tile Layer 1`, `Tile Layer 2`, `Object Layer 1`, and per-tile collision data.
2. THE Map_Converter SHALL produce a Tiled JSON equivalent of the `museum_hallway` map that preserves `Tile Layer 1`, `Tile Layer 2`, `Object Layer 1`, and per-tile collision data.
3. WHEN the Game_Scene preloads, THE Game_Scene SHALL load the converted `museum_start` and `museum_hallway` Tiled JSON maps.
4. WHEN the Game_Scene preloads, THE Game_Scene SHALL load the `museum_tileset` Tileset_Image and the `museum_decor` Tileset_Image.
5. WHEN the Game_Scene adds tilesets to a loaded map, THE Game_Scene SHALL associate the `museum_tileset` name (firstgid 1) and the `museum_decor` name (firstgid 41) with their corresponding loaded Tileset_Images so that every tile index renders the correct source frame.
6. THE Game_Scene SHALL NOT reference the `madison-map` map or the `madison` tileset.
7. IF a map references a tileset that is not loaded or whose name does not match a loaded Tileset_Image, THEN THE Game_Scene SHALL display a readable error message identifying the missing tileset instead of building the scene.

### Requirement 2: Spawn at the left of the start map

**User Story:** As the Player, I want to begin at the left end of the gallery, so that the entire hallway lies ahead of me to the right.

#### Acceptance Criteria

1. WHEN the Game loads and the Start_Map defines a `player_spawn` object, THE Game_Scene SHALL spawn the Player with the Player's position set to the `player_spawn` object's x and y coordinates.
2. IF the Start_Map defines no `player_spawn` object, THEN THE Game_Scene SHALL spawn the Player at a fixed fallback position that is a Floor_Tile within the Start_Map, where a Floor_Tile is a tile that is not collidable (passable).
3. WHEN the Player spawns, THE Game_Scene SHALL place the Player on a Floor_Tile such that the Player's feet position (origin 0.5, 1) rests on a passable, non-collidable tile.
4. WHEN the Player spawns, THE Game_Scene SHALL set the Player's horizontal position within the leftmost floor region of the Start_Map such that no Hallway_Segment and no passable floor tile exists at an x coordinate less than the Player's spawn x.
5. WHEN the Player spawns, THE Game_Scene SHALL constrain the Player's spawn position to lie within the Start_Map world bounds (x from 0 to map width in pixels, y from 0 to map height in pixels).

### Requirement 3: Rightward bounded hallway generation

**User Story:** As the Player, I want the hallway to extend as I walk right up to the room that holds the last saved memory, so that the gallery reads as a finite, growing timeline.

#### Acceptance Criteria

1. THE Segment_Manager SHALL position the first Hallway_Segment so that its left edge is adjacent to the right edge of the Start_Map with zero horizontal gap and identical floor row Y, so that the floor is continuous and gap-free across the Start_Map-to-Hallway_Segment seam.
2. WHILE the Player advances right AND the currently rightmost Loaded_Window segment's index is less than the Final_Segment_Index, THE Segment_Manager SHALL generate the next Hallway_Segment when the Player is within 928 pixels (one 58-tile segment width at 16 pixels per tile) of the right edge of the currently rightmost Loaded_Window segment, such that the next segment exists before the Player reaches that right edge.
3. THE Segment_Manager SHALL NOT generate any Hallway_Segment whose segment index is greater than the Final_Segment_Index.
4. WHEN the Player reaches the right edge of the final segment's floor, THE Segment_Manager SHALL generate no further Hallway_Segment to the right of the final segment.
5. WHEN a new Hallway_Segment is generated, THE Segment_Manager SHALL position the new Hallway_Segment so that its left edge is adjacent to the right edge of the segment immediately to its left with zero horizontal gap and identical floor row Y.
6. THE Segment_Manager SHALL limit the Loaded_Window to at most 3 concurrently instantiated Hallway_Segments.
7. WHEN generating a new Hallway_Segment would raise the count of instantiated Hallway_Segments above 3, THE Segment_Manager SHALL recycle the instantiated Hallway_Segment whose right edge is furthest behind (left of) the Player, and only while that segment's right edge is at least 928 pixels to the left of the Player's X position.
8. WHEN a Hallway_Segment is recycled, THE Segment_Manager SHALL release that segment's Layer2_Sprites, Collision_AABBs, and Interaction_Zones.
9. IF a new Hallway_Segment cannot be generated or cannot be positioned flush against the segment to its left, THEN THE Segment_Manager SHALL retain the current rightmost segment unchanged, block the Player at the right edge of that segment, and surface an error indication that hallway extension failed, without releasing any already-loaded segment.

### Requirement 4: Segment counting

**User Story:** As the developer, I want the Game to track how many hallway segments have been traversed, so that the leftward return and the world extent are well-defined.

#### Acceptance Criteria

1. Before any Hallway_Segment is generated, THE Segment_Manager SHALL hold a Segment_Count of 0.
2. WHEN the Hallway_Segment at index 0 is generated, THE Segment_Manager SHALL set the Segment_Count to 1.
3. WHEN the Player advances right and a Hallway_Segment at a segment index greater than every previously generated segment index is generated, THE Segment_Manager SHALL increment the Segment_Count by exactly 1.
4. WHILE the Player moves left through already-traversed segments, THE Segment_Manager SHALL leave the Segment_Count unchanged.
5. THE Segment_Manager SHALL assign each Hallway_Segment a segment index corresponding to its position in the sequence to the right of the Start_Map, starting at index 0 for the segment adjacent to the Start_Map.
6. THE Segment_Manager SHALL keep the Segment_Count equal to the number of distinct segment indices that have been generated (the highest generated segment index plus one).
7. THE Segment_Manager SHALL keep the Segment_Count less than or equal to Final_Segment_Index + 1, and SHALL never raise the Segment_Count above Final_Segment_Index + 1.

### Requirement 5: Leftward return with the start map as a hard boundary

**User Story:** As the Player, I want walking back left to retrace the hallway I already traversed and return me to the start room, so that the world is coherent and bounded on the left.

> Note: The symmetric right boundary (a hard clamp at the right edge of the final segment's floor) is specified in Requirement 13 so that the bounded-hallway behavior lives together with the future-memory behavior. Criterion 5.3/5.4 (left clamp) and Requirement 13.3/13.4 (right clamp) are mirror images and SHALL remain consistent.

#### Acceptance Criteria

1. WHILE the Player moves left, THE Segment_Manager SHALL re-instantiate previously traversed Hallway_Segments as each enters the Loaded_Window, in strictly descending segment-index order (highest index first down to index 0), such that the Player passes back through the exact sequence of segment indices in the reverse of the order they were first traversed.
2. WHEN the Player's horizontal position crosses the left edge of the leftmost Hallway_Segment (segment index 0), THE Game_Scene SHALL present the Start_Map positioned so its floor is horizontally continuous with the index-0 segment floor with zero gap and zero overlap at the shared edge.
3. THE Game_Scene SHALL clamp the Player's world X position so it is never less than the world X of the left edge of the Start_Map floor; a leftward input at that edge SHALL leave the Player's X position unchanged.
4. IF a leftward movement input would place the Player at a world X position left of the Start_Map floor's left edge, THEN THE Game_Scene SHALL reject the movement, hold the Player at the Start_Map left-edge X position, and continue normal play without generating any segment or entering an error state.
5. WHILE the Player is positioned within the Start_Map, THE Segment_Manager SHALL NOT generate, instantiate, or hold in the Loaded_Window any Hallway_Segment whose index is less than 0 or whose position is left of the Start_Map.
6. WHEN the Player re-enters a previously traversed segment index, THE Game_Scene SHALL render that segment with the identical decor layout and the identical set of Interaction_Zones (same ids, same relative positions) that were presented when that segment index was first traversed.

### Requirement 6: Floor-only movement via per-tile bounding-box collision

**User Story:** As the Player, I want to walk only on the floor and be blocked by walls and solid decor, so that movement respects the gallery's architecture.

#### Acceptance Criteria

1. THE Game_Scene SHALL derive collision from the per-tile collision shapes defined in the `museum_tileset` and `museum_decor` tilesets.
2. WHERE a tile has no collision shape defined in its tileset, THE Game_Scene SHALL treat that tile as a Floor_Tile and SHALL allow the Player to occupy and move across every pixel of that tile's area.
3. WHERE a tile has one or more collision shapes defined in its tileset, THE Game_Scene SHALL treat that tile as a Collision_Tile and SHALL prevent the Player's physics body from overlapping the tile's Collision_AABB, stopping Player movement at the Collision_AABB boundary.
4. THE Game_Scene SHALL approximate each Collision_Tile's collision region as the axis-aligned bounding box that fully encloses that tile's collision shape.
5. THE Game_Scene SHALL resolve collisions between the Player's physics body and Collision_AABBs using arcade physics.
6. THE Game_Scene SHALL NOT derive collision from a dedicated `collision` tile layer.
7. WHEN a Hallway_Segment is generated, THE Game_Scene SHALL position each of that segment's Collision_AABBs by offsetting the tile-local collision shape coordinates by the segment's world offset.
8. IF a tile references a tileset whose collision shape data is absent or cannot be parsed, THEN THE Game_Scene SHALL treat that tile as a Floor_Tile and SHALL continue generating the remaining segment without halting.

### Requirement 7: Y-sorting of Layer 2 decor

**User Story:** As the Player, I want to walk in front of and behind frames, props, and columns, so that the gallery has convincing 2.5D depth.

#### Acceptance Criteria

1. WHEN a map or Hallway_Segment is built, THE Game_Scene SHALL create exactly one Layer2_Sprite in the Y_Sort_Group for each `Tile Layer 2` tile whose tile index is not an empty-tile index (not -1 and not 0), and SHALL create no Layer2_Sprite for empty-tile-index tiles.
2. WHEN a Layer2_Sprite or the Player is created, THE Game_Scene SHALL set its origin to the bottom-center (0.5, 1) so that its world Y equals the world Y of its feet.
3. WHILE the scene is running, THE Game_Scene SHALL, once per rendered frame, set the depth of every Y_Sort_Group member to the numeric value of that member's feet world Y.
4. WHILE the Player's feet world Y is strictly less than a Layer2_Sprite's feet world Y, THE Game_Scene SHALL render the Player behind that Layer2_Sprite.
5. WHILE the Player's feet world Y is strictly greater than a Layer2_Sprite's feet world Y, THE Game_Scene SHALL render the Player in front of that Layer2_Sprite.
6. IF the Player's feet world Y equals a Layer2_Sprite's feet world Y, THEN THE Game_Scene SHALL assign both members the same depth value and SHALL not crash or raise an error.
7. THE Game_Scene SHALL render `Tile Layer 1` floor and back-wall tiles at a fixed depth strictly lower than the depth of every Y_Sort_Group member, so floor and back-wall tiles always draw below all Y_Sort_Group members.

### Requirement 8: Floating interaction prompt

**User Story:** As the Player, I want an `[E]` prompt to appear above me when I stand in front of a frame, so that I know I can interact with that memory.

#### Acceptance Criteria

1. WHILE the Player's physics body overlaps an Interaction_Zone AND no Overlay is open, THE Game_Scene SHALL display the Prompt_Label showing the text `[E]` at a fixed pixel offset above the Player's top edge.
2. WHILE the Prompt_Label is visible, THE Game_Scene SHALL, each frame, reposition the Prompt_Label to maintain the same fixed pixel offset above the Player as the Player moves.
3. WHEN the Player's physics body overlaps no Interaction_Zone, THE Game_Scene SHALL hide the Prompt_Label.
4. WHILE an Overlay is open, THE Game_Scene SHALL hide the Prompt_Label regardless of Interaction_Zone overlap.
5. THE Game_Scene SHALL render the Prompt_Label at a depth at or above the overhead depth so it draws above every Y_Sort_Group member and is never occluded by decor.

### Requirement 9: Memory open, traverse, and dismiss via dedicated keys

**User Story:** As the Player, I want E to open a memory, Space to page through it (and close it on the last page), and Esc to close it at any time, so that each key has one clear purpose and I never re-open a memory on top of itself.

#### Acceptance Criteria

1. WHILE the Player's physics body overlaps an Interaction_Zone AND no Overlay is open, WHEN the Open_Key (`E`) is pressed, THE Game_Scene SHALL emit a `hotspot-activated` event on the Event_Bus carrying that zone's memory payload consisting of its `id`, its `text` (an array of 0 or more dialogue pages), and its `imageUrl` (a URL string or null). The payload source SHALL be the resolution of the zone's Memory_Index (per Requirement 12), not Tiled object custom properties: when the Memory_Index is less than the Authored_Memory_Count the payload is the corresponding Memories_Manifest entry; when the Memory_Index is greater than or equal to the Authored_Memory_Count the payload is the Future_Memory_Overlay payload (`text` `["A future memory, not yet saved ❤"]`, `imageUrl` null).
2. THE Game_Scene SHALL treat the Open_Key (`E`), and no other key, as the key that opens a memory; THE Game_Scene SHALL NOT emit a `hotspot-activated` event in response to a `Space`, `Enter`, or `Esc` press.
3. WHILE the Open_Key (`E`) remains held down after a press, THE Game_Scene SHALL emit no further `hotspot-activated` events until the Open_Key has been released for at least one update frame, so that at most one `hotspot-activated` event is emitted per discrete Open_Key press cycle.
4. IF the Open_Key (`E`) is pressed WHILE the Player's physics body overlaps no Interaction_Zone, THEN THE Game_Scene SHALL NOT emit a `hotspot-activated` event and SHALL leave the Player unfrozen.
5. WHILE an Overlay is open, THE Game_Scene SHALL ignore all Open_Key (`E`) presses and SHALL emit no `hotspot-activated` event, so that no memory is re-opened or stacked on top of an open Overlay.
6. WHEN a `hotspot-activated` event is emitted whose payload contains at least one non-empty `text` page or a non-null, non-empty `imageUrl`, THE Game_Scene SHALL freeze the Player and lock interaction until the Overlay is dismissed.
7. IF a `hotspot-activated` event is emitted whose payload contains no `text` pages AND no non-empty `imageUrl`, THEN THE Game_Scene SHALL NOT freeze the Player and SHALL NOT lock interaction.
8. WHILE an Overlay showing a dialogue page that is not the last page is open, WHEN the Advance_Key (`Space`) is pressed, THE Overlay SHALL advance to the next dialogue page and SHALL NOT dismiss.
9. WHEN the Advance_Key (`Space`) is pressed WHILE the Overlay is showing the last dialogue page, THE Overlay SHALL dismiss and SHALL emit a `dialogue-dismissed` event, and WHERE an image viewer is the open Overlay, THE Overlay SHALL emit an `image-dismissed` event.
10. THE Overlay SHALL treat the Advance_Key (`Space`), and no other key, as the key that advances pages; THE Overlay SHALL NOT advance a dialogue page in response to an `Enter` press.
11. WHILE an Overlay is open, WHEN the Dismiss_Key (`Esc`) is pressed, THE Overlay SHALL dismiss regardless of which dialogue page is currently shown and SHALL emit a `dialogue-dismissed` event or an `image-dismissed` event as appropriate to the open Overlay.
12. WHEN the Game_Scene receives a `dialogue-dismissed` event or an `image-dismissed` event indicating the last open Overlay has closed, THE Game_Scene SHALL unfreeze the Player and unlock interaction within one update frame.
13. THE Game_Scene SHALL own Open_Key (`E`) detection and `hotspot-activated` emission, and THE Overlay SHALL own Advance_Key (`Space`) paging, last-page Advance_Key dismissal, and Dismiss_Key (`Esc`) dismissal.
14. THE Game_Scene SHALL exchange all data with React exclusively through the Event_Bus and SHALL NOT read from or write to React state or components directly.

### Requirement 10: Camera behavior as the world grows

**User Story:** As the Player, I want the camera to follow me smoothly through an ever-extending hallway, so that the view stays crisp and never reveals empty space to the left.

#### Acceptance Criteria

1. THE Game_Scene SHALL set the camera zoom to an integer value of 2.
2. WHEN the Player is spawned, THE Game_Scene SHALL make the camera follow the Player.
3. THE Game_Scene SHALL bound the camera on the left at the left edge of the Start_Map so that 0 pixels of any area left of the Start_Map are ever visible.
4. WHEN a new Hallway_Segment is generated, THE Game_Scene SHALL extend the camera's right bound to include the newly generated world extent, up to and capped at the right edge of the final segment; once the final segment (index Final_Segment_Index) exists, THE Game_Scene SHALL fix the camera's right bound at the final segment's right edge and SHALL NOT extend it further.
5. THE Game_Scene SHALL round the camera scroll position to whole pixels so that no sub-pixel blur is introduced.
6. IF generation of a new Hallway_Segment fails, THEN THE Game_Scene SHALL leave the camera's current right bound unchanged.

### Requirement 11: Graceful asset failure

**User Story:** As the Player, I want a readable message instead of a crash when assets fail to load, so that the gift still degrades gracefully.

#### Acceptance Criteria

1. IF a map asset fails to load, THEN THE Game_Scene SHALL display a readable on-canvas error message instead of building the scene, without throwing an unhandled error.
2. IF a Tileset_Image fails to load, THEN THE Game_Scene SHALL display a readable on-canvas error message that identifies the missing tileset.
3. IF the Player spritesheet fails to load within the sprite-load timeout, THEN THE Game_Scene SHALL display a readable on-canvas error message.
4. WHILE a load error is present, THE Game_Scene SHALL NOT build map layers, SHALL NOT spawn the Player, and SHALL NOT generate Hallway_Segments.

### Requirement 12: Per-zone memory indexing and content

**User Story:** As the Player, I want each frame in the hallway to show a distinct memory and photo as I move through segments, so that the gallery tells an unfolding story rather than repeating the same memory.

#### Acceptance Criteria

1. THE Hallway_Segment SHALL expose exactly 6 Interaction_Zones, corresponding to the 6 rectangle objects in the Hallway_Map's `Object Layer 1`.
2. WHEN a Hallway_Segment is instantiated, THE Game_Scene SHALL assign each of that segment's Interaction_Zones a Zone_Index from 0 to 5 by ranking the segment's zones in ascending order of local x position, assigning 0 to the leftmost zone, and SHALL break ties in equal x position by ascending y position and then by ascending Tiled object id, so that the assignment is deterministic and stable.
3. THE Game_Scene SHALL compute each Interaction_Zone's Memory_Index as (Segment_Index * 6) + Zone_Index.
4. WHERE an Interaction_Zone's Memory_Index is less than the Authored_Memory_Count (N), WHEN that Interaction_Zone is activated, THE Game_Scene SHALL emit a `hotspot-activated` payload whose `text` and `imageUrl` are the Memories_Manifest entry for that zone's Memory_Index.
5. THE Game_Scene SHALL set the emitted payload's `id` to a value that encodes the Memory_Index (a stable identifier of the form `memory-{Memory_Index}`).
6. WHERE an Interaction_Zone's Memory_Index is greater than or equal to the Authored_Memory_Count (N) (a Future_Zone), WHEN that Interaction_Zone is activated, THE Game_Scene SHALL emit the Future_Memory_Overlay payload with `id` `memory-{Memory_Index}`, `text` `["A future memory, not yet saved ❤"]`, and `imageUrl` null, which SHALL open an Overlay and freeze the Player (consistent with Requirement 9.6); the Prompt_Label continues to appear per Requirement 8. Because generation stops at Final_Segment_Index (Requirement 3.3), Future_Zones occur only within the final segment, and there is no in-world Interaction_Zone whose Memory_Index lies beyond the final segment.
7. WHEN the Player re-enters a previously traversed Segment_Index, THE Game_Scene SHALL resolve each Interaction_Zone to the same Memory_Index and the same content (authored Memories_Manifest entry or Future_Memory_Overlay payload) presented when that Segment_Index was first traversed (deterministic, consistent with Requirement 5.6).
8. THE Memories_Manifest SHALL be a static in-app data structure with no backend or network dependency.

### Requirement 13: Bounded hallway and future memories

**User Story:** As the Player, I want the hallway to end after the last saved memory, with any remaining frames in that final room showing a 'future memory' note, so that the museum reads as a finite, growing timeline of our relationship.

#### Acceptance Criteria

1. THE Segment_Manager SHALL NOT generate any Hallway_Segment whose index exceeds the Final_Segment_Index.
2. THE Final_Segment_Index SHALL equal floor((N-1)/6) when the Authored_Memory_Count (N) is greater than or equal to 1, and 0 when N is 0.
3. WHEN the Player reaches the right edge of the final segment's floor, THE Game_Scene SHALL clamp the Player's world X so it does not pass that edge, and a rightward input at that edge SHALL leave the Player's X position unchanged (symmetric to the Start_Map left clamp in Requirement 5.3).
4. THE Game_Scene SHALL fix the camera's right bound at the final segment's right edge and SHALL NOT extend the camera's right bound beyond that edge.
5. WHERE an Interaction_Zone's Memory_Index is greater than or equal to the Authored_Memory_Count (N) (a Future_Zone), WHEN the Open_Key (`E`) is pressed while the Player overlaps that zone and no Overlay is open, THE Game_Scene SHALL emit a `hotspot-activated` payload with `text` `["A future memory, not yet saved ❤"]` and `imageUrl` null, which SHALL open the Overlay and freeze the Player.
6. WHERE an Interaction_Zone's Memory_Index is less than the Authored_Memory_Count (N), THE Game_Scene SHALL resolve that zone's content from the Memories_Manifest (authored memory).
7. THE Game_Scene SHALL display the Prompt_Label (`[E]`) for Future_Zones under the same conditions as for authored zones (per Requirement 8).
8. IF N is 0, THEN THE hallway SHALL consist of exactly one Hallway_Segment (index 0) whose 6 Interaction_Zones are all Future_Zones, and THE Segment_Manager SHALL NOT generate any Hallway_Segment to the right of that segment.

## Correctness Properties (for property-based testing)

These properties are candidates for fast-check property-based tests alongside example-based tests. Each maps to an invariant that should hold across generated inputs (player paths, segment indices, zone positions).

1. **Left-boundary invariant (Req 5.3):** For all sequences of movement inputs, the Player's world X SHALL never be less than the left edge of the Start_Map floor.
2. **Floor continuity invariant (Req 3.1, 3.3, 5.2):** For all pairs of adjacent segments (and the Start_Map–segment-0 seam), the floor tiles SHALL align so there is no gap or overlap at the seam world X.
3. **Segment-count monotonicity (Req 4.2, 4.3):** For all movement paths, the Segment_Count SHALL be non-decreasing, and SHALL increase only when a new maximum segment index is reached.
4. **Segment-count equals max index + 1 (Req 4.6):** For all movement paths, the Segment_Count SHALL equal the highest generated segment index plus one.
5. **Bounded generation (Req 3.3, 4.7, 13.1):** For all movement paths, no generated segment index SHALL exceed the Final_Segment_Index, and the Segment_Count SHALL never exceed Final_Segment_Index + 1.
6. **Right-boundary invariant (Req 13.3):** For all sequences of movement inputs, the Player's world X SHALL never exceed the right edge of the final segment's floor.
7. **Loaded-window bound (Req 3.6):** For all movement paths, the number of concurrently instantiated Hallway_Segments SHALL never exceed the Loaded_Window maximum.
8. **Return-path consistency (Req 5.1, 5.5):** For all right-then-left movement paths, the sequence of segment indices encountered walking left SHALL be the reverse of the sequence encountered walking right, terminating at the Start_Map.
9. **Prompt visibility iff zone overlap and no overlay (Req 8.1, 8.3, 8.4):** For all Player positions and overlay states, the Prompt_Label SHALL be visible if and only if the Player overlaps at least one Interaction_Zone AND no Overlay is open.
10. **Single activation per press (Req 9.3):** For all Open_Key (`E`) hold durations, at most one `hotspot-activated` event SHALL be emitted per discrete Open_Key press.
11. **No activation outside zones (Req 9.4):** For all Player positions not overlapping any Interaction_Zone, no Open_Key (`E`) press SHALL emit a `hotspot-activated` event.
12. **No re-open while overlay open (Req 9.5):** For all Open_Key (`E`) presses that occur while an Overlay is open, no new `hotspot-activated` event SHALL be emitted.
13. **Advance never opens (Req 9.2):** For all Advance_Key (`Space`) presses that occur while no Overlay is open, no `hotspot-activated` event SHALL be emitted.
14. **Collision classification (Req 6.2, 6.3):** For all tiles, the Player SHALL be allowed to occupy Floor_Tiles and SHALL be blocked from the Collision_AABB of Collision_Tiles.
15. **Camera never reveals pre-start space (Req 10.3):** For all camera follow states, the camera's visible left edge SHALL never be less than the left edge of the Start_Map.
16. **Memory-index determinism (Req 12.3, 12.7):** For all segment indices `s` and all Zone_Index values `z` in 0..5, the resolved Memory_Index SHALL equal `s * 6 + z`, and this value SHALL be stable across re-instantiation of the same Segment_Index.
17. **Zone ordering determinism (Req 12.2):** For all Hallway_Segments, assigning Zone_Index by ascending local x (ties broken by ascending y then ascending Tiled object id) SHALL be a bijection onto 0..5, so that each Zone_Index is used exactly once per segment.
18. **Future zone opens future-memory overlay (Req 12.6, 13.5):** For all Memory_Index values greater than or equal to the Authored_Memory_Count (N), the emitted payload `text` SHALL equal `["A future memory, not yet saved ❤"]` and `imageUrl` SHALL be null — a non-empty payload that opens an Overlay and freezes the Player.
