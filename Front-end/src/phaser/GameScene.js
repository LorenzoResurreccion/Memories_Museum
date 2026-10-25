import { Scene } from 'phaser';
import PlayerController from './PlayerController.js';
import HotspotManager from './HotspotManager.js';
import eventBus from './EventBus.js';

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
 * - Load tilemap JSON, tileset image, and player spritesheet in preload()
 * - Build map layers in correct z-order in create()
 * - Configure collision from the collision layer
 * - Spawn player at player_spawn coordinates (fallback to tile 0,0)
 * - Set up input (cursors + WASD) and PlayerController
 * - Handle missing assets gracefully with error messages
 *
 * Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.5, 4.1, 4.2, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.2, 6.4, 7.4, 9.4
 */
export default class GameScene extends Scene {
  constructor() {
    super({ key: 'GameScene' });

    /** @type {Phaser.Tilemaps.Tilemap|null} */
    this.map = null;

    /** @type {Phaser.Tilemaps.TilemapLayer|null} */
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

    /** @type {HotspotManager|null} */
    this.hotspotManager = null;

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
  }

  preload() {
    // Track load errors
    this.load.on('loaderror', (fileObj) => {
      if (fileObj.key === 'player') {
        // Don't set global _loadError for player sprite — handled separately with timeout
        this._playerSpriteError = true;
      } else {
        this._loadError = true;

        if (fileObj.type === 'tilemapJSON') {
          this._errorMessage = 'Error: Map could not be loaded';
        } else if (fileObj.type === 'image') {
          const filename = fileObj.key || fileObj.url || 'unknown';
          this._errorMessage = `Error: Missing tileset: ${filename}`;
        } else {
          this._errorMessage = `Error: Failed to load asset: ${fileObj.key || 'unknown'}`;
        }
      }
    });

    // Load tilemap JSON
    this.load.tilemapTiledJSON('madison-map', 'assets/maps/madison-map.json');

    // Load the combined location tileset — key must match the tileset "name" in the map JSON
    this.load.image('madison', 'assets/tilesets/madison.png');

    // Load player spritesheet (4 rows × 3 columns, 32×32 frames)
    this.load.spritesheet('player', 'assets/sprites/Renzo_Sprite.png', {
      frameWidth: 16,
      frameHeight: 32
    });

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

    // Build the tilemap
    this.map = this.make.tilemap({ key: 'madison-map' });

    // Add the combined location tileset to the map. The first argument must
    // match the tileset "name" in the map JSON; the second is the image key.
    const tileset = this.map.addTilesetImage('madison', 'madison');

    if (!tileset) {
      this._displayError('Error: Missing tileset: madison');
      return;
    }

    // Depth-sort group: holds every object that must overlap the player by Y.
    // The player and all building/prop pieces are added to this group and
    // re-sorted each frame in update() via depthSort().
    this.sortGroup = this.add.group();

    // Create tile layers in the z-order defined by the JSON (first = bottom)
    // Ground layer — always below the player (roads, sidewalks, grass).
    // Fixed low depth; never enters the sort group.
    this.groundLayer = this.map.createLayer('ground', tileset);
    if (this.groundLayer) {
      this.groundLayer.setDepth(0);
    }

    // Buildings and props are converted into individually sortable sprites so
    // the player can walk in front of or behind each one based on world Y.
    // The original tile layers are created but hidden (they act as the source
    // of tile data) so the map stays authorable in Tiled.
    this.wallsLayer = this._buildSortableLayer('buildings', tileset);
    this.propsLayer = this._buildSortableLayer('props', tileset);

    // Collision layer — data only, not rendered visually
    const collisionLayerData = this.map.getLayer('collision');

    if (collisionLayerData) {
      this.collisionLayer = this.map.createLayer('collision', tileset);
      // Make the collision layer invisible (it's data-only)
      this.collisionLayer.setVisible(false);
      // Set collision: exclude empty tiles (-1 and 0), making all non-zero tiles collidable
      this.collisionLayer.setCollisionByExclusion([-1, 0]);
    } else {
      // No collision layer found — treat all tiles as passable (Req 4.4)
      console.warn('GameScene: No collision layer found in tilemap. All tiles will be passable.');
    }

    // Overhead layer (roofs, awnings, tree canopies) — always drawn above the
    // player and everything in the sort group. A fixed high depth keeps it on
    // top cheaply without participating in per-frame Y-sorting.
    this.foregroundLayer = this.map.createLayer('foreground', tileset);

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

    // Set world bounds to match the tilemap size
    this.physics.world.setBounds(
      0, 0,
      this.map.widthInPixels,
      this.map.heightInPixels
    );

    // Set collision between player and collision layer
    if (this.collisionLayer) {
      this.physics.add.collider(this.player, this.collisionLayer);
    }

    // --- Camera setup ---

    // Integer zoom multiplier for crisp pixel art (no sub-pixel bleeding)
    this.cameras.main.setZoom(2);

    // Constrain camera to tilemap boundaries so it never shows areas outside the map
    this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);

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

    // --- HotspotManager ---

    // Get the object group holding spawn point + memory hotspots
    const objectLayer = this.map.getObjectLayer('spawn');

    // Instantiate HotspotManager with the objects layer and shared EventBus
    this.hotspotManager = new HotspotManager(this, objectLayer, eventBus);

    // Subscribe to hotspot-activated: freeze player and lock hotspot manager
    eventBus.on('hotspot-activated', () => {
      this.playerController.freeze();
      this.hotspotManager.setLocked(true);
    });

    // Subscribe to dialogue-dismissed: unfreeze player and unlock hotspot manager
    eventBus.on('dialogue-dismissed', () => {
      this.playerController.unfreeze();
      this.hotspotManager.setLocked(false);
    });

    // Subscribe to image-dismissed: unfreeze player and unlock hotspot manager
    eventBus.on('image-dismissed', () => {
      this.playerController.unfreeze();
      this.hotspotManager.setLocked(false);
    });

    // Foreground layer (renders on top of everything)
    // Already created above via createLayer, just ensure depth is set
  }

  update() {
    // Only process updates if player and controller exist
    if (this.playerController && this.cursors && this.wasd) {
      this.playerController.update(this.cursors, this.wasd);
    }

    // Re-sort every dynamic object by its bottom edge each frame so the player
    // slides in front of or behind buildings and props as it moves. All sprites
    // in the group use a feet origin, so their world Y is the sort key.
    if (this.sortGroup && typeof this.sortGroup.getChildren === 'function') {
      const children = this.sortGroup.getChildren();
      for (let i = 0; i < children.length; i++) {
        children[i].setDepth(children[i].y);
      }
    }

    // Check hotspot interaction every frame (key check is internal to HotspotManager)
    if (this.hotspotManager) {
      this.hotspotManager.checkInteraction(this.player);
    }
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

    // forEachTile visits every tile; we spawn a sprite for each non-empty one.
    if (typeof layer.forEachTile === 'function') {
      const tileW = this.map.tileWidth || 16;
      const tileH = this.map.tileHeight || 16;

      layer.forEachTile((tile) => {
        if (!tile || tile.index <= 0) return;

        // Draw the tile as an image sprite from the tileset texture, keyed by
        // the tile's frame index. Position at the tile's bottom-center so the
        // feet origin puts the sort key at the tile's base.
        const worldX = tile.pixelX + tileW / 2;
        const worldY = tile.pixelY + tileH;

        // firstgid maps a Tiled tile index to a 0-based frame in the tileset image.
        const firstgid = (tileset && tileset.firstgid) || 1;
        const frame = tile.index - firstgid;

        const sprite = this.add.image(worldX, worldY, tileset.image ? tileset.image.key : 'madison', frame);
        sprite.setOrigin(0.5, 1);

        this.sortGroup.add(sprite);
      });
    }

    return layer;
  }

  /**
   * Find the player_spawn object from the Tiled objects layer.
   * Falls back to tile (0, 0) if no spawn point is found.
   * @returns {{ x: number, y: number }}
   */
  _findPlayerSpawn() {
    // Default fallback: tile (0, 0) — center of the first tile
    const fallback = { x: 16, y: 16 };

    if (!this.map) return fallback;

    // Look for the spawn object group
    const objectLayer = this.map.getObjectLayer('spawn');
    if (!objectLayer || !objectLayer.objects) return fallback;

    // Find the player_spawn object
    const spawnObj = objectLayer.objects.find(
      (obj) => obj.type === 'player_spawn' || obj.name === 'player_spawn'
    );

    if (spawnObj) {
      return { x: spawnObj.x, y: spawnObj.y };
    }

    return fallback;
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
