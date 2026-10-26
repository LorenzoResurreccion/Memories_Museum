# Requirements Document

## Introduction

The Wall Paintings feature places a pixel-art image inside each empty framed canvas on the gallery wall, so every memory is represented both by its floor Interaction_Zone (which opens the memory overlay) and by a visible painting hanging in its frame. Today the Hallway_Map's frames are empty gold borders; this feature fills them with per-memory pixel images that load with the map and sit within the frame bounds on the wall.

To make this possible without breaking the existing Infinite Hallway logic, the map's `Object Layer 1` gains an explicit object taxonomy. Each existing interaction point is tagged with the Tiled type `memory_zone`, and 6 new sized objects are added with the Tiled type `painting`, one placed over each frame's inner area. The Game_Scene currently treats *every* object in `Object Layer 1` as a memory Interaction_Zone; this feature changes the scene to read objects by type, so that only `memory_zone` objects drive zone indexing and activation, and `painting` objects drive on-wall image rendering. Each painting resolves its image from the same per-segment, per-frame Memory_Index that the co-located memory zone resolves, so a painting and its memory always stay in sync.

Painting images are a new, decoupled asset set (one pixel image per Memory_Index). Consistent with the project's "keep the runtime light" and "no backend" priorities, the painting image source is referenced by key/URL and starts as placeholders; the real pixel images are dropped in later by changing only the reference locations. Painting images are static in-app content with no network or backend dependency beyond optionally-external image URLs.

The Start_Map has no frames, so this feature affects the Hallway_Map only. The game remains a static, self-contained site, and the Phaser↔React boundary continues to communicate only through the `EventBus` singleton (paintings are purely visual and emit no events).

This feature builds on the Infinite Hallway spec. All Infinite Hallway behavior (segment generation, zone indexing, memory resolution, bounded growth, leftward return) remains unchanged except where a requirement here explicitly refines how `Object Layer 1` objects are classified and rendered.

## Glossary

- **Game**: The complete Memories Museum runtime (Phaser scene plus React UI).
- **Game_Scene**: The Phaser scene (`GameScene.js`) that loads maps, spawns the player, builds layers, drives movement, Y-sorting, camera, collision, and segment generation.
- **Hallway_Map**: The `museum_hallway` map, a 58×15, 16px-tile reusable section whose `Object Layer 1` holds the segment's interaction and painting objects.
- **Hallway_Segment**: One instantiated copy of the Hallway_Map placed at a specific world offset.
- **Segment_Index**: The 0-based index of a Hallway_Segment to the right of the Start_Map (segment adjacent to the Start_Map is index 0).
- **Object_Layer**: The Hallway_Map's `Object Layer 1`, which holds both Memory_Zone_Objects and Painting_Objects.
- **Map_Object**: Any object authored in the Object_Layer. Each carries a Tiled `type` (also called the object class), a position (`x`, `y`), a size (`width`, `height`, which may be 0 for a point object), and a Tiled object `id`.
- **Object_Type**: The Tiled `type`/class string on a Map_Object. The two recognized values are `memory_zone` and `painting`.
- **Memory_Zone_Object**: A Map_Object whose Object_Type is `memory_zone`. It marks the floor interaction point in front of one frame. There are exactly 6 per Hallway_Map.
- **Painting_Object**: A Map_Object whose Object_Type is `painting`. It marks the rectangular wall area inside one frame where a pixel image is placed. There are exactly 6 per Hallway_Map.
- **Interaction_Zone**: The runtime floor overlap region built from a Memory_Zone_Object; it is the memory activation region and drives the Prompt_Label. (Behavior per the Infinite Hallway spec, Requirements 8, 9, 12.)
- **Zone_Index**: An integer 0..5, the left-to-right rank (by local x, ties broken by y then Tiled id) of a Memory_Zone_Object within its Hallway_Segment. Computed over Memory_Zone_Objects only.
- **Memory_Index**: The global 0-based memory number, computed as `Segment_Index * 6 + Zone_Index`.
- **Memories_Manifest**: The static in-app data structure (`src/data/memories.js`, `MEMORIES`) mapping each authored Memory_Index `0..N-1` to `{ text: string[], imageUrl: string | null }`.
- **Authored_Memory_Count (N)**: The number of entries in the Memories_Manifest.
- **Painting_Image**: The pixel-art image rendered inside a Painting_Object's bounds, selected by Memory_Index.
- **Painting_Image_Source**: The resolver that maps a Memory_Index to a Painting_Image key/URL (analogous to the Memories_Manifest, but for on-wall pixel art). It is static in-app content with placeholder entries that are later replaced by real references.
- **Painting_Placeholder**: The default visual shown in a Painting_Object's bounds when no Painting_Image is available for that Memory_Index (e.g. a missing/unloaded image, or a Future_Painting).
- **Future_Painting**: A Painting_Object whose Memory_Index is greater than or equal to N (co-located with a Future_Zone). It shows the Painting_Placeholder, not an authored image.
- **Painting_Sprite**: The runtime sprite/image object created to render a Painting_Image (or Painting_Placeholder) inside a Painting_Object's bounds.
- **Wall_Depth**: A fixed render depth for Painting_Sprites that is at or above the floor/back-wall depth and strictly below every Y_Sort_Group member, so paintings read as flat against the back wall and the Player and decor always pass in front of them.
- **Y_Sort_Group**: The feet-origin depth-sort group (Player + Layer2_Sprites) re-depthed to world Y each frame.
- **Player**: The controllable 16×32 character sprite.
- **Event_Bus**: The pub/sub singleton (`EventBus.js`) that is the sole channel between Game_Scene and React.

## Requirements

### Requirement 1: Object classification by type

**User Story:** As the developer, I want the Game_Scene to distinguish interaction objects from painting objects by their Tiled type, so that adding painting objects to the map does not corrupt memory zone indexing.

#### Acceptance Criteria

1. WHEN the Game_Scene reads a Hallway_Segment's Object_Layer, THE Game_Scene SHALL classify each Map_Object by its Object_Type.
2. THE Game_Scene SHALL treat only Map_Objects whose Object_Type is `memory_zone` as Memory_Zone_Objects for the purpose of building Interaction_Zones, assigning Zone_Index, and resolving Memory_Index.
3. THE Game_Scene SHALL treat only Map_Objects whose Object_Type is `painting` as Painting_Objects for the purpose of rendering Painting_Sprites.
4. THE Game_Scene SHALL NOT build an Interaction_Zone from a Painting_Object, and SHALL NOT render a Painting_Sprite from a Memory_Zone_Object.
5. WHERE a Map_Object has an Object_Type that is neither `memory_zone` nor `painting` (including an empty or missing type), THE Game_Scene SHALL ignore that object: it SHALL neither build an Interaction_Zone nor render a Painting_Sprite from it, and SHALL continue building the remaining segment without error.
6. THE Game_Scene SHALL compute Zone_Index and Memory_Index over the Memory_Zone_Objects only, so that the presence or count of Painting_Objects does not change any Memory_Zone_Object's Zone_Index or Memory_Index.

### Requirement 2: Backward-compatible zone indexing

**User Story:** As the Player, I want every memory to open exactly the same content as before this feature, so that filling the frames with images does not shuffle which memory belongs to which frame.

#### Acceptance Criteria

1. GIVEN a Hallway_Map whose Object_Layer contains exactly 6 Memory_Zone_Objects, WHEN a Hallway_Segment at Segment_Index `s` is instantiated, THE Game_Scene SHALL assign Zone_Index 0..5 to those 6 Memory_Zone_Objects by ascending local x (ties broken by ascending y then ascending Tiled id), identical to the ordering used before this feature.
2. THE Game_Scene SHALL compute each Memory_Zone_Object's Memory_Index as `Segment_Index * 6 + Zone_Index`, identical to the pre-feature computation.
3. WHEN a Memory_Zone_Object is activated, THE Game_Scene SHALL emit the identical `hotspot-activated` payload (same `id`, `text`, `imageUrl` resolution against the Memories_Manifest or the future-memory overlay) that it would have emitted before this feature for the same Memory_Index.
4. THE addition of Painting_Objects to the Object_Layer SHALL NOT change the number of Interaction_Zones per segment, which SHALL remain exactly 6.

### Requirement 3: Painting-to-memory correspondence

**User Story:** As the Player, I want the picture hanging in each frame to match the memory I open at that frame, so that the painting and its memory are the same memory.

#### Acceptance Criteria

1. THE Game_Scene SHALL associate each Painting_Object with exactly one Memory_Index.
2. THE Game_Scene SHALL assign a Painting_Object the same Memory_Index as the Memory_Zone_Object that belongs to the same frame, determined by ranking Painting_Objects left-to-right (ascending local x, ties broken by ascending y then ascending Tiled id) to a Painting_Index 0..5 and computing its Memory_Index as `Segment_Index * 6 + Painting_Index`.
3. THE Game_Scene SHALL select a Painting_Object's Painting_Image by resolving its Memory_Index through the Painting_Image_Source.
4. WHEN the Player re-enters a previously traversed Segment_Index, THE Game_Scene SHALL render each Painting_Object with the identical Painting_Image (or Painting_Placeholder) presented when that Segment_Index was first traversed.
5. WHERE a Painting_Object's Memory_Index is greater than or equal to N (a Future_Painting), THE Game_Scene SHALL render the Painting_Placeholder for that Painting_Object.

### Requirement 4: Painting rendering within frame bounds

**User Story:** As the Player, I want each painting to sit neatly inside its gold frame on the wall, so that the gallery looks like it is displaying pictures rather than overlapping or floating art.

#### Acceptance Criteria

1. WHEN a Hallway_Segment is instantiated, THE Game_Scene SHALL create one Painting_Sprite for each Painting_Object in that segment.
2. THE Game_Scene SHALL position and size each Painting_Sprite so that it fully covers the Painting_Object's authored rectangular bounds (`x`, `y`, `width`, `height`), offset by the segment's world offset, leaving no uncovered (gap/letterbox) region inside those bounds, and SHALL NOT draw any visible Painting_Image pixels outside those bounds.
3. WHERE a Painting_Image's native pixel dimensions equal the Painting_Object's bounds, THE Game_Scene SHALL place the image 1:1 (no scaling) so authored pixel art is pixel-perfect.
4. WHERE a Painting_Image's native pixel dimensions differ from the Painting_Object's bounds, THE Game_Scene SHALL make the image fill the entire bounds using one of the following fill strategies, prioritizing full coverage of the bounds over avoiding distortion or cropping: (a) scale the image to the bounds (stretch to the exact width and height), or (b) scale the image uniformly to cover the bounds and crop the overflow. THE Game_Scene SHALL NOT leave empty space within the bounds in order to preserve aspect ratio.
5. THE Game_Scene SHALL render every Painting_Sprite at the Wall_Depth, strictly below every Y_Sort_Group member, so that the Player and all Layer2_Sprites render in front of the paintings.
6. THE Game_Scene SHALL NOT give a Painting_Sprite a physics body and SHALL NOT make a Painting_Sprite collidable; paintings SHALL not block Player movement.
7. WHEN a Hallway_Segment is recycled, THE Game_Scene SHALL destroy that segment's Painting_Sprites and release their resources, consistent with how Layer2_Sprites and Interaction_Zones are released.

### Requirement 5: Placeholder and graceful image failure

**User Story:** As the developer, I want paintings to show placeholders until real pixel art exists and to degrade gracefully if an image is missing, so that I can author the images later by changing only reference locations without breaking the game.

#### Acceptance Criteria

1. THE Painting_Image_Source SHALL provide a placeholder reference for every Memory_Index so the Game builds and renders before any real pixel art is authored.
2. WHERE the Painting_Image for a Painting_Object's Memory_Index is unavailable (no entry, an unresolved key, or a failed image load), THE Game_Scene SHALL render the Painting_Placeholder in that Painting_Object's bounds instead of crashing or leaving an error state.
3. WHEN real pixel images are later added, THE change required to display them SHALL be limited to updating the Painting_Image_Source reference locations (keys/URLs) and adding the image assets, with no change required to zone indexing, memory resolution, or segment generation logic.
4. IF a Painting_Image asset fails to load, THEN THE Game_Scene SHALL continue building and running the segment (showing the Painting_Placeholder for that painting) and SHALL NOT display a scene-level load error or halt segment generation.
5. THE Painting_Image_Source SHALL be a static in-app data structure with no backend dependency; image references MAY be local asset keys or external URLs (heavy media kept out of the bundle).

### Requirement 6: Map authoring compatibility

**User Story:** As the author, I want to add the `type` property to the existing objects and add the new painting objects in Tiled and re-export the map JSON, so that the authored map drives the feature without code changes per edit.

#### Acceptance Criteria

1. THE Game_Scene SHALL read the Object_Type from the Tiled object's `type` (object class) field as exported in the map JSON.
2. GIVEN the existing 6 interaction objects are each tagged with Object_Type `memory_zone`, THE Game_Scene SHALL build the same 6 Interaction_Zones from them as before the tagging.
3. GIVEN 6 new objects are added with Object_Type `painting`, each sized to a frame's inner wall area, THE Game_Scene SHALL render a Painting_Sprite within each such object's bounds.
4. WHILE the Object_Layer contains the 6 `memory_zone` objects and the 6 `painting` objects, THE Game_Scene SHALL build exactly 6 Interaction_Zones and exactly 6 Painting_Sprites per segment.
5. IF the re-exported map JSON omits the `type` on an object that previously drove an Interaction_Zone, THEN THE Game_Scene SHALL, per Requirement 1.5, ignore that untyped object (it builds no Interaction_Zone), so that mis-authoring surfaces as a missing memory rather than a crash.

### Requirement 7: No effect on the Phaser–React boundary

**User Story:** As the developer, I want paintings to be purely visual, so that they do not introduce new cross-boundary events or overlay behavior.

#### Acceptance Criteria

1. THE Game_Scene SHALL render Painting_Sprites without emitting any Event_Bus event.
2. WHEN the Player overlaps or passes a Painting_Object, THE Game_Scene SHALL NOT open an Overlay, SHALL NOT freeze the Player, and SHALL NOT change the Prompt_Label visibility rule (which remains governed by Interaction_Zone overlap per the Infinite Hallway spec).
3. THE Wall Paintings feature SHALL add no new React component and SHALL require no change to the existing Overlay, DialogueBox, or ImageViewer behavior.

## Correctness Properties (for property-based testing)

These properties are candidates for fast-check property-based tests alongside example-based tests.

1. **Type-partitioned reads (Req 1.2, 1.3, 1.4):** For all Object_Layers containing a mix of `memory_zone`, `painting`, and other/untyped objects, the set of objects producing Interaction_Zones SHALL equal exactly the `memory_zone` objects, and the set producing Painting_Sprites SHALL equal exactly the `painting` objects.
2. **Zone-index invariance under paintings (Req 1.6, 2.1, 2.2):** For all Object_Layers, adding, removing, or repositioning any number of `painting` objects SHALL leave every `memory_zone` object's Zone_Index and Memory_Index unchanged.
3. **Zone-count invariance (Req 2.4):** For all Object_Layers that contain exactly 6 `memory_zone` objects, the number of Interaction_Zones per segment SHALL equal 6 regardless of the number of `painting` objects.
4. **Painting–memory index agreement (Req 3.1, 3.2):** For all segments, ranking `painting` objects and `memory_zone` objects by the same ordering rule SHALL yield, for each rank `z`, a Painting_Object and a Memory_Zone_Object with the identical Memory_Index `s*6 + z`.
5. **Painting determinism on return (Req 3.4):** For all right-then-left movement paths, the Painting_Image (or Painting_Placeholder) resolved for a given Segment_Index SHALL be identical across re-instantiations of that Segment_Index.
6. **Future painting shows placeholder (Req 3.5):** For all Memory_Index values greater than or equal to N, the resolved painting visual SHALL be the Painting_Placeholder.
7. **Full bounds coverage (Req 4.2, 4.4):** For all Painting_Objects with positive width and height, the Painting_Sprite SHALL fully cover the object's world-offset bounds (no uncovered region) with no visible image pixels drawn outside those bounds.
8. **Wall depth ordering (Req 4.4):** For all Painting_Sprites and all Y_Sort_Group members, the Painting_Sprite's depth SHALL be strictly less than every Y_Sort_Group member's depth.
9. **Paintings are non-collidable (Req 4.5):** For all Painting_Sprites, no Player movement path SHALL be blocked by a Painting_Sprite.
10. **Graceful image fallback (Req 5.2, 5.4):** For all Painting_Objects whose image reference is unavailable or fails to load, the segment SHALL still build with the Painting_Placeholder rendered and no scene-level error raised.
11. **No events from paintings (Req 7.1, 7.2):** For all Player paths that overlap or pass Painting_Objects (without overlapping a Memory_Zone_Object), no `hotspot-activated` event SHALL be emitted and the Player SHALL not freeze.
