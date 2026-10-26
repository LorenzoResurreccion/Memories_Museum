import { Scene } from 'phaser';
import PlayerController from './PlayerController.js';
import CollisionBuilder from './CollisionBuilder.js';
import SegmentManager from './SegmentManager.js';
import InteractionManager from './InteractionManager.js';
import PromptLabel from './PromptLabel.js';
import { assignZoneIndices, resolveZonePayload } from './memoryResolve.js';
import {
  assignPaintingIndices,
  resolvePaintingImage,
  partitionObjectsByType
} from './paintingResolve.js';
import { MEMORIES } from '../data/memories.js';
import { PAINTINGS, PAINTING_PLACEHOLDER_KEY } from '../data/paintings.js';
import eventBus from './EventBus.js';

/** Width of a hallway segment in px: 58 tiles * 16px = 928. */
const SEGMENT_WIDTH_PX = 58 * 16;

/**
 * Interaction-zone footprint in px. Each framed canvas is 3 tiles wide (48px) and the
 * Tiled object point marks the frame's LEFT edge (object x === frame left-edge column
 * × 16). A 1-tile zone only triggered near the frame's left side; the zone is sized to
 * the full 3-tile frame width so the player can interact anywhere along the frame. The
 * height spans a few rows (zone top at the object y, extending down toward the floor)
 * so the player's feet overlap it while standing in front of the canvas.
 */
const ZONE_WIDTH_PX = 3 * 16;
const ZONE_HEIGHT_PX = 3 * 16;

/**
 * The set of texture keys that belong to wall paintings (the placeholder plus every
 * key referenced by the PAINTINGS source). A `loaderror` on any of these is handled
 * locally (non-fatal) rather than flipping the scene-level `_loadError` (Req 5.4).
 * @type {Set<string>}
 */
const PAINTING_TEXTURE_KEYS = new Set([
  PAINTING_PLACEHOLDER_KEY,
  ...Object.values(PAINTINGS)
    .map((entry) => entry && entry.key)
    .filter((key) => typeof key === 'string' && key.length > 0)
]);

/**
 * Decode a Tiled GID into its frame index and orientation flags.
 *
 * Tiled encodes tile flip/rotation as the top 3 bits OR'd onto the GID:
 * `FLIPPED_HORIZONTALLY = 0x80000000`, `FLIPPED_VERTICALLY = 0x40000000`,
 * `FLIPPED_DIAGONALLY = 0x20000000`. The low 29 bits (`gid & 0x1FFFFFFF`) are
 * the real tile index. This helper separates both concerns so callers can draw
 * the correct frame and apply the orientation (`setFlipX` / `setFlipY`).
 *
 * Totality: this never throws for any integer input (0, negative, very large).
 * A masked `frame <= 0` is returned as-is; callers treat `<= 0` as empty.
 *
 * Note: JS bitwise `&` operates on 32-bit signed integers, so `gid & 0x80000000`
 * yields a negative number for high-bit-set GIDs — comparing `!== 0` is still
 * correct because a set bit is simply non-zero. The frame mask `0x1FFFFFFF`
 * clears the sign bit, so the frame is always in the non-negative range.
 *
 * @param {number} gid - Raw Tiled GID (may carry flip flags in the top 3 bits).
 * @returns {{ frame: number, flipH: boolean, flipV: boolean, flipD: boolean }}
 */
export function gidDecode(gid) {
  return {
    frame: gid & 0x1fffffff,
    flipH: (gid & 0x80000000) !== 0,
    flipV: (gid & 0x40000000) !== 0,
    flipD: (gid & 0x20000000) !== 0
  };
}

/**
 * GameScene — main game scene handling tile map loading, player spawning, and movement.
 *
 * Responsibilities:
 * - Load tilemap JSON, tileset images, and player spritesheet in preload()
 * - Build map layers in correct z-order in create()
 * - Derive collision from per-tile shapes via CollisionBuilder static bodies (no
 *   collision tile layer)
 * - Spawn player at player_spawn, else a left-of-everything in-bounds floor fallback
 * - Instantiate the bounded-hallway subsystems (CollisionBuilder, SegmentManager,
 *   InteractionManager, PromptLabel) and set the player's two-sided clamp bounds
 * - Set up input (cursors + WASD) and PlayerController
 * - Handle missing assets gracefully with error messages
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 5.3, 6.5, 6.6, 13.3
 */
export default class GameScene extends Scene {
  constructor() {
    super({ key: 'GameScene' });

    /** @type {Phaser.Tilemaps.Tilemap|null} */
    this.map = null;

    /**
     * Retained null for backward compatibility with older tests/consumers.
     * Collision is now derived from `CollisionBuilder` static bodies (Req 6.6);
     * there is no dedicated collision tile layer.
     * @type {Phaser.Tilemaps.TilemapLayer|null}
     */
    this.collisionLayer = null;

    /** @type {Phaser.Tilemaps.TilemapLayer|null} */
    this.groundLayer = null;

    /** @type {Phaser.Tilemaps.TilemapLayer|null} */
    this.wallsLayer = null;

    /** @type {Phaser.Tilemaps.TilemapLayer|null} */
    this.propsLayer = null;

    /** @type {Phaser.Tilemaps.TilemapLayer|null} */
    this.foregroundLayer = null;

    /** @type {Phaser.Physics.Arcade.Sprite|null} */
    this.player = null;

    /** @type {PlayerController|null} */
    this.playerController = null;

    /** @type {CollisionBuilder|null} */
    this.collisionBuilder = null;

    /**
     * Static arcade group that owns every collision body built by
     * CollisionBuilder. The player collides with this group as a whole.
     * @type {Phaser.Physics.Arcade.StaticGroup|null}
     */
    this.collisionGroup = null;

    /** @type {SegmentManager|null} */
    this.segmentManager = null;

    /** @type {InteractionManager|null} */
    this.interactionManager = null;

    /** @type {PromptLabel|null} */
    this.promptLabel = null;

    /**
     * The hallway map's data, instantiated once and reused as the tile-data
     * source for every generated segment (offset by the segment's worldOffsetX).
     * @type {Phaser.Tilemaps.Tilemap|null}
     */
    this.hallwayMap = null;

    /**
     * True while an overlay (dialogue / image) is open. Gates the prompt and
     * interaction lock. 16.2/17 refine the per-frame gating; set here so the
     * activate/dismiss subscriptions stay coherent.
     * @type {boolean}
     */
    this.overlayOpen = false;

    /**
     * Depth-sort group holding every object that must dynamically overlap the
     * player based on world Y (the player plus building/prop pieces).
     * Sorted each frame in update() via depthSort().
     * @type {Phaser.GameObjects.Group|null}
     */
    this.sortGroup = null;

    /**
     * Fixed depth for the overhead layer (roofs, awnings, tree canopies).
     * Kept well above any Y-sorted depth so it always draws on top.
     * @type {number}
     */
    this.OVERHEAD_DEPTH = 10000;

    /**
     * Fixed depth for `Tile Layer 1` floor + back-wall tiles. Kept strictly
     * below any Y-sorted member (whose depth equals its positive world Y) so
     * floor and back wall always draw beneath the player and decor (Req 7.7).
     * @type {number}
     */
    this.FLOOR_DEPTH = 0;

    /**
     * Fixed depth for wall paintings (flat art hung inside the framed canvases).
     * Must stay `> FLOOR_DEPTH` (0) so paintings draw above the back wall, and
     * STRICTLY `<` the minimum actor feet world Y so every `Y_Sort_Group` member
     * (player + decor, whose depth equals its positive feet world Y) always draws
     * in front of the paintings. Actors stand on the floor band dozens of px down,
     * so a small single-digit constant is safely below every sort-group member
     * (Req 4.4).
     * @type {number}
     */
    this.WALL_DEPTH = 1;

    /** @type {Phaser.Types.Input.Keyboard.CursorKeys|null} */
    this.cursors = null;

    /** @type {object|null} */
    this.wasd = null;

    /** @type {boolean} */
    this._loadError = false;

    /** @type {string|null} */
    this._errorMessage = null;

    /** @type {boolean} */
    this._playerSpriteError = false;

    /**
     * Texture keys of painting images that failed to load. Painting load errors are
     * NON-fatal: a key is recorded here so `_createPaintingSprite` falls back to the
     * placeholder, and the scene-level `_loadError` is never set (Req 5.4). Always
     * includes every painting key (the placeholder plus any authored keys); currently
     * only the placeholder key is loaded.
     * @type {Set<string>}
     */
    this._paintingLoadErrors = new Set();

    /**
     * World X where segment index 0 begins (the start-map floor right edge). Stored
     * from create() so update()'s camera right-bound helper is deterministic.
     * @type {number}
     */
    this._startRightEdgeX = 0;

    /**
     * The hard right bound: world X of the final segment's floor right edge. The camera
     * right bound is capped and fixed here (Req 10.4, 13.4).
     * @type {number}
     */
    this._maxX = 0;

    /**
     * World X of the start-map floor LEFT edge — the camera left bound (Req 10.3).
     * @type {number}
     */
    this._minX = 0;

    /**
     * Highest segment count observed so far, used to detect when a strictly new segment
     * has generated this frame so the camera right bound only extends on real growth.
     * @type {number}
     */
    this._lastSegmentCount = 0;
  }

  preload() {
    // Track load errors. A failed tileset image names the missing tileset by key so the
    // on-canvas error is actionable (Req 1.7, 11.2). Player-sprite failures are handled
    // separately via the 10s timeout below rather than the global _loadError flag.
    this.load.on('loaderror', (fileObj) => {
      if (fileObj.key === 'player') {
        // Don't set global _loadError for player sprite — handled separately with timeout
        this._playerSpriteError = true;
      } else if (this._isPaintingTextureKey(fileObj.key)) {
        // Painting textures fail LOCALLY (Req 5.4): flip only a per-key "missing"
        // marker so `_createPaintingSprite` falls back to the placeholder. Never set
        // the scene-level `_loadError` or halt the scene for a painting load failure.
        this._paintingLoadErrors.add(fileObj.key);
      } else {
        this._loadError = true;

        if (fileObj.type === 'tilemapJSON') {
          this._errorMessage = 'Error: Map could not be loaded';
        } else if (fileObj.type === 'image') {
          // The image key equals the tileset name, so this names the missing tileset.
          const filename = fileObj.key || fileObj.url || 'unknown';
          this._errorMessage = `Error: Missing tileset: ${filename}`;
        } else {
          this._errorMessage = `Error: Failed to load asset: ${fileObj.key || 'unknown'}`;
        }
      }
    });

    // Load the real finite Tiled maps (Req 1.3). The start map is the fixed left end;
    // the hallway map is the segment template stitched to its right by SegmentManager.
    this.load.tilemapTiledJSON('museum_start', 'assets/maps/museum_start.json');
    this.load.tilemapTiledJSON('museum_hallway', 'assets/maps/museum_hallway.json');

    // Load both tilesets with KEYS EQUAL TO THE TILESET NAMES in the map JSON
    // (Req 1.4): `museum_tileset` (firstgid 1) and `museum_decor` (firstgid 41). Keeping
    // the image key identical to the Tiled tileset name is what lets addTilesetImage wire
    // them up by name in create().
    //
    // These are loaded as SPRITESHEETS (not plain images) with 16×16 frames. The
    // Y-sortable decor path draws each tile as an individual sprite addressed by a
    // 0-based frame index (`this.add.image(x, y, key, frame)`); a plain-image texture
    // has only frame 0, which is what produced the "texture ... has no frame N" warnings
    // and the garbled decor. A spritesheet texture exposes every 16×16 cell as a frame,
    // and `createLayer` still slices it correctly for the floor layer.
    this.load.spritesheet('museum_tileset', 'assets/tilesets/museum_tileset.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    this.load.spritesheet('museum_decor', 'assets/tilesets/museum_decor.png', {
      frameWidth: 16,
      frameHeight: 16
    });

    // Load player spritesheet (16×32 frames)
    this.load.spritesheet('player', 'assets/sprites/Renzo_Sprite.png', {
      frameWidth: 16,
      frameHeight: 32
    });

    // Load the placeholder painting texture under PAINTING_PLACEHOLDER_KEY, reusing the
    // tiny bundled placeholder asset (Req 5.1). This is the fallback for Future_Paintings,
    // missing PAINTINGS entries, and failed painting loads. A `loaderror` on any painting
    // texture is handled LOCALLY by the listener above (a per-key "missing" marker) and
    // MUST NOT set the scene-level `_loadError` or halt the scene (Req 5.4).
    //
    // Future: for each authored PAINTINGS entry with a url/local asset, load its texture
    // under the entry's `key` here — no other code change is needed (Req 5.3).
    this.load.image(PAINTING_PLACEHOLDER_KEY, 'assets/photos/placeholder.png');

    // Start a 10-second timeout for player sprite loading.
    // Textures are not cached until preload completes, so we use load.on('complete')
    // to confirm if the sprite loaded. If the timeout fires and the texture is still
    // missing, we show an error.
    this._spriteLoadTimer = this.time.delayedCall(10000, () => {
      if (!this.textures.exists('player')) {
        this._playerSpriteError = true;
        this._loadError = true;
        this._errorMessage = 'Error: Sprite could not be loaded';
        // If we're still in preload (shouldn't happen after 10s), the error
        // will be caught in create(). If create() already ran without the sprite,
        // display error now.
        if (this.player === null && this.map !== null) {
          this._displayError(this._errorMessage);
        }
      }
    });
  }

  create() {
    // If a load error occurred, display error text and bail out
    if (this._loadError) {
      this._displayError(this._errorMessage || 'Error: Failed to load game assets');
      return;
    }

    // Check if the player sprite loaded (it should be available after preload completes)
    if (!this.textures.exists('player')) {
      this._displayError('Error: Sprite could not be loaded');
      return;
    }

    // Build the start-map tilemap (Req 1.3). The hallway map is loaded too and is
    // instantiated below as the per-segment tile-data source for SegmentManager.
    this.map = this.make.tilemap({ key: 'museum_start' });

    // Associate both embedded tilesets by NAME (matching the image keys loaded in
    // preload): `museum_tileset` (firstgid 1) and `museum_decor` (firstgid 41). If
    // either fails to associate — e.g. a name mismatch or a missing image — display a
    // readable, NAMED missing-tileset error and build nothing (Req 1.4, 1.5, 1.7, 11.4).
    const tilesetMain = this.map.addTilesetImage('museum_tileset', 'museum_tileset');
    if (!tilesetMain) {
      this._displayError('Error: Missing tileset: museum_tileset');
      return;
    }

    const tilesetDecor = this.map.addTilesetImage('museum_decor', 'museum_decor');
    if (!tilesetDecor) {
      this._displayError('Error: Missing tileset: museum_decor');
      return;
    }

    /** @type {Phaser.Tilemaps.Tileset} Primary tileset (firstgid 1). */
    this.tilesetMain = tilesetMain;
    /** @type {Phaser.Tilemaps.Tileset} Decor tileset (firstgid 41). */
    this.tilesetDecor = tilesetDecor;

    // Raw Tiled JSON tilesets (shape: { firstgid, tiles: [{ id, objectgroup }] }) used
    // for collision. CollisionBuilder reads per-tile collision shapes from the `tiles`
    // array, which the parsed Phaser Tileset does not expose (it uses `tileData`). The
    // hallway map embeds the same tilesets, so the start-map copies apply to segments
    // too; fall back across both map keys so a copy is always found.
    /** @type {{firstgid:number, tiles:Array}|null} */
    this.rawTilesetMain =
      this._getRawTileset('museum_start', 'museum_tileset') ||
      this._getRawTileset('museum_hallway', 'museum_tileset');
    /** @type {{firstgid:number, tiles:Array}|null} */
    this.rawTilesetDecor =
      this._getRawTileset('museum_start', 'museum_decor') ||
      this._getRawTileset('museum_hallway', 'museum_decor');

    // Retained for the start-map floor / sortable-layer build helpers below.
    const tileset = tilesetMain;

    // Depth-sort group: holds every object that must overlap the player by Y.
    // The player and all building/prop pieces are added to this group and
    // re-sorted each frame in update() via depthSort().
    this.sortGroup = this.add.group();

    // Create tile layers in the z-order defined by the JSON (first = bottom).
    // The Tiled maps use the editor's default layer names: `Tile Layer 1` is the
    // floor + structure (fixed low depth, collision source) and `Tile Layer 2`
    // is the decor that Y-sorts against the player.
    //
    // Floor / back-wall layer — always below the player and all decor. Built at
    // a fixed low depth; never enters the sort group (Req 7.7). Drawn from the
    // main tileset (firstgid 1).
    this.groundLayer = this._buildFloorLayer('Tile Layer 1', tileset);

    // Decor tiles are converted into individually sortable sprites so the player
    // can walk in front of or behind each one based on world Y. The source layer
    // is created but hidden (it stays the tile-data source) so the map stays
    // authorable in Tiled. Decor draws from the decor tileset (firstgid 41).
    this.propsLayer = this._buildSortableLayer('Tile Layer 2', tilesetDecor);
    this.wallsLayer = null;

    // --- Collision via CollisionBuilder static bodies (Req 6.6) ---
    // There is no dedicated collision tile layer anymore; collision is derived
    // purely from the embedded per-tile collision shapes. Create the static group
    // that owns the generated bodies and the builder that populates it.
    this.collisionGroup =
      this.physics && this.physics.add && typeof this.physics.add.staticGroup === 'function'
        ? this.physics.add.staticGroup()
        : null;
    this.collisionBuilder = new CollisionBuilder(this, this.collisionGroup);

    // Overhead layer (roofs, awnings, tree canopies) — always drawn above the
    // player and everything in the sort group. A fixed high depth keeps it on
    // top cheaply without participating in per-frame Y-sorting. Optional: the
    // current maps have no dedicated overhead layer, so only build it when the
    // map actually declares one (avoids Phaser's invalid-layer warning).
    this.foregroundLayer =
      typeof this.map.getLayer === 'function' && this.map.getLayer('foreground')
        ? this.map.createLayer('foreground', tileset)
        : null;

    if (this.foregroundLayer) {
      this.foregroundLayer.setDepth(this.OVERHEAD_DEPTH);
    }

    // --- Player spawning ---

    // Find spawn point from the objects layer
    const spawnPoint = this._findPlayerSpawn();

    // Create the player as a physics sprite at the spawn point
    this.player = this.physics.add.sprite(spawnPoint.x, spawnPoint.y, 'player', 0);

    // Origin at the feet (bottom-center). For a tall 16x32 sprite this makes the
    // sort key (world Y) track where the character stands, so overlap with props
    // and building bases reads correctly. The physics body is realigned below.
    this.player.setOrigin(0.5, 1);

    // Player joins the depth-sort group so it interleaves with buildings/props.
    this.sortGroup.add(this.player);

    // Set the player to display idle frame facing down (frame 0 = row 0, col 0)
    this.player.setFrame(0);

    // Realign the physics body to the character's feet. With a feet origin the
    // sprite's top-left is offset upward, so size the body to the lower portion
    // (roughly the bottom 16px of the 16x32 frame) and offset it down. This keeps
    // collisions grounded where the character actually stands.
    if (typeof this.player.body.setSize === 'function') {
      this.player.body.setSize(16, 16);
    }
    if (typeof this.player.body.setOffset === 'function') {
      this.player.body.setOffset(0, 16);
    }

    // Enable world bounds collision on the player's physics body
    this.player.body.setCollideWorldBounds(true);

    // --- Bounded hallway geometry (Req 2.x, 5.3, 13.3) ---
    // The start-map floor left edge is the left clamp bound; its right edge is the
    // seam where segment index 0 begins. The final segment's floor right edge is the
    // deterministic hard right bound. finalSegmentIndex = floor((N-1)/6) for N >= 1.
    const authoredMemoryCount = Object.keys(MEMORIES).length;
    const startRightEdgeX = Number.isFinite(this.map.widthInPixels)
      ? this.map.widthInPixels
      : SEGMENT_WIDTH_PX;
    const finalSegmentIndex =
      authoredMemoryCount >= 1 ? Math.floor((authoredMemoryCount - 1) / 6) : 0;

    // minX = start-map floor left edge (world X 0). maxX = final segment floor right
    // edge, computed up front since it is deterministic (satisfies Req 13.3).
    const minX = 0;
    const maxX = startRightEdgeX + finalSegmentIndex * SEGMENT_WIDTH_PX + SEGMENT_WIDTH_PX;

    // Persist the hallway geometry so update()'s camera right-bound helper is
    // deterministic (Req 10.3, 10.4, 13.4).
    this._startRightEdgeX = startRightEdgeX;
    this._minX = minX;
    this._maxX = maxX;
    this._cameraHeight = Number.isFinite(this.map.heightInPixels)
      ? this.map.heightInPixels
      : SEGMENT_WIDTH_PX;

    // Pin the physics world left/right bounds consistently with [minX, maxX]. Height
    // stays the start-map height (segments share the same floor row / height).
    this.physics.world.setBounds(
      minX, 0,
      maxX - minX,
      this.map.heightInPixels
    );

    // --- CollisionBuilder: build the start map's collision bodies ---
    // Blocking tiles are derived from the embedded per-tile collision shapes on BOTH
    // tile layers: structural pieces on `Tile Layer 1` (main tileset) and collidable
    // decor (pillars, etc.) on `Tile Layer 2` (decor tileset). Each layer is matched
    // to the tileset whose per-tile `objectgroup` shapes it carries, so decor-layer
    // collisions are no longer ignored. Use the RAW flat JSON layer (number[]) since
    // buildForLayer decodes GIDs from a flat array, not the parsed LayerData (Tile[][]).
    // Each tile layer can mix tiles from BOTH tilesets (e.g. hallway Tile Layer 2
    // holds decor-range GIDs AND main-range bench/stanchion GIDs). Collision is built
    // by running every present tileset against each layer; buildForLayer only creates
    // bodies for GIDs that fall in the passed tileset's range and carry a collision
    // shape, so a tileset harmlessly skips GIDs it does not own.
    this._buildLayerCollision(this._getRawLayer('museum_start', 'Tile Layer 1'), 0);
    this._buildLayerCollision(this._getRawLayer('museum_start', 'Tile Layer 2'), 0);

    // Single collider: player vs. the whole static collision group (Req 6.5).
    if (this.collisionGroup && typeof this.physics.add.collider === 'function') {
      this.physics.add.collider(this.player, this.collisionGroup);
    }

    // --- Camera setup ---

    // Integer zoom multiplier for crisp pixel art (no sub-pixel bleeding). At 2×, a
    // 480px-tall canvas shows exactly 240px of world height — the full map height — so
    // the camera fills the viewport vertically with no out-of-bounds black band.
    this.cameras.main.setZoom(2);

    // Left bound is pinned at the start-map left edge so the camera never reveals
    // pre-start space (Req 10.3, Property 15). The right bound starts at the start-map
    // right edge and GROWS as segments generate in update(), capped and fixed at the
    // final segment's right edge (Req 10.4, 13.4). No segments exist yet at create(),
    // so the initial right bound is the start-map right edge.
    this._applyCameraBounds();

    // Camera follows the player sprite, auto-centering and clamping at map edges
    this.cameras.main.startFollow(this.player);

    // --- Input setup ---

    // Create cursor keys (arrow keys)
    this.cursors = this.input.keyboard.createCursorKeys();

    // Create WASD keys
    this.wasd = {
      up: this.input.keyboard.addKey('W'),
      down: this.input.keyboard.addKey('S'),
      left: this.input.keyboard.addKey('A'),
      right: this.input.keyboard.addKey('D')
    };

    // --- PlayerController ---

    // Instantiate PlayerController (it creates animations internally)
    this.playerController = new PlayerController(this, this.player, 120);

    // Apply the two-sided horizontal clamp. Both bounds are deterministic at create()
    // time, so set them now (Req 5.3, 13.3).
    if (typeof this.playerController.setBounds === 'function') {
      this.playerController.setBounds(minX, maxX);
    }

    // Apply the vertical floor clamp so the player's feet stay on the walkable floor
    // band (the brown floor rows) and never step up onto the back wall. The band is
    // derived from the start-map floor layer; every segment shares the same row layout.
    if (typeof this.playerController.setVerticalBounds === 'function') {
      const band = this._computeFloorBand();
      if (band) {
        this.playerController.setVerticalBounds(band.topY, band.bottomY);
      }
    }

    // --- Interaction + prompt subsystems ---

    // InteractionManager owns the Open_Key (E) edge detection and emits
    // `hotspot-activated` with resolved payloads for zones that SegmentManager
    // registers at build time.
    this.interactionManager = new InteractionManager(this, eventBus);

    // Floating [E] prompt pinned above the player.
    this.promptLabel = new PromptLabel(this);

    // --- SegmentManager ---

    // Instantiate the hallway map once; its layer data is the source for every
    // generated segment (offset by the segment's worldOffsetX).
    if (this.make && typeof this.make.tilemap === 'function') {
      this.hallwayMap = this.make.tilemap({ key: 'museum_hallway' });
    }

    // Inject buildSegment / releaseSegment closures. These delegate zone ordering +
    // memory resolution to assignZoneIndices + resolveZonePayload + the MEMORIES
    // manifest, and build the segment's decor sprites, collision bodies, and zones.
    this.segmentManager = new SegmentManager({
      startRightEdgeX,
      segmentWidthPx: SEGMENT_WIDTH_PX,
      authoredMemoryCount,
      finalSegmentIndex,
      maxLoaded: 3,
      generateAheadPx: SEGMENT_WIDTH_PX,
      buildSegment: (index, worldOffsetX) => this._buildSegment(index, worldOffsetX),
      releaseSegment: (segment) => this._releaseSegment(segment)
    });

    // --- Overlay activate / dismiss subscriptions ---
    // Rewired to the new subsystems: freeze player + lock InteractionManager on
    // activate; unfreeze + unlock on dismiss. 16.2 refines overlayOpen tracking.
    eventBus.on('hotspot-activated', () => {
      this.overlayOpen = true;
      if (this.playerController) this.playerController.freeze();
      if (this.interactionManager) this.interactionManager.setLocked(true);
    });

    eventBus.on('dialogue-dismissed', () => {
      this.overlayOpen = false;
      if (this.playerController) this.playerController.unfreeze();
      if (this.interactionManager) this.interactionManager.setLocked(false);
    });

    eventBus.on('image-dismissed', () => {
      this.overlayOpen = false;
      if (this.playerController) this.playerController.unfreeze();
      if (this.interactionManager) this.interactionManager.setLocked(false);
    });
  }

  /**
   * Build one hallway segment at `worldOffsetX` (injected into SegmentManager).
   *
   * Steps: (a) build the segment's `Tile Layer 2` decor sprites into the Y-sort group
   * offset by `worldOffsetX`; (b) build collision bodies for the segment's
   * `Tile Layer 1` via CollisionBuilder at the same offset; (c) read the hallway's
   * `Object Layer 1` zone objects, order them with `assignZoneIndices`, resolve each
   * via `resolveZonePayload` against the MEMORIES manifest, create a world-offset
   * overlap zone per object, register them with InteractionManager; (d) return a
   * Segment handle so `releaseSegment` can dispose everything.
   *
   * Defensive: every Phaser call is guarded so unit tests with partial mocks never
   * throw. Returns a handle (never falsy) unless the hallway map is unavailable.
   *
   * @param {number} index - the segment index.
   * @param {number} worldOffsetX - world X of the segment's left edge.
   * @returns {{ index: number, worldOffsetX: number, layer2Sprites: object[], collisionBodies: object[], zones: object[] }|null}
   */
  /**
   * Read a tile layer's RAW Tiled JSON (flat GID array) from the tilemap cache.
   *
   * The loader caches each Tiled map as `{ format, data }` where `data` is the
   * original JSON. Its `layers[]` entries carry a flat `data: number[]` (plus
   * `width`/`height`), which is the shape the per-tile GID-decode builders expect —
   * unlike the parsed `Tilemap`/`LayerData`, whose `data` is a 2D array of Tile
   * objects. Returns null when the cache, map, or named tile layer is unavailable.
   *
   * @param {string} mapKey - The tilemap cache key (e.g. 'museum_hallway').
   * @param {string} layerName - The tile layer name (e.g. 'Tile Layer 1').
   * @returns {{ data: number[], width: number, height: number }|null}
   * @private
   */
  _getRawLayer(mapKey, layerName) {
    const cache = this.cache && this.cache.tilemap;
    if (!cache || typeof cache.get !== 'function') return null;

    const entry = cache.get(mapKey);
    const json = entry && entry.data ? entry.data : null;
    if (!json || !Array.isArray(json.layers)) return null;

    const layer = json.layers.find(
      (l) => l && l.type === 'tilelayer' && l.name === layerName && Array.isArray(l.data)
    );
    if (!layer) return null;

    return {
      data: layer.data,
      width: Number.isFinite(layer.width) ? layer.width : 0,
      height: Number.isFinite(layer.height) ? layer.height : 0
    };
  }

  /**
   * Read a tileset's RAW Tiled JSON from the tilemap cache, by name.
   *
   * `CollisionBuilder.buildForLayer` needs the Tiled-shaped tileset — `{ firstgid,
   * tiles: [{ id, objectgroup }] }` — to look up per-tile collision shapes by local
   * id. A parsed Phaser `Tileset` does NOT expose this: it stores collision data in
   * `tileData` (an object keyed by local id), not a `tiles` array, so handing the
   * parsed tileset to the builder yields zero collision bodies. The raw JSON tileset
   * carries the `tiles` array the builder expects.
   *
   * @param {string} mapKey - The tilemap cache key (e.g. 'museum_start').
   * @param {string} tilesetName - The tileset name (e.g. 'museum_tileset').
   * @returns {{ firstgid: number, tiles: Array<{id:number, objectgroup?:object}> }|null}
   * @private
   */
  _getRawTileset(mapKey, tilesetName) {
    const cache = this.cache && this.cache.tilemap;
    if (!cache || typeof cache.get !== 'function') return null;

    const entry = cache.get(mapKey);
    const json = entry && entry.data ? entry.data : null;
    if (!json || !Array.isArray(json.tilesets)) return null;

    const ts = json.tilesets.find((t) => t && t.name === tilesetName);
    if (!ts || !Number.isFinite(ts.firstgid)) return null;

    return {
      firstgid: ts.firstgid,
      tiles: Array.isArray(ts.tiles) ? ts.tiles : []
    };
  }

  /**
   * Build collision bodies for one raw tile layer by running EVERY available tileset
   * against it, offset by `worldOffsetX`. A single tile layer can mix tiles from both
   * tilesets (e.g. hallway `Tile Layer 2` holds decor-range GIDs plus main-range
   * bench/stanchion GIDs), and each collidable tile's shape lives in whichever tileset
   * owns its GID range. `CollisionBuilder.buildForLayer` only emits bodies for GIDs
   * inside the passed tileset's range that carry a collision shape, so a tileset that
   * does not own a given GID simply skips it — making the two passes additive and safe.
   *
   * @param {{ data: number[], width: number, height: number }|null} layer
   * @param {number} worldOffsetX
   * @returns {object[]} all collision bodies created for this layer.
   * @private
   */
  _buildLayerCollision(layer, worldOffsetX) {
    if (!layer || !Array.isArray(layer.data) || !this.collisionBuilder) {
      return [];
    }

    let bodies = [];
    for (const tileset of [this.rawTilesetMain, this.rawTilesetDecor]) {
      if (!tileset) continue;
      bodies = bodies.concat(
        this.collisionBuilder.buildForLayer(layer, tileset, worldOffsetX) || []
      );
    }
    return bodies;
  }

  _buildSegment(index, worldOffsetX) {
    if (!this.hallwayMap) {
      return null;
    }

    const authoredMemoryCount = Object.keys(MEMORIES).length;

    /** @type {object[]} */
    const floorSprites = [];
    /** @type {object[]} */
    const layer2Sprites = [];
    /** @type {object[]} */
    let collisionBodies = [];
    /** @type {object[]} */
    const zones = [];
    /** @type {object[]} */
    const paintingSprites = [];

    // Segment tile data is read from the RAW Tiled JSON (flat GID arrays), not the
    // parsed tilemap. Phaser's parsed `LayerData.data` is a 2D array of Tile objects
    // (`data[row][col]`), whereas the per-tile GID-decode logic in the builders below
    // (and in CollisionBuilder.buildForLayer) expects a flat `number[]`. The raw JSON
    // layer carries exactly that flat array plus `width`/`height`.
    const layer1 = this._getRawLayer('museum_hallway', 'Tile Layer 1');
    const layer2 = this._getRawLayer('museum_hallway', 'Tile Layer 2');

    // (a) Floor / wall tiles from the hallway's `Tile Layer 1`, offset by worldOffsetX.
    //     Unlike the start map (which draws these via createLayer), a segment cannot use
    //     createLayer — it is not a tilemap of its own. Draw them as fixed-depth images
    //     pinned below the Y-sort group so segments show the floor instead of black.
    if (layer1 && Array.isArray(layer1.data)) {
      this._buildSegmentFloor(layer1, worldOffsetX, floorSprites);
    }

    // (b) Decor sprites from the hallway's `Tile Layer 2`, offset by worldOffsetX.
    if (layer2 && Array.isArray(layer2.data)) {
      this._buildSegmentDecor(layer2, worldOffsetX, layer2Sprites);
    }

    // (c) Collision bodies from BOTH layers, offset by worldOffsetX. Each layer is run
    //     against EVERY tileset because a layer mixes tiles from both (e.g. `Tile Layer
    //     2` holds decor GIDs plus main-range bench/stanchion/rope GIDs). This picks up
    //     structural, decor (pillars), and furniture (benches, ropes) collisions alike.
    collisionBodies = collisionBodies
      .concat(this._buildLayerCollision(layer1, worldOffsetX))
      .concat(this._buildLayerCollision(layer2, worldOffsetX));

    // (c) Partition the hallway's `Object Layer 1` by Tiled type. Only `memory_zone`
    //     objects become Interaction_Zones and only `painting` objects become
    //     Painting_Sprites; any other/empty/missing-typed object is ignored by both
    //     (Req 1.1–1.5, 6.1). Zone indexing runs over `memory_zone` objects ONLY, so
    //     adding painting objects can never shift `Zone_Index`/`Memory_Index` (Req 1.6).
    const objectLayer =
      typeof this.hallwayMap.getObjectLayer === 'function'
        ? this.hallwayMap.getObjectLayer('Object Layer 1')
        : null;
    const rawObjects =
      objectLayer && Array.isArray(objectLayer.objects) ? objectLayer.objects : [];
    const { memoryZones, paintings } = partitionObjectsByType(rawObjects);

    // (c1) Interaction zones from `memory_zone` objects — indexing UNCHANGED from the
    //      pre-feature behavior (assignZoneIndices + resolveZonePayload + _createZone).
    //      Each zone's size comes from the authored Tiled rectangle (`width`/`height`);
    //      _createZone falls back to ZONE_WIDTH_PX/ZONE_HEIGHT_PX for a sizeless object.
    if (memoryZones.length > 0) {
      const descriptors = memoryZones.map((o) => ({
        x: Number.isFinite(o.x) ? o.x : 0,
        y: Number.isFinite(o.y) ? o.y : 0,
        id: Number.isFinite(o.id) ? o.id : 0,
        width: Number.isFinite(o.width) ? o.width : 0,
        height: Number.isFinite(o.height) ? o.height : 0
      }));
      const ordered = assignZoneIndices(descriptors);

      for (const d of ordered) {
        const resolved = resolveZonePayload(index, d.zoneIndex, MEMORIES, authoredMemoryCount);
        const zoneObj = this._createZone(worldOffsetX + d.x, d.y, d.width, d.height);
        zones.push({
          zone: zoneObj,
          zoneIndex: d.zoneIndex,
          memoryIndex: resolved.memoryIndex,
          id: resolved.id,
          payload: resolved.payload
        });
      }

      if (this.interactionManager && zones.length > 0) {
        this.interactionManager.addZones(zones);
      }
    }

    // (c2) Painting render pass from `painting` objects. Rank them by the SAME
    //      (x, y, id) rule as zones so painting rank k aligns with memory-zone rank k,
    //      resolve each rank's texture key (authored or placeholder), and render a flat
    //      wall sprite filling the object's world-offset bounds at WALL_DEPTH. Paintings
    //      are purely visual: no zone, no event, no physics body (Req 3.1–3.3, 4.1, 7.1).
    if (paintings.length > 0) {
      const orderedPaintings = assignPaintingIndices(
        paintings.map((o) => ({
          x: Number.isFinite(o.x) ? o.x : 0,
          y: Number.isFinite(o.y) ? o.y : 0,
          id: Number.isFinite(o.id) ? o.id : 0,
          width: Number.isFinite(o.width) ? o.width : 0,
          height: Number.isFinite(o.height) ? o.height : 0
        }))
      );

      for (const p of orderedPaintings) {
        const { key } = resolvePaintingImage(index, p.paintingIndex, PAINTINGS, authoredMemoryCount);
        const sprite = this._createPaintingSprite(
          worldOffsetX + p.x,
          p.y,
          p.width,
          p.height,
          key
        );
        if (sprite) paintingSprites.push(sprite);
      }
    }

    return {
      index,
      worldOffsetX,
      floorSprites,
      layer2Sprites,
      collisionBodies,
      zones,
      paintingSprites
    };
  }

  /**
   * Emit fixed-depth floor / wall sprites for a hallway segment's `Tile Layer 1`,
   * offset by `worldOffsetX`. These are the segment equivalent of the start map's
   * `_buildFloorLayer`: a tile layer carries a single depth, so each non-empty tile
   * is drawn as a plain image pinned to {@link GameScene#FLOOR_DEPTH} (strictly below
   * every Y-sorted member) with a top-left origin. They never join the sort group.
   *
   * These tiles come from the main tileset (frames 4/5/13 wall, 14 floor), so the
   * main tileset's image key and firstgid are used, mirroring the floor-layer path.
   *
   * @param {{ data: number[], width: number, height: number }} layer
   * @param {number} worldOffsetX
   * @param {object[]} out - array to collect created sprites into.
   * @private
   */
  _buildSegmentFloor(layer, worldOffsetX, out) {
    const tileset = this.tilesetMain;
    const imageKey = tileset && tileset.image ? tileset.image.key : null;
    if (!imageKey || typeof this.add?.image !== 'function') {
      return;
    }

    const tileW = (this.map && this.map.tileWidth) || 16;
    const tileH = (this.map && this.map.tileHeight) || 16;
    const width = Number.isFinite(layer.width) ? layer.width : 0;
    const firstgid = (tileset && tileset.firstgid) || 1;

    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (gid === -1 || gid === 0 || !Number.isFinite(gid)) continue;

      const { frame, flipH, flipV } = gidDecode(gid);
      if (frame <= 0) continue;

      const col = i % width;
      const row = Math.floor(i / width);
      // Top-left origin at the tile's cell, matching how createLayer lays out tiles.
      const worldX = worldOffsetX + col * tileW;
      const worldY = row * tileH;
      const localFrame = frame - firstgid;

      const sprite = this.add.image(worldX, worldY, imageKey, localFrame);
      if (sprite && typeof sprite.setOrigin === 'function') sprite.setOrigin(0, 0);
      if (sprite && typeof sprite.setDepth === 'function') sprite.setDepth(this.FLOOR_DEPTH);
      if (sprite && typeof sprite.setFlipX === 'function') sprite.setFlipX(flipH);
      if (sprite && typeof sprite.setFlipY === 'function') sprite.setFlipY(flipV);

      out.push(sprite);
    }
  }

  /**
   * Emit feet-origin decor sprites for a hallway segment's `Tile Layer 2`, offset by
   * `worldOffsetX`, mirroring `_buildSortableLayer`'s GID-decode + flip logic. Sprites
   * are added to the Y-sort group and collected into `out` for later release.
   *
   * @param {{ data: number[], width: number, height: number }} layer
   * @param {number} worldOffsetX
   * @param {object[]} out - array to collect created sprites into.
   * @private
   */
  _buildSegmentDecor(layer, worldOffsetX, out) {
    const tileset = this.tilesetDecor || this.tilesetMain;
    const imageKey = tileset && tileset.image ? tileset.image.key : null;
    if (!imageKey || typeof this.add?.image !== 'function') {
      return;
    }

    const tileW = (this.map && this.map.tileWidth) || 16;
    const tileH = (this.map && this.map.tileHeight) || 16;
    const width = Number.isFinite(layer.width) ? layer.width : 0;

    for (let i = 0; i < layer.data.length; i++) {
      const gid = layer.data[i];
      if (gid === -1 || gid === 0 || !Number.isFinite(gid)) continue;

      const { frame, flipH, flipV, flipD } = gidDecode(gid);
      if (frame <= 0) continue;

      // Pick the tileset whose firstgid owns this frame, so sprites key correctly
      // whether the decor lives in museum_tileset or museum_decor.
      const owning = this._tilesetForFrame(frame);
      const owningKey = owning && owning.image ? owning.image.key : imageKey;
      const owningFirstgid = (owning && owning.firstgid) || 1;

      const col = i % width;
      const row = Math.floor(i / width);
      const worldX = worldOffsetX + col * tileW + tileW / 2;
      const worldY = row * tileH + tileH;
      const localFrame = frame - owningFirstgid;

      const sprite = this.add.image(worldX, worldY, owningKey, localFrame);
      if (sprite && typeof sprite.setOrigin === 'function') sprite.setOrigin(0.5, 1);
      if (sprite && typeof sprite.setFlipX === 'function') sprite.setFlipX(flipH);
      if (sprite && typeof sprite.setFlipY === 'function') sprite.setFlipY(flipV);

      if (flipD) {
        console.warn(
          'GameScene: diagonal flip flag on segment decor is not supported; rendering upright.'
        );
      }

      if (this.sortGroup && typeof this.sortGroup.add === 'function') {
        this.sortGroup.add(sprite);
      }
      out.push(sprite);
    }
  }

  /**
   * Resolve which tileset owns a masked frame by firstgid (decor firstgid 41 wins for
   * frames >= 41; otherwise the main tileset). Defensive against missing tilesets.
   *
   * @param {number} frame - masked GID frame.
   * @returns {Phaser.Tilemaps.Tileset|null}
   * @private
   */
  _tilesetForFrame(frame) {
    const decor = this.tilesetDecor;
    const main = this.tilesetMain;
    if (decor && Number.isFinite(decor.firstgid) && frame >= decor.firstgid) {
      return decor;
    }
    return main || decor || null;
  }

  /**
   * True when `key` is a wall-painting texture key (the placeholder or any key
   * referenced by the PAINTINGS source). Used to classify `loaderror` events so a
   * painting load failure is handled locally and never sets `_loadError` (Req 5.4).
   *
   * @param {string|undefined} key - the failed file's load key.
   * @returns {boolean}
   * @private
   */
  _isPaintingTextureKey(key) {
    return typeof key === 'string' && PAINTING_TEXTURE_KEYS.has(key);
  }

  /**
   * Create a Painting_Sprite that fully covers a painting object's world-offset
   * bounds at {@link GameScene#WALL_DEPTH} (flat wall art, below every Y-sort member).
   *
   * - Uses `this.add.image` (NOT `this.physics.add.*`), so the sprite has NO physics
   *   body and never blocks the player (Req 4.5).
   * - Substitutes {@link PAINTING_PLACEHOLDER_KEY} when the requested `textureKey` is
   *   absent from the texture cache or recorded as a failed painting load, so a missing
   *   image still renders the placeholder and never throws (Req 5.2, 5.4).
   * - Top-left origin at `(worldX, worldY)` and `setDisplaySize(width, height)` (when
   *   both are positive) stretch the texture to exactly fill the authored bounds — full
   *   coverage with no gaps (Req 4.2, 4.4). A degenerate zero-size object skips the
   *   resize and renders at the texture's native size (no crash).
   * - `setDepth(WALL_DEPTH)` layers it above the floor and below every actor (Req 4.4).
   *
   * Returns null in headless/mock contexts where `this.add.image` is unavailable, so
   * segment building stays inert under partial mocks.
   *
   * @param {number} worldX - world X of the painting's top-left (segment offset applied).
   * @param {number} worldY - world Y of the painting's top-left.
   * @param {number} width - painting width in px (frame inner area).
   * @param {number} height - painting height in px (frame inner area).
   * @param {string} textureKey - resolved texture key (authored or placeholder).
   * @returns {Phaser.GameObjects.Image|null}
   * @private
   */
  _createPaintingSprite(worldX, worldY, width, height, textureKey) {
    if (typeof this.add?.image !== 'function') return null;

    const exists =
      this.textures && typeof this.textures.exists === 'function'
        ? this.textures.exists(textureKey)
        : false;
    const failed = this._paintingLoadErrors && this._paintingLoadErrors.has(textureKey);
    const key = exists && !failed ? textureKey : PAINTING_PLACEHOLDER_KEY;

    const sprite = this.add.image(worldX, worldY, key);
    if (sprite && typeof sprite.setOrigin === 'function') sprite.setOrigin(0, 0);
    if (
      sprite &&
      typeof sprite.setDisplaySize === 'function' &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      sprite.setDisplaySize(width, height);
    }
    if (sprite && typeof sprite.setDepth === 'function') sprite.setDepth(this.WALL_DEPTH);
    return sprite;
  }

  /**
   * Create a world-offset interaction overlap zone for a segment. Uses the scene's
   * zone factory when available; falls back to a static-body rectangle. Returns a
   * minimal stub object if no zone factory exists (keeps mock tests inert).
   *
   * The zone uses a top-left origin at `(x, y)` and spans `width × height`. Tiled
   * authors the object as a point at the frame's left edge, so a 3-tile-wide zone
   * (`ZONE_WIDTH_PX`) starting there covers the full framed canvas (Req: interact
   * anywhere along the 3-tile frame).
   *
   * @param {number} x - world X of the zone's top-left.
   * @param {number} y - world Y of the zone's top-left.
   * @param {number} [width=ZONE_WIDTH_PX] - zone width in px.
   * @param {number} [height=ZONE_HEIGHT_PX] - zone height in px.
   * @returns {object}
   * @private
   */
  _createZone(x, y, width = ZONE_WIDTH_PX, height = ZONE_HEIGHT_PX) {
    const w = Number.isFinite(width) && width > 0 ? width : ZONE_WIDTH_PX;
    const h = Number.isFinite(height) && height > 0 ? height : ZONE_HEIGHT_PX;

    // Prefer the dedicated Zone factory (invisible overlap region).
    if (this.add && typeof this.add.zone === 'function') {
      const zone = this.add.zone(x, y, w, h);
      if (zone && typeof zone.setOrigin === 'function') zone.setOrigin(0, 0);
      if (
        this.physics &&
        this.physics.add &&
        typeof this.physics.add.existing === 'function'
      ) {
        this.physics.add.existing(zone, true);
      }
      return zone;
    }
    // Headless/mock fallback: a plain descriptor so overlap checks don't throw.
    return { x, y, width: w, height: h };
  }

  /**
   * Dispose a segment's scene-owned handles on recycle (injected into SegmentManager).
   * Destroys decor sprites (removing them from the Y-sort group), collision bodies,
   * and interaction zones. Every call is guarded so release never throws.
   *
   * @param {{ floorSprites?: object[], layer2Sprites?: object[], collisionBodies?: object[], zones?: object[], paintingSprites?: object[] }} segment
   * @private
   */
  _releaseSegment(segment) {
    if (!segment) return;

    // Fixed-depth floor / wall sprites never joined the sort group — just destroy them.
    const floor = Array.isArray(segment.floorSprites) ? segment.floorSprites : [];
    for (const sprite of floor) {
      if (sprite && typeof sprite.destroy === 'function') sprite.destroy();
    }

    const sprites = Array.isArray(segment.layer2Sprites) ? segment.layer2Sprites : [];
    for (const sprite of sprites) {
      if (this.sortGroup && typeof this.sortGroup.remove === 'function') {
        this.sortGroup.remove(sprite);
      }
      if (sprite && typeof sprite.destroy === 'function') sprite.destroy();
    }

    const bodies = Array.isArray(segment.collisionBodies) ? segment.collisionBodies : [];
    for (const body of bodies) {
      if (body && typeof body.destroy === 'function') body.destroy();
    }

    // Painting sprites are flat wall art: they never joined the Y-sort group and have
    // no physics body, so mirror the floorSprites branch — a plain destroy (Req 4.6, 4.7).
    const paintings = Array.isArray(segment.paintingSprites) ? segment.paintingSprites : [];
    for (const sprite of paintings) {
      if (sprite && typeof sprite.destroy === 'function') sprite.destroy();
    }

    const zones = Array.isArray(segment.zones) ? segment.zones : [];
    if (this.interactionManager && zones.length > 0) {
      this.interactionManager.removeZones(zones);
    }
    for (const z of zones) {
      if (z && z.zone && typeof z.zone.destroy === 'function') z.zone.destroy();
    }
  }

  /**
   * World X of the camera's right bound given the current segment generation state.
   *
   * The right bound follows the rightmost generated segment's right edge but is capped
   * and fixed at the final segment's right edge (`_maxX`). With `segmentCount` segments
   * generated, the highest generated index is `segmentCount - 1`, so its right edge is
   * `startRightEdgeX + segmentCount * SEGMENT_WIDTH_PX`. Before any segment exists
   * (`segmentCount === 0`) the bound is the start-map right edge (`startRightEdgeX`).
   * The result is clamped to `[startRightEdgeX, _maxX]` so it never reveals space past
   * the final segment and never shrinks below the start seam (Req 10.4, 13.4).
   *
   * @returns {number}
   * @private
   */
  _cameraRightBound() {
    const count =
      this.segmentManager && Number.isFinite(this.segmentManager.segmentCount)
        ? this.segmentManager.segmentCount
        : 0;
    const grown = this._startRightEdgeX + count * SEGMENT_WIDTH_PX;
    // Never below the start seam, never past the deterministic cap (Req 10.4, 13.4).
    return Math.min(Math.max(grown, this._startRightEdgeX), this._maxX);
  }

  /**
   * Apply the camera (and keep them agreeing with the physics world) horizontal bounds
   * to `[minX, rightBound]` at the fixed camera height. The left bound is always the
   * start-map left edge (Req 10.3, Property 15); the right bound is the current grown-
   * and-capped value from {@link _cameraRightBound}.
   *
   * @private
   */
  _applyCameraBounds() {
    if (!this.cameras || !this.cameras.main || typeof this.cameras.main.setBounds !== 'function') {
      return;
    }
    const left = this._minX;
    const right = this._cameraRightBound();
    const height = Number.isFinite(this._cameraHeight) ? this._cameraHeight : SEGMENT_WIDTH_PX;
    this.cameras.main.setBounds(left, 0, right - left, height);
  }

  update() {
    // Nothing to drive until the scene has built successfully (guards headless/error
    // states where create() bailed out before wiring the subsystems).
    // 1) Resolve player movement + the two-sided clamp.
    if (this.playerController && this.cursors && this.wasd) {
      this.playerController.update(this.cursors, this.wasd);
    }

    // 2) Generate / recycle hallway segments based on the player's world X. Segment
    //    generation is bounded and capped internally by SegmentManager.
    if (
      this.segmentManager &&
      typeof this.segmentManager.update === 'function' &&
      this.player
    ) {
      this.segmentManager.update(this.player.x);
    }

    // 3) Re-sort every dynamic object by its bottom edge each frame so the player
    //    slides in front of or behind buildings and props as it moves. All sprites
    //    in the group use a feet origin, so their world Y is the sort key.
    if (this.sortGroup && typeof this.sortGroup.getChildren === 'function') {
      const children = this.sortGroup.getChildren();
      for (let i = 0; i < children.length; i++) {
        children[i].setDepth(children[i].y);
      }
    }

    // 4) Prompt follows the player and is visible iff the player overlaps an
    //    interaction zone AND no overlay is open (Req 8.1, 8.3, 8.4).
    if (this.promptLabel && this.player) {
      if (typeof this.promptLabel.follow === 'function') {
        this.promptLabel.follow(this.player);
      }
      const overlaps =
        this.interactionManager &&
        typeof this.interactionManager.isPlayerOverlappingZone === 'function'
          ? this.interactionManager.isPlayerOverlappingZone(this.player)
          : false;
      if (typeof this.promptLabel.setVisible === 'function') {
        this.promptLabel.setVisible(overlaps && !this.overlayOpen);
      }
    }

    // 5) Check interaction every frame (E-key edge detection is internal to the
    //    InteractionManager; it no-ops while locked / an overlay is open).
    if (this.interactionManager && typeof this.interactionManager.checkInteraction === 'function') {
      this.interactionManager.checkInteraction(this.player);
    }

    // 6) Extend the camera right bound only when a strictly new segment generated this
    //    frame, capped at the final segment's right edge (Req 10.4, 13.4). On
    //    generation failure SegmentManager does not raise the count, so the bound is
    //    left unchanged.
    const count =
      this.segmentManager && Number.isFinite(this.segmentManager.segmentCount)
        ? this.segmentManager.segmentCount
        : 0;
    if (count > this._lastSegmentCount) {
      this._lastSegmentCount = count;
      this._applyCameraBounds();
    }
  }

  /**
   * Build a `Tile Layer 1`-style floor / back-wall layer at a fixed low depth.
   *
   * Floor and back-wall tiles never Y-sort against the player — they always draw
   * beneath every Y_Sort_Group member. A single tilemap layer carries one depth,
   * so pinning it to {@link GameScene#FLOOR_DEPTH} (strictly below any positive
   * feet world Y) satisfies Req 7.7 cheaply without per-frame sorting.
   *
   * @param {string} layerName - Name of the floor/back-wall tile layer in the map JSON
   * @param {Phaser.Tilemaps.Tileset|Phaser.Tilemaps.Tileset[]} tileset - Tileset(s) the layer draws from
   * @returns {Phaser.Tilemaps.TilemapLayer|null} The created layer, or null if absent
   */
  /**
   * Compute the walkable floor band (feet-Y range) from the start map's `Tile Layer 1`.
   *
   * The map's back wall occupies the upper rows and the walkable floor the lower rows
   * (a single floor frame repeated). This finds the floor frame from the bottom row,
   * then walks upward to the first row that is still entirely that floor frame — the
   * floor's top row. The returned band is in world-Y feet coordinates: `topY` is that
   * top row's top edge (feet may not go above it, which would put the character on the
   * wall), and `bottomY` is the map's bottom edge.
   *
   * Every hallway segment reuses the same row layout, so this one band applies
   * everywhere. Returns null if the layer data is unavailable (clamp stays a no-op).
   *
   * @returns {{ topY: number, bottomY: number }|null}
   * @private
   */
  _computeFloorBand() {
    // Use the raw flat JSON layer (number[]), not the parsed LayerData (Tile[][]).
    const layer = this._getRawLayer('museum_start', 'Tile Layer 1');
    if (!layer || !Array.isArray(layer.data) || !Number.isFinite(layer.width)) {
      return null;
    }

    const width = layer.width;
    const height = Number.isFinite(layer.height)
      ? layer.height
      : Math.floor(layer.data.length / width);
    if (width <= 0 || height <= 0) return null;

    const tileH = (this.map && this.map.tileHeight) || 16;

    // Floor frame = the (masked) frame of the bottom-left cell (the walkable floor).
    const bottomLeftGid = layer.data[(height - 1) * width] ?? 0;
    const floorFrame = bottomLeftGid & 0x1fffffff;
    if (floorFrame <= 0) return null;

    // Walk upward while each row is entirely the floor frame; the first row that is
    // NOT all-floor marks the wall, so the floor's top row is the one just below it.
    let floorTopRow = height - 1;
    for (let row = height - 1; row >= 0; row--) {
      let allFloor = true;
      for (let col = 0; col < width; col++) {
        const gid = layer.data[row * width + col] ?? 0;
        if ((gid & 0x1fffffff) !== floorFrame) {
          allFloor = false;
          break;
        }
      }
      if (!allFloor) break;
      floorTopRow = row;
    }

    return {
      topY: floorTopRow * tileH,
      bottomY: height * tileH
    };
  }

  _buildFloorLayer(layerName, tileset) {
    if (!this.map || typeof this.map.createLayer !== 'function') return null;

    const layer = this.map.createLayer(layerName, tileset);
    if (!layer) return null;

    if (typeof layer.setDepth === 'function') {
      layer.setDepth(this.FLOOR_DEPTH);
    }

    return layer;
  }

  /**
   * Convert a Tiled tile layer into individually depth-sortable sprites.
   *
   * A single tilemap layer can only carry one depth value, so its tiles cannot
   * be Y-sorted against the player. Instead we create the layer (hidden, so it
   * still serves as the authoritative tile-data source from Tiled), then emit a
   * sprite per non-empty tile into the shared sort group. Each sprite uses a
   * feet origin so its world Y is the sort key — the same key the player uses.
   *
   * This works uniformly for standalone objects (trees, lamp posts) and for the
   * base pieces of buildings/walls, since both are just tiles on their layer.
   *
   * @param {string} layerName - Name of the tile layer in the map JSON
   * @param {Phaser.Tilemaps.Tileset} tileset - The tileset the layer draws from
   * @returns {Phaser.Tilemaps.TilemapLayer|null} The (hidden) source layer
   */
  _buildSortableLayer(layerName, tileset) {
    if (!this.map || typeof this.map.getLayer !== 'function') return null;

    // Skip cleanly if the layer doesn't exist in this map
    if (!this.map.getLayer(layerName)) return null;

    const layer = this.map.createLayer(layerName, tileset);
    if (!layer) return null;

    // The source layer is data only — the sortable sprites carry the visuals.
    if (typeof layer.setVisible === 'function') {
      layer.setVisible(false);
    }

    // The tileset image key is the sole texture source for every sprite here —
    // there is no legacy fallback (Req 1.6 / 7.x). A sortable layer without a
    // usable tileset image cannot be drawn, so skip it rather than guessing.
    const imageKey = tileset && tileset.image ? tileset.image.key : null;
    if (!imageKey) return layer;

    // forEachTile visits every tile; we spawn a sprite for each non-empty one.
    if (typeof layer.forEachTile === 'function') {
      const tileW = this.map.tileWidth || 16;
      const tileH = this.map.tileHeight || 16;

      // firstgid maps a (masked) Tiled GID to a 0-based frame in the tileset image.
      const firstgid = (tileset && tileset.firstgid) || 1;

      layer.forEachTile((tile) => {
        if (!tile) return;

        // Phaser's empty-cell sentinels are the raw values -1 and 0 (no flip
        // flags are ever set on an empty cell), so skip those up front. Masking
        // them with gidDecode would NOT flag them as empty: `-1 & 0x1FFFFFFF`
        // is a large positive frame in two's complement, so this guard must run
        // on the raw index before decoding (Req 7.1).
        if (tile.index === -1 || tile.index === 0) return;

        // The tile's index still carries Tiled's top-3-bit flip flags, so decode
        // it: gidDecode masks the real frame and surfaces the H/V/diagonal
        // orientation (Req 7.1, 7.2, 7.7).
        const { frame, flipH, flipV, flipD } = gidDecode(tile.index);

        // A masked frame of 0 is also empty (a masked-to-empty value). Create no
        // sprite for it (Req 7.1).
        if (frame <= 0) return;

        // Position at the tile's bottom-center so the feet origin puts the sort
        // key (world Y) at the tile's base — the same key the player uses.
        const worldX = tile.pixelX + tileW / 2;
        const worldY = tile.pixelY + tileH;

        // Convert the masked GID to a 0-based local frame within the tileset image.
        const localFrame = frame - firstgid;

        const sprite = this.add.image(worldX, worldY, imageKey, localFrame);
        sprite.setOrigin(0.5, 1);

        // Apply orientation discovered in the GID (Req 7.2). setFlipX/setFlipY
        // mirror the sprite in place; the feet origin keeps the sort key intact.
        if (typeof sprite.setFlipX === 'function') sprite.setFlipX(flipH);
        if (typeof sprite.setFlipY === 'function') sprite.setFlipY(flipV);

        // Diagonal flips do not occur in the current maps. Handle them defensively:
        // setFlipX/setFlipY cannot express a diagonal/transpose, so warn and render
        // the tile upright rather than crashing (documented limitation, Req 7.7).
        if (flipD) {
          console.warn(
            `GameScene: diagonal flip flag on layer "${layerName}" tile is not supported; rendering upright.`
          );
        }

        this.sortGroup.add(sprite);
      });
    }

    return layer;
  }

  /**
   * Find the `player_spawn` object from the start map's object layer. When no spawn
   * object exists, fall back to a LEFT-OF-EVERYTHING floor position that is inside the
   * start-map bounds (near the left edge, on the floor row) rather than tile (0,0),
   * which may sit above/outside the floor (Req 2.x).
   *
   * @returns {{ x: number, y: number }}
   */
  _findPlayerSpawn() {
    const fallback = this._leftOfEverythingSpawn();

    if (!this.map || typeof this.map.getObjectLayer !== 'function') return fallback;

    // The converted start map uses "Object Layer 1"; older maps used "spawn".
    const objectLayer =
      this.map.getObjectLayer('Object Layer 1') || this.map.getObjectLayer('spawn');
    if (!objectLayer || !Array.isArray(objectLayer.objects)) return fallback;

    const spawnObj = objectLayer.objects.find(
      (obj) => obj.type === 'player_spawn' || obj.name === 'player_spawn'
    );

    if (spawnObj) {
      return { x: spawnObj.x, y: spawnObj.y };
    }

    return fallback;
  }

  /**
   * Compute a left-of-everything spawn on the floor row, clamped inside the start-map
   * bounds. X sits one tile in from the left edge; Y sits two tile-rows up from the
   * map's bottom so the feet-origin sprite rests on the floor rather than at (0,0).
   *
   * @returns {{ x: number, y: number }}
   * @private
   */
  _leftOfEverythingSpawn() {
    const tileW = (this.map && this.map.tileWidth) || 16;
    const tileH = (this.map && this.map.tileHeight) || 16;
    const heightPx = this.map && Number.isFinite(this.map.heightInPixels)
      ? this.map.heightInPixels
      : tileH * 2;

    // One tile in from the left, feet on a floor row near (but inside) the bottom.
    const x = tileW;
    const y = Math.max(tileH, heightPx - tileH);
    return { x, y };
  }

  /**
   * Display an error message centered in the canvas.
   * Uses monospace font as a reliable fallback when custom fonts may not have loaded.
   * @param {string} message
   */
  _displayError(message) {
    const { width, height } = this.cameras.main;

    // Dark background for readability
    this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);

    // Error text
    this.add.text(width / 2, height / 2, message, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ff6b6b',
      align: 'center',
      wordWrap: { width: width - 40 }
    }).setOrigin(0.5);
  }
}
