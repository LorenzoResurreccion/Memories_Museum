import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock Phaser's Scene class before importing GameScene
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config.key;
    }
  }
}));

// Mock PlayerController
vi.mock('../PlayerController.js', () => ({
  default: class MockPlayerController {
    constructor(scene, sprite, speed) {
      this.scene = scene;
      this.sprite = sprite;
      this.speed = speed;
      this._frozen = false;
      this.minX = -Infinity;
      this.maxX = Infinity;
    }
    update() {}
    freeze() { this._frozen = true; }
    unfreeze() { this._frozen = false; }
    setBounds(minX, maxX) {
      if (typeof minX === 'number') this.minX = minX;
      if (typeof maxX === 'number') this.maxX = maxX;
    }
  }
}));

// Mock the bounded-hallway subsystems that GameScene.create() instantiates, so the
// scene can be exercised without pulling in their real implementations (same style as
// the PlayerController mock above).
vi.mock('../CollisionBuilder.js', () => ({
  default: class MockCollisionBuilder {
    constructor(scene, group) {
      this.scene = scene;
      this.group = group;
    }
    buildForLayer() { return []; }
    classifyTile() { return 'floor'; }
    tileLocalAABB() { return null; }
  }
}));

vi.mock('../SegmentManager.js', () => ({
  default: class MockSegmentManager {
    constructor(deps) {
      this.deps = deps;
      this._buildSegment = deps && deps.buildSegment;
      this._releaseSegment = deps && deps.releaseSegment;
    }
    update() {}
  }
}));

vi.mock('../InteractionManager.js', () => ({
  default: class MockInteractionManager {
    constructor(scene, bus) {
      this.scene = scene;
      this.bus = bus;
      this._locked = false;
      this._zones = [];
    }
    addZones(z) { this._zones.push(...(z || [])); }
    removeZones() {}
    isPlayerOverlappingZone() { return false; }
    checkInteraction() {}
    setLocked(v) { this._locked = v; }
  }
}));

vi.mock('../PromptLabel.js', () => ({
  default: class MockPromptLabel {
    constructor(scene, offsetY) {
      this.scene = scene;
      this.offsetY = offsetY;
    }
    setVisible() {}
    follow() {}
  }
}));

import GameScene from '../GameScene.js';
import eventBus from '../EventBus.js';
import { PAINTING_PLACEHOLDER_KEY, syncPaintings } from '../../data/paintings.js';
import { setMemories } from '../../data/memories.js';

/** Number of authored memories in the manifest (drives finalSegmentIndex / maxX). */
const AUTHORED_MEMORY_COUNT = 8;

// The real letters are fetched at runtime and never present in tests, so seed the
// shared manifest (and the PAINTINGS derived from it) with stand-in entries.
setMemories(
  Object.fromEntries(
    Array.from({ length: AUTHORED_MEMORY_COUNT }, (_, i) => [i, { text: [`memory ${i}`], imageUrl: null }]),
  ),
);
syncPaintings();
/** Segment width: 58 tiles * 16px. */
const SEGMENT_WIDTH_PX = 58 * 16;

// GameScene.create() subscribes to the shared EventBus singleton. Clear its listeners
// between tests so repeated create() calls don't accumulate stale handlers that fire on
// emits here or in other suites that import the same singleton.
afterEach(() => {
  eventBus._listeners.clear();
});

describe('GameScene', () => {
  it('exports a class as default', () => {
    expect(GameScene).toBeDefined();
    expect(typeof GameScene).toBe('function');
  });

  it('sets the scene key to "GameScene"', () => {
    const scene = new GameScene();
    expect(scene.sceneKey).toBe('GameScene');
  });

  it('has a preload method', () => {
    const scene = new GameScene();
    expect(typeof scene.preload).toBe('function');
  });

  it('has a create method', () => {
    const scene = new GameScene();
    expect(typeof scene.create).toBe('function');
  });

  it('has an update method', () => {
    const scene = new GameScene();
    expect(typeof scene.update).toBe('function');
  });

  it('initializes map and layer properties as null', () => {
    const scene = new GameScene();
    expect(scene.map).toBeNull();
    expect(scene.collisionLayer).toBeNull();
    expect(scene.groundLayer).toBeNull();
    expect(scene.wallsLayer).toBeNull();
    expect(scene.foregroundLayer).toBeNull();
  });

  it('initializes player-related properties as null', () => {
    const scene = new GameScene();
    expect(scene.player).toBeNull();
    expect(scene.playerController).toBeNull();
    expect(scene.cursors).toBeNull();
    expect(scene.wasd).toBeNull();
  });

  it('initializes load error state as false', () => {
    const scene = new GameScene();
    expect(scene._loadError).toBe(false);
    expect(scene._errorMessage).toBeNull();
    expect(scene._playerSpriteError).toBe(false);
  });

  it('has a _displayError method', () => {
    const scene = new GameScene();
    expect(typeof scene._displayError).toBe('function');
  });

  it('has a _findPlayerSpawn method', () => {
    const scene = new GameScene();
    expect(typeof scene._findPlayerSpawn).toBe('function');
  });

  describe('preload()', () => {
    it('registers load error handler and loads map assets and player spritesheet', () => {
      const scene = new GameScene();

      const onMock = vi.fn();
      const tilemapTiledJSONMock = vi.fn();
      const imageMock = vi.fn();
      const spritesheetMock = vi.fn();

      scene.load = {
        on: onMock,
        tilemapTiledJSON: tilemapTiledJSONMock,
        image: imageMock,
        spritesheet: spritesheetMock
      };

      scene.time = {
        delayedCall: vi.fn()
      };

      scene.textures = {
        exists: vi.fn().mockReturnValue(false)
      };

      scene.preload();

      // Should register loaderror handler
      expect(onMock).toHaveBeenCalledWith('loaderror', expect.any(Function));

      // Should load BOTH finite Tiled maps (Req 1.3)
      expect(tilemapTiledJSONMock).toHaveBeenCalledWith(
        'museum_start',
        'assets/maps/museum_start.json'
      );
      expect(tilemapTiledJSONMock).toHaveBeenCalledWith(
        'museum_hallway',
        'assets/maps/museum_hallway.json'
      );

      // Should load BOTH tilesets as 16×16 spritesheets, keyed by the tileset names
      // (Req 1.4). Spritesheets expose each cell as an addressable frame so the
      // Y-sortable decor sprites can draw individual tiles.
      expect(spritesheetMock).toHaveBeenCalledWith(
        'museum_tileset',
        'assets/tilesets/museum_tileset.png',
        { frameWidth: 16, frameHeight: 16 }
      );
      expect(spritesheetMock).toHaveBeenCalledWith(
        'museum_decor',
        'assets/tilesets/museum_decor.png',
        { frameWidth: 16, frameHeight: 16 }
      );

      // Should load player spritesheet
      expect(spritesheetMock).toHaveBeenCalledWith(
        'player',
        'assets/sprites/Lorenzo_Sprite.png',
        { frameWidth: 32, frameHeight: 32 }
      );

      // Should start a 10s timeout timer
      expect(scene.time.delayedCall).toHaveBeenCalledWith(
        10000,
        expect.any(Function)
      );

      // Must NOT reference the old madison assets anywhere (Req 1.3, 1.4)
      const allMapArgs = tilemapTiledJSONMock.mock.calls.flat();
      const allImageArgs = imageMock.mock.calls.flat();
      const allSpritesheetArgs = spritesheetMock.mock.calls.flat();
      [...allMapArgs, ...allImageArgs, ...allSpritesheetArgs].forEach((arg) => {
        expect(String(arg)).not.toMatch(/madison/i);
      });
    });

    it('registers the placeholder painting texture under PAINTING_PLACEHOLDER_KEY (Req 5.1)', () => {
      const scene = new GameScene();

      const imageMock = vi.fn();
      scene.load = {
        on: vi.fn(),
        tilemapTiledJSON: vi.fn(),
        image: imageMock,
        spritesheet: vi.fn()
      };
      scene.time = { delayedCall: vi.fn() };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();

      // The placeholder painting reuses the bundled placeholder asset.
      expect(imageMock).toHaveBeenCalledWith(
        PAINTING_PLACEHOLDER_KEY,
        'assets/photos/placeholder.png'
      );
    });

    it('handles a painting-texture loaderror locally without setting _loadError (Req 5.4)', () => {
      const scene = new GameScene();

      let errorHandler;
      scene.load = {
        on: (event, handler) => { errorHandler = handler; },
        tilemapTiledJSON: vi.fn(),
        image: vi.fn(),
        spritesheet: vi.fn()
      };
      scene.time = { delayedCall: vi.fn() };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();
      errorHandler({ type: 'image', key: PAINTING_PLACEHOLDER_KEY });

      // A painting load failure is NON-fatal: no scene-level error, no error message,
      // and the failed key is recorded for the per-key placeholder fallback.
      expect(scene._loadError).toBe(false);
      expect(scene._errorMessage).toBeNull();
      expect(scene._paintingLoadErrors.has(PAINTING_PLACEHOLDER_KEY)).toBe(true);
    });

    it('sets error message for tilemap load failure', () => {
      const scene = new GameScene();

      let errorHandler;
      scene.load = {
        on: (event, handler) => { errorHandler = handler; },
        tilemapTiledJSON: vi.fn(),
        image: vi.fn(),
        spritesheet: vi.fn()
      };
      scene.time = { delayedCall: vi.fn() };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();
      errorHandler({ type: 'tilemapJSON', key: 'museum_start' });

      expect(scene._loadError).toBe(true);
      expect(scene._errorMessage).toBe('Error: Map could not be loaded');
    });

    it('names the missing tileset for a museum_decor image load failure', () => {
      const scene = new GameScene();

      let errorHandler;
      scene.load = {
        on: (event, handler) => { errorHandler = handler; },
        tilemapTiledJSON: vi.fn(),
        image: vi.fn(),
        spritesheet: vi.fn()
      };
      scene.time = { delayedCall: vi.fn() };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();
      errorHandler({ type: 'image', key: 'museum_decor' });

      expect(scene._loadError).toBe(true);
      expect(scene._errorMessage).toBe('Error: Missing tileset: museum_decor');
    });

    it('names the missing tileset for a museum_tileset image load failure', () => {
      const scene = new GameScene();

      let errorHandler;
      scene.load = {
        on: (event, handler) => { errorHandler = handler; },
        tilemapTiledJSON: vi.fn(),
        image: vi.fn(),
        spritesheet: vi.fn()
      };
      scene.time = { delayedCall: vi.fn() };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();
      errorHandler({ type: 'image', key: 'museum_tileset' });

      expect(scene._loadError).toBe(true);
      expect(scene._errorMessage).toBe('Error: Missing tileset: museum_tileset');
    });

    it('sets playerSpriteError flag when player sprite fails to load', () => {
      const scene = new GameScene();

      let errorHandler;
      scene.load = {
        on: (event, handler) => { errorHandler = handler; },
        tilemapTiledJSON: vi.fn(),
        image: vi.fn(),
        spritesheet: vi.fn()
      };
      scene.time = { delayedCall: vi.fn() };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();
      errorHandler({ type: 'spritesheet', key: 'player' });

      // Player sprite error is tracked separately
      expect(scene._playerSpriteError).toBe(true);
      // Should NOT set the global _loadError (handled via timeout)
      expect(scene._loadError).toBe(false);
    });

    it('timeout fires and shows error if player texture is still missing', () => {
      const scene = new GameScene();

      let timerCallback;
      scene.load = {
        on: vi.fn(),
        tilemapTiledJSON: vi.fn(),
        image: vi.fn(),
        spritesheet: vi.fn()
      };
      scene.time = {
        delayedCall: (delay, cb) => { timerCallback = cb; }
      };
      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      scene.preload();

      // Simulate: map was loaded (create() ran), but player never appeared
      scene.map = {}; // pretend map was built
      scene.player = null;

      // Mock _displayError
      scene._displayError = vi.fn();

      // Fire the timer
      timerCallback();

      expect(scene._playerSpriteError).toBe(true);
      expect(scene._loadError).toBe(true);
      expect(scene._errorMessage).toBe('Error: Sprite could not be loaded');
      expect(scene._displayError).toHaveBeenCalledWith('Error: Sprite could not be loaded');
    });
  });

  describe('create()', () => {
    it('displays error if load failed and does not build map', () => {
      const scene = new GameScene();
      scene._loadError = true;
      scene._errorMessage = 'Error: Map could not be loaded';

      const addTextMock = vi.fn().mockReturnValue({ setOrigin: vi.fn() });
      const addRectMock = vi.fn();

      scene.cameras = { main: { width: 800, height: 600, setZoom: vi.fn(), setBounds: vi.fn(), startFollow: vi.fn() } };
      scene.add = { text: addTextMock, rectangle: addRectMock };

      scene.create();

      expect(addRectMock).toHaveBeenCalled();
      expect(addTextMock).toHaveBeenCalledWith(
        400, 300,
        'Error: Map could not be loaded',
        expect.objectContaining({ fontFamily: 'monospace' })
      );
      expect(scene.map).toBeNull();
    });

    it('displays error if player texture is missing after preload', () => {
      const scene = new GameScene();
      scene._loadError = false;

      scene.textures = { exists: vi.fn().mockReturnValue(false) };

      const addTextMock = vi.fn().mockReturnValue({ setOrigin: vi.fn() });
      const addRectMock = vi.fn();
      scene.cameras = { main: { width: 800, height: 600, setZoom: vi.fn(), setBounds: vi.fn(), startFollow: vi.fn() } };
      scene.add = { text: addTextMock, rectangle: addRectMock };

      scene.create();

      expect(addTextMock).toHaveBeenCalledWith(
        400, 300,
        'Error: Sprite could not be loaded',
        expect.objectContaining({ fontFamily: 'monospace' })
      );
      expect(scene.map).toBeNull();
    });

    /**
     * Build a fully-mocked scene whose assets load successfully. Returns the scene
     * plus the key mocks so individual tests can assert on wiring.
     *
     * @param {object} [opts]
     * @param {Array<object>|null} [opts.startObjects] objects on the start map's object layer
     */
    function makeSuccessfulScene({ startObjects = null } = {}) {
      const scene = new GameScene();
      scene._loadError = false;
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const mockGroundLayer = { setDepth: vi.fn() };
      const mockWallsLayer = { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
      const mockPropsLayer = { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
      const mockForegroundLayer = { setDepth: vi.fn() };
      const mockStartFloorLayer = { name: 'Tile Layer 1', data: [1, 1, 1], width: 3, height: 1 };
      const mockTilesetMain = { firstgid: 1, image: { key: 'museum_tileset' } };
      const mockTilesetDecor = { firstgid: 41, image: { key: 'museum_decor' } };

      const mockStartObjectLayer = { objects: startObjects || [] };

      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        addTilesetImage: vi.fn((name) =>
          name === 'museum_decor' ? mockTilesetDecor : mockTilesetMain
        ),
        createLayer: vi.fn((name) => {
          if (name === 'Tile Layer 1') return mockGroundLayer;
          if (name === 'Tile Layer 2') return mockPropsLayer;
          return null;
        }),
        getLayer: vi.fn((name) => {
          if (name === 'Tile Layer 1') return mockStartFloorLayer;
          if (name === 'Tile Layer 2') return { name };
          return null;
        }),
        getObjectLayer: vi.fn((name) =>
          name === 'Object Layer 1' ? mockStartObjectLayer : null
        ),
        widthInPixels: 928,
        heightInPixels: 240
      };

      // Hallway map returned for the museum_hallway key. Returns empty layers so the
      // injected buildSegment closure is callable without throwing.
      const mockHallwayMap = {
        getLayer: vi.fn().mockReturnValue(null),
        getObjectLayer: vi.fn().mockReturnValue(null)
      };

      scene.make = {
        tilemap: vi.fn((cfg) =>
          cfg && cfg.key === 'museum_hallway' ? mockHallwayMap : mockMap
        )
      };

      const mockBody = {
        setCollideWorldBounds: vi.fn(),
        setSize: vi.fn(),
        setOffset: vi.fn()
      };
      const mockPlayerSprite = {
        setDepth: vi.fn(),
        setOrigin: vi.fn(),
        setFrame: vi.fn(),
        body: mockBody
      };

      const mockStaticGroup = { create: vi.fn() };
      scene.physics = {
        add: {
          sprite: vi.fn().mockReturnValue(mockPlayerSprite),
          collider: vi.fn(),
          staticGroup: vi.fn().mockReturnValue(mockStaticGroup)
        },
        world: { setBounds: vi.fn() }
      };

      const mockCursors = { up: {}, down: {}, left: {}, right: {} };
      const mockAddKey = vi.fn().mockReturnValue({ isDown: false });
      scene.input = {
        keyboard: {
          createCursorKeys: vi.fn().mockReturnValue(mockCursors),
          addKey: mockAddKey,
          on: vi.fn()
        }
      };

      scene.cameras = {
        main: {
          width: 800,
          height: 600,
          setZoom: vi.fn(),
          setBounds: vi.fn(),
          startFollow: vi.fn()
        }
      };

      const mockGroup = { add: vi.fn(), remove: vi.fn(), getChildren: vi.fn().mockReturnValue([]) };
      scene.add = {
        group: vi.fn().mockReturnValue(mockGroup),
        image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() }),
        text: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn(), setVisible: vi.fn() }),
        zone: vi.fn().mockReturnValue({ setOrigin: vi.fn() })
      };

      return {
        scene,
        mockMap,
        mockHallwayMap,
        mockPlayerSprite,
        mockBody,
        mockGroup,
        mockStaticGroup,
        mockTilesetMain,
        mockTilesetDecor,
        mockGroundLayer,
        mockWallsLayer,
        mockPropsLayer,
        mockForegroundLayer,
        mockCursors
      };
    }

    it('builds map, spawns player, and wires the hallway subsystems when assets load', () => {
      const {
        scene,
        mockMap,
        mockPlayerSprite,
        mockBody,
        mockGroup,
        mockStaticGroup,
        mockTilesetMain,
        mockTilesetDecor,
        mockGroundLayer,
        mockPropsLayer,
        mockForegroundLayer,
        mockCursors
      } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }]
      });

      scene.create();

      // Map built from the start-map key (Req 1.3)
      expect(scene.make.tilemap).toHaveBeenCalledWith({ key: 'museum_start' });
      expect(scene.map).toBe(mockMap);

      // Hallway map instantiated once as the per-segment tile-data source
      expect(scene.make.tilemap).toHaveBeenCalledWith({ key: 'museum_hallway' });
      expect(scene.hallwayMap).not.toBeNull();

      // Both embedded tilesets associated by name (Req 1.4)
      expect(mockMap.addTilesetImage).toHaveBeenCalledWith('museum_tileset', 'museum_tileset');
      expect(mockMap.addTilesetImage).toHaveBeenCalledWith('museum_decor', 'museum_decor');
      expect(scene.tilesetMain).toBe(mockTilesetMain);
      expect(scene.tilesetDecor).toBe(mockTilesetDecor);

      expect(scene.groundLayer).toBe(mockGroundLayer);
      // No separate buildings layer; decor lives on `Tile Layer 2` (propsLayer).
      expect(scene.wallsLayer).toBeNull();
      expect(scene.propsLayer).toBe(mockPropsLayer);
      // The current maps declare no overhead `foreground` layer.
      expect(scene.foregroundLayer).toBeNull();

      // No legacy collision tile layer / setCollisionByExclusion anymore (Req 6.6)
      expect(scene.collisionLayer).toBeNull();

      // Subsystems instantiated
      expect(scene.collisionBuilder).not.toBeNull();
      expect(scene.collisionGroup).toBe(mockStaticGroup);
      expect(scene.segmentManager).not.toBeNull();
      expect(scene.interactionManager).not.toBeNull();
      expect(scene.promptLabel).not.toBeNull();

      // Static collision group created via physics.add.staticGroup()
      expect(scene.physics.add.staticGroup).toHaveBeenCalled();

      // Player spawned at the player_spawn coordinates
      expect(scene.physics.add.sprite).toHaveBeenCalledWith(160, 160, 'player', 0);
      expect(mockPlayerSprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
      expect(mockGroup.add).toHaveBeenCalledWith(mockPlayerSprite);
      expect(mockPlayerSprite.setFrame).toHaveBeenCalledWith(0);
      expect(mockBody.setCollideWorldBounds).toHaveBeenCalledWith(true);

      // The current maps declare no overhead `foreground` layer, so none is built
      // and its depth is never pinned.
      expect(mockForegroundLayer.setDepth).not.toHaveBeenCalled();

      // PlayerController bounds set: minX = 0, maxX = final segment floor right edge.
      // N = AUTHORED_MEMORY_COUNT → finalSegmentIndex = floor((N-1)/6); start right
      // edge = widthInPixels (928).
      const finalSegmentIndex = Math.floor((AUTHORED_MEMORY_COUNT - 1) / 6);
      const expectedMaxX = 928 + finalSegmentIndex * SEGMENT_WIDTH_PX + SEGMENT_WIDTH_PX;
      expect(scene.playerController.minX).toBe(0);
      expect(scene.playerController.maxX).toBe(expectedMaxX);

      // Physics world bounds pinned consistently with [minX, maxX]
      expect(scene.physics.world.setBounds).toHaveBeenCalledWith(0, 0, expectedMaxX, 240);

      // Single collider wired against the static collision group (Req 6.5)
      expect(scene.physics.add.collider).toHaveBeenCalledWith(mockPlayerSprite, mockStaticGroup);

      // Input created
      expect(scene.input.keyboard.createCursorKeys).toHaveBeenCalled();
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('W');
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('S');
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('A');
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('D');

      expect(scene.playerController).not.toBeNull();
      expect(scene.player).toBe(mockPlayerSprite);
      expect(scene.cursors).toBe(mockCursors);
    });

    it('sets camera zoom 2, follows the player, and bounds the left edge at the start-map left edge', () => {
      const { scene } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }]
      });

      scene.create();

      // Integer zoom for crisp pixel art (Req 10.x).
      expect(scene.cameras.main.setZoom).toHaveBeenCalledWith(2);
      // Follows the player sprite (Req 10.x).
      expect(scene.cameras.main.startFollow).toHaveBeenCalledWith(scene.player);

      // roundPixels is configured at the game-config level (verified by config.test.js);
      // GameScene makes no per-camera roundPixels call.

      // Left bound pinned at the start-map left edge (minX = 0, Property 15 / Req 10.3).
      // No segment is generated at create(), so the right bound is the start-map right
      // edge (startRightEdgeX = widthInPixels = 928).
      const setBoundsCalls = scene.cameras.main.setBounds.mock.calls;
      expect(setBoundsCalls.length).toBeGreaterThan(0);
      const [left, top, width] = setBoundsCalls[0];
      expect(left).toBe(0);
      expect(top).toBe(0);
      // width = rightBound - left = 928 - 0 at create() time.
      expect(width).toBe(928);
    });

    it('grows the camera right bound as segments generate, capped at the final segment right edge', () => {
      const { scene } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }]
      });

      scene.create();

      const finalSegmentIndex = Math.floor((AUTHORED_MEMORY_COUNT - 1) / 6);
      const maxX = 928 + finalSegmentIndex * SEGMENT_WIDTH_PX + SEGMENT_WIDTH_PX;

      scene.cameras.main.setBounds.mockClear();

      // Simulate one segment having generated (segmentCount 0 → 1). The right bound
      // should extend to startRightEdgeX + 1 * SEGMENT_WIDTH_PX, capped at maxX.
      scene.segmentManager.segmentCount = 1;
      scene.update();

      expect(scene.cameras.main.setBounds).toHaveBeenCalledTimes(1);
      let [, , width] = scene.cameras.main.setBounds.mock.calls[0];
      const expectedRight1 = Math.min(928 + 1 * SEGMENT_WIDTH_PX, maxX);
      expect(width).toBe(expectedRight1 - 0);

      // Drive the count far past the final segment: the bound is capped at maxX and
      // never exceeds it.
      scene.cameras.main.setBounds.mockClear();
      scene.segmentManager.segmentCount = finalSegmentIndex + 1 + 50;
      scene.update();

      expect(scene.cameras.main.setBounds).toHaveBeenCalledTimes(1);
      [, , width] = scene.cameras.main.setBounds.mock.calls[0];
      expect(width).toBe(maxX - 0);
    });

    it('leaves the camera right bound unchanged when no new segment generates (e.g. generation failure)', () => {
      const { scene } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }]
      });

      scene.create();
      scene.cameras.main.setBounds.mockClear();

      // segmentCount stays at 0 (no growth / generation failure). update() must not
      // re-apply camera bounds.
      scene.segmentManager.segmentCount = 0;
      scene.update();

      expect(scene.cameras.main.setBounds).not.toHaveBeenCalled();
    });

    it('freezes the player and locks interaction on hotspot-activated, unfreezing/unlocking on dismiss', () => {
      const { scene } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }]
      });

      scene.create();

      // hotspot-activated → overlayOpen true, player frozen, interaction locked.
      eventBus.emit('hotspot-activated', { id: 'memory-0', text: ['hi'], imageUrl: null });
      expect(scene.overlayOpen).toBe(true);
      expect(scene.playerController._frozen).toBe(true);
      expect(scene.interactionManager._locked).toBe(true);

      // dialogue-dismissed → unfreeze + unlock within the same frame.
      eventBus.emit('dialogue-dismissed');
      expect(scene.overlayOpen).toBe(false);
      expect(scene.playerController._frozen).toBe(false);
      expect(scene.interactionManager._locked).toBe(false);

      // Re-open, then dismiss via image-dismissed → same unfreeze + unlock.
      eventBus.emit('hotspot-activated', { id: 'memory-1', text: ['yo'], imageUrl: 'x.png' });
      expect(scene.overlayOpen).toBe(true);
      expect(scene.playerController._frozen).toBe(true);
      expect(scene.interactionManager._locked).toBe(true);

      eventBus.emit('image-dismissed');
      expect(scene.overlayOpen).toBe(false);
      expect(scene.playerController._frozen).toBe(false);
      expect(scene.interactionManager._locked).toBe(false);
    });

    it('does not create or configure a collision tile layer (collisionLayer stays null)', () => {
      const { scene, mockMap } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }]
      });

      scene.create();

      expect(mockMap.createLayer).not.toHaveBeenCalledWith('collision', expect.anything());
      expect(scene.collisionLayer).toBeNull();
    });

    it('displays a named missing-tileset error and builds nothing when museum_tileset fails to associate', () => {
      const scene = new GameScene();
      scene._loadError = false;
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const createLayerMock = vi.fn();
      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        // Primary tileset association fails (returns null) — Req 1.4, 1.7, 11.4
        addTilesetImage: vi.fn().mockReturnValue(null),
        createLayer: createLayerMock,
        getLayer: vi.fn(),
        getObjectLayer: vi.fn()
      };

      scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };
      scene.add = { group: vi.fn(), rectangle: vi.fn(), text: vi.fn().mockReturnValue({ setOrigin: vi.fn() }) };
      scene.cameras = { main: { width: 800, height: 600 } };
      scene.physics = { add: { sprite: vi.fn() } };

      scene._displayError = vi.fn();

      scene.create();

      expect(scene._displayError).toHaveBeenCalledWith('Error: Missing tileset: museum_tileset');
      // Builds nothing: no layers created, no player spawned
      expect(createLayerMock).not.toHaveBeenCalled();
      expect(scene.physics.add.sprite).not.toHaveBeenCalled();
      expect(scene.groundLayer).toBeNull();
      expect(scene.player).toBeNull();
    });

    it('displays a named missing-tileset error and builds nothing when museum_decor fails to associate', () => {
      const scene = new GameScene();
      scene._loadError = false;
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const createLayerMock = vi.fn();
      const mockTilesetMain = { firstgid: 1, image: { key: 'museum_tileset' } };
      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        // First tileset associates, second (museum_decor) fails — Req 1.4, 1.7, 11.4
        addTilesetImage: vi.fn((name) =>
          name === 'museum_decor' ? null : mockTilesetMain
        ),
        createLayer: createLayerMock,
        getLayer: vi.fn(),
        getObjectLayer: vi.fn()
      };

      scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };
      scene.add = { group: vi.fn(), rectangle: vi.fn(), text: vi.fn().mockReturnValue({ setOrigin: vi.fn() }) };
      scene.cameras = { main: { width: 800, height: 600 } };
      scene.physics = { add: { sprite: vi.fn() } };

      scene._displayError = vi.fn();

      scene.create();

      expect(scene._displayError).toHaveBeenCalledWith('Error: Missing tileset: museum_decor');
      expect(createLayerMock).not.toHaveBeenCalled();
      expect(scene.physics.add.sprite).not.toHaveBeenCalled();
      expect(scene.player).toBeNull();
    });

    it('spawns player at the left-of-everything floor fallback when no player_spawn exists', () => {
      // Start map 928×240; fallback = (tileW, heightInPixels - tileH) = (16, 224),
      // one tile in from the left on a floor row near the bottom (inside start bounds).
      const { scene } = makeSuccessfulScene({
        startObjects: [{ name: 'hotspot_1', type: 'memory_hotspot', x: 320, y: 256 }]
      });

      scene.create();

      expect(scene.physics.add.sprite).toHaveBeenCalledWith(16, 224, 'player', 0);
      // The fallback is strictly inside the start-map bounds.
      const [sx, sy] = scene.physics.add.sprite.mock.calls[0];
      expect(sx).toBeGreaterThanOrEqual(0);
      expect(sx).toBeLessThan(scene.map.widthInPixels);
      expect(sy).toBeGreaterThan(0);
      expect(sy).toBeLessThanOrEqual(scene.map.heightInPixels);
    });

    it('spawns player at the floor fallback when the object layer is missing', () => {
      const { scene, mockMap } = makeSuccessfulScene();
      // No object layer at all.
      mockMap.getObjectLayer = vi.fn().mockReturnValue(null);

      scene.create();

      // Fallback = (16, heightInPixels - tileH) = (16, 224)
      expect(scene.physics.add.sprite).toHaveBeenCalledWith(16, 224, 'player', 0);
    });

    it('derives collision from the static group only — no collision tile layer', () => {
      const { scene, mockMap, mockPlayerSprite, mockStaticGroup } = makeSuccessfulScene({
        startObjects: [{ name: 'player_spawn', type: 'player_spawn', x: 100, y: 100 }]
      });

      scene.create();

      // No collision tile layer is created or configured (Req 6.6).
      expect(mockMap.createLayer).not.toHaveBeenCalledWith('collision', expect.anything());
      expect(scene.collisionLayer).toBeNull();

      // The single collider is wired against the CollisionBuilder static group.
      expect(scene.physics.add.collider).toHaveBeenCalledWith(mockPlayerSprite, mockStaticGroup);
    });
  });

  describe('_buildSortableLayer() — GID decode, flips, Y-sort', () => {
    /**
     * Build a scene whose map.createLayer returns a mock Tile-Layer-2 layer that
     * replays the supplied tiles through forEachTile. Each tile carries its raw
     * (flag-bearing) GID in `index`, matching what gidDecode reads at runtime.
     */
    function makeSceneWithTiles(tiles, { tileset } = {}) {
      const scene = new GameScene();

      const resolvedTileset = tileset || { firstgid: 1, image: { key: 'museum_tileset' } };

      const mockLayer = {
        setVisible: vi.fn(),
        forEachTile: (cb) => tiles.forEach((t) => cb(t))
      };

      scene.map = {
        tileWidth: 16,
        tileHeight: 16,
        getLayer: vi.fn().mockReturnValue({ name: 'buildings' }),
        createLayer: vi.fn().mockReturnValue(mockLayer)
      };

      // Capture every sprite created so assertions can inspect flips/frames.
      const created = [];
      scene.add = {
        image: vi.fn((x, y, key, frame) => {
          const sprite = {
            x, y, key, frame,
            _flipX: false,
            _flipY: false,
            setOrigin: vi.fn().mockReturnThis(),
            setFlipX: vi.fn(function (v) { this._flipX = v; return this; }),
            setFlipY: vi.fn(function (v) { this._flipY = v; return this; })
          };
          created.push(sprite);
          return sprite;
        })
      };
      scene.sortGroup = { add: vi.fn() };

      return { scene, resolvedTileset, created };
    }

    it('creates exactly one feet-origin sprite per non-empty cell and none for -1/0', () => {
      const tiles = [
        { index: 5, pixelX: 0, pixelY: 0 },     // non-empty
        { index: 0, pixelX: 16, pixelY: 0 },    // empty (0) → skipped
        { index: -1, pixelX: 32, pixelY: 0 },   // empty (-1) → skipped
        { index: 9, pixelX: 48, pixelY: 0 }      // non-empty
      ];
      const { scene, resolvedTileset, created } = makeSceneWithTiles(tiles);

      scene._buildSortableLayer('buildings', resolvedTileset);

      // Only the two non-empty cells produced sprites.
      expect(created).toHaveLength(2);
      expect(scene.add.image).toHaveBeenCalledTimes(2);
      expect(scene.sortGroup.add).toHaveBeenCalledTimes(2);

      // Each sprite uses a feet origin (0.5, 1) and feet-aligned world Y.
      created.forEach((sprite) => {
        expect(sprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
        // worldY = pixelY + tileH (16) → bottom edge of the tile row
        expect(sprite.y).toBe(16);
      });
    });

    it('H-flip cell 2147483673 → masked id 25 with flipX true', () => {
      const tiles = [{ index: 2147483673, pixelX: 0, pixelY: 0 }];
      const { scene, resolvedTileset, created } = makeSceneWithTiles(tiles);

      scene._buildSortableLayer('buildings', resolvedTileset);

      expect(created).toHaveLength(1);
      // masked frame = 25; local frame = 25 - firstgid(1) = 24
      expect(created[0].frame).toBe(25 - resolvedTileset.firstgid);
      expect(created[0].setFlipX).toHaveBeenCalledWith(true);
      expect(created[0].setFlipY).toHaveBeenCalledWith(false);
      expect(created[0]._flipX).toBe(true);
    });

    it('H-flip cell 2147483684 → masked id 36 with flipX true', () => {
      const tiles = [{ index: 2147483684, pixelX: 0, pixelY: 0 }];
      const { scene, resolvedTileset, created } = makeSceneWithTiles(tiles);

      scene._buildSortableLayer('buildings', resolvedTileset);

      expect(created).toHaveLength(1);
      expect(created[0].frame).toBe(36 - resolvedTileset.firstgid);
      expect(created[0].setFlipX).toHaveBeenCalledWith(true);
      expect(created[0]._flipX).toBe(true);
    });

    it('ignores a diagonal-flagged cell: warns, no throw, sprite stays upright', () => {
      // 0x20000000 (diagonal) OR'd onto base id 5 = 536870917
      const diagonalGid = 0x20000000 | 5;
      const tiles = [{ index: diagonalGid, pixelX: 0, pixelY: 0 }];
      const { scene, resolvedTileset, created } = makeSceneWithTiles(tiles);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => scene._buildSortableLayer('buildings', resolvedTileset)).not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('diagonal flip'));
      // Sprite still created, upright (no flip applied for the diagonal bit).
      expect(created).toHaveLength(1);
      expect(created[0]._flipX).toBe(false);
      expect(created[0]._flipY).toBe(false);

      warnSpy.mockRestore();
    });

    it('never passes a "madison" key to add.image', () => {
      const tiles = [
        { index: 5, pixelX: 0, pixelY: 0 },
        { index: 2147483673, pixelX: 16, pixelY: 0 }
      ];
      const { scene, resolvedTileset } = makeSceneWithTiles(tiles);

      scene._buildSortableLayer('buildings', resolvedTileset);

      scene.add.image.mock.calls.forEach((callArgs) => {
        expect(String(callArgs[2])).not.toMatch(/madison/i);
        expect(callArgs[2]).toBe('museum_tileset');
      });
    });

    it('keys sprites by the decor tileset image when that tileset is passed', () => {
      const decorTileset = { firstgid: 41, image: { key: 'museum_decor' } };
      const tiles = [{ index: 45, pixelX: 0, pixelY: 0 }];
      const { scene, created } = makeSceneWithTiles(tiles, { tileset: decorTileset });

      scene._buildSortableLayer('buildings', decorTileset);

      expect(created).toHaveLength(1);
      expect(created[0].key).toBe('museum_decor');
      // local frame = 45 - firstgid(41) = 4
      expect(created[0].frame).toBe(4);
    });
  });

  describe('_buildFloorLayer() — fixed low depth', () => {
    it('builds Tile Layer 1 at the fixed floor depth (strictly below Y-sort members)', () => {
      const scene = new GameScene();
      const mockLayer = { setDepth: vi.fn() };
      scene.map = {
        createLayer: vi.fn().mockReturnValue(mockLayer)
      };

      const result = scene._buildFloorLayer('ground', { firstgid: 1 });

      expect(scene.map.createLayer).toHaveBeenCalledWith('ground', { firstgid: 1 });
      expect(mockLayer.setDepth).toHaveBeenCalledWith(scene.FLOOR_DEPTH);
      expect(scene.FLOOR_DEPTH).toBe(0);
      expect(result).toBe(mockLayer);
    });

    it('returns null when the floor layer is absent', () => {
      const scene = new GameScene();
      scene.map = { createLayer: vi.fn().mockReturnValue(null) };

      expect(scene._buildFloorLayer('ground', {})).toBeNull();
    });
  });

  describe('update()', () => {
    it('calls playerController.update with cursors and wasd', () => {
      const scene = new GameScene();
      const mockUpdate = vi.fn();

      scene.playerController = { update: mockUpdate };
      scene.cursors = { up: {}, down: {}, left: {}, right: {} };
      scene.wasd = { up: {}, down: {}, left: {}, right: {} };

      scene.update();

      expect(mockUpdate).toHaveBeenCalledWith(scene.cursors, scene.wasd);
    });

    it('does nothing if playerController is not yet initialized', () => {
      const scene = new GameScene();
      scene.playerController = null;
      scene.cursors = null;
      scene.wasd = null;

      // Should not throw
      expect(() => scene.update()).not.toThrow();
    });

    it('re-depths every Y-sort member to its feet Y, keeping the floor below all members (Req 7.3, 7.7)', () => {
      const scene = new GameScene();

      // Null-safe the other update() collaborators so the test isolates the depth pass.
      scene.playerController = null;
      scene.cursors = null;
      scene.wasd = null;

      // Several Y-sort members with distinct positive feet-Y values and a setDepth spy.
      const members = [
        { y: 48, depth: 0, setDepth: vi.fn(function (d) { this.depth = d; }) },
        { y: 112, depth: 0, setDepth: vi.fn(function (d) { this.depth = d; }) },
        { y: 16, depth: 0, setDepth: vi.fn(function (d) { this.depth = d; }) }
      ];
      scene.sortGroup = { getChildren: vi.fn().mockReturnValue(members) };

      scene.update();

      // After the depth pass, every member's depth equals its feet world Y.
      members.forEach((m) => {
        expect(m.setDepth).toHaveBeenCalledWith(m.y);
        expect(m.depth).toBe(m.y);
      });

      // The fixed floor depth is strictly less than the minimum member depth.
      const minMemberDepth = Math.min(...members.map((m) => m.depth));
      expect(scene.FLOOR_DEPTH).toBeLessThan(minMemberDepth);
    });

    it('drives segment generation with the player X each frame', () => {
      const scene = new GameScene();
      const segUpdate = vi.fn();
      scene.segmentManager = { update: segUpdate, segmentCount: 0 };
      scene.player = { x: 1234 };

      scene.update();

      expect(segUpdate).toHaveBeenCalledWith(1234);
    });

    it('follows the prompt and shows it iff overlapping a zone and no overlay is open', () => {
      const scene = new GameScene();
      const player = { x: 100, y: 200 };
      scene.player = player;

      const follow = vi.fn();
      const setVisible = vi.fn();
      scene.promptLabel = { follow, setVisible };

      // Overlapping + no overlay → visible.
      scene.interactionManager = {
        isPlayerOverlappingZone: vi.fn().mockReturnValue(true),
        checkInteraction: vi.fn()
      };
      scene.overlayOpen = false;
      scene.update();

      expect(follow).toHaveBeenCalledWith(player);
      expect(setVisible).toHaveBeenLastCalledWith(true);

      // Overlapping but overlay open → hidden.
      scene.overlayOpen = true;
      scene.update();
      expect(setVisible).toHaveBeenLastCalledWith(false);

      // Not overlapping → hidden regardless of overlay.
      scene.overlayOpen = false;
      scene.interactionManager.isPlayerOverlappingZone.mockReturnValue(false);
      scene.update();
      expect(setVisible).toHaveBeenLastCalledWith(false);
    });

    it('checks interaction every frame', () => {
      const scene = new GameScene();
      const checkInteraction = vi.fn();
      scene.player = { x: 10, y: 20 };
      scene.interactionManager = {
        isPlayerOverlappingZone: vi.fn().mockReturnValue(false),
        checkInteraction
      };

      scene.update();

      expect(checkInteraction).toHaveBeenCalledWith(scene.player);
    });

    it('extends the camera right bound only when the segment count increases, capped at maxX', () => {
      const scene = new GameScene();
      // Geometry: start seam 928, final segment index 1 → maxX = 928 + 1*928 + 928.
      scene._startRightEdgeX = 928;
      scene._minX = 0;
      scene._maxX = 928 + 1 * SEGMENT_WIDTH_PX + SEGMENT_WIDTH_PX;
      scene._cameraHeight = 240;
      scene._lastSegmentCount = 0;

      const setBounds = vi.fn();
      scene.cameras = { main: { setBounds } };
      scene.player = { x: 0, y: 0 };
      scene.segmentManager = { update: vi.fn(), segmentCount: 1 };

      // Count 0 → 1 triggers one camera-bound apply.
      scene.update();
      expect(setBounds).toHaveBeenCalledTimes(1);
      let [left, , width] = setBounds.mock.calls[0];
      expect(left).toBe(0);
      expect(width).toBe(928 + SEGMENT_WIDTH_PX); // right = 928 + 1*928

      // No further increase → no additional apply.
      setBounds.mockClear();
      scene.update();
      expect(setBounds).not.toHaveBeenCalled();

      // Count jumps past the final segment → bound capped at maxX.
      setBounds.mockClear();
      scene.segmentManager.segmentCount = 999;
      scene.update();
      expect(setBounds).toHaveBeenCalledTimes(1);
      [, , width] = setBounds.mock.calls[0];
      expect(width).toBe(scene._maxX);
    });

    it('runs the full per-frame sequence in one update(): movement, segments, depth, prompt, interaction (Req 7.3, 8.1-8.4, 10.4, 13.4)', () => {
      const scene = new GameScene();

      // Geometry so the camera-bound step is well-defined.
      scene._startRightEdgeX = 928;
      scene._minX = 0;
      scene._maxX = 928 + SEGMENT_WIDTH_PX;
      scene._cameraHeight = 240;
      scene._lastSegmentCount = 0;

      const player = { x: 500, y: 300 };
      scene.player = player;
      scene.cursors = { up: {}, down: {}, left: {}, right: {} };
      scene.wasd = { up: {}, down: {}, left: {}, right: {} };

      const playerUpdate = vi.fn();
      scene.playerController = { update: playerUpdate };

      const segUpdate = vi.fn();
      scene.segmentManager = { update: segUpdate, segmentCount: 1 };

      const members = [
        { y: 90, depth: 0, setDepth: vi.fn(function (d) { this.depth = d; }) },
        { y: 30, depth: 0, setDepth: vi.fn(function (d) { this.depth = d; }) }
      ];
      scene.sortGroup = { getChildren: vi.fn().mockReturnValue(members) };

      const follow = vi.fn();
      const setVisible = vi.fn();
      scene.promptLabel = { follow, setVisible };

      const checkInteraction = vi.fn();
      scene.interactionManager = {
        isPlayerOverlappingZone: vi.fn().mockReturnValue(true),
        checkInteraction
      };
      scene.overlayOpen = false;

      const setBounds = vi.fn();
      scene.cameras = { main: { setBounds } };

      scene.update();

      // 1) movement resolved with cursors + wasd
      expect(playerUpdate).toHaveBeenCalledWith(scene.cursors, scene.wasd);
      // 2) segment generation driven with player X
      expect(segUpdate).toHaveBeenCalledWith(500);
      // 3) every Y-sort member re-depthed to its feet Y
      members.forEach((m) => expect(m.depth).toBe(m.y));
      // 4) prompt follows + visible (overlap && !overlayOpen)
      expect(follow).toHaveBeenCalledWith(player);
      expect(setVisible).toHaveBeenLastCalledWith(true);
      // 5) interaction checked this frame
      expect(checkInteraction).toHaveBeenCalledWith(player);
      // 6) camera right bound extended (count 0 → 1), capped at maxX
      expect(setBounds).toHaveBeenCalledTimes(1);
      const [, , width] = setBounds.mock.calls[0];
      expect(width).toBe(scene._maxX);
    });
  });

  describe('_findPlayerSpawn()', () => {
    it('returns spawn coordinates from the "Object Layer 1" object layer', () => {
      const scene = new GameScene();
      scene.map = {
        getObjectLayer: vi.fn((name) =>
          name === 'Object Layer 1'
            ? { objects: [{ name: 'player_spawn', type: 'player_spawn', x: 256, y: 320 }] }
            : null
        )
      };

      const result = scene._findPlayerSpawn();
      expect(result).toEqual({ x: 256, y: 320 });
    });

    it('returns the left-of-everything floor fallback when no player_spawn exists', () => {
      const scene = new GameScene();
      scene.map = {
        tileWidth: 16,
        tileHeight: 16,
        widthInPixels: 928,
        heightInPixels: 240,
        getObjectLayer: vi.fn((name) =>
          name === 'Object Layer 1'
            ? { objects: [{ name: 'hotspot_1', type: 'memory_hotspot', x: 100, y: 200 }] }
            : null
        )
      };

      const result = scene._findPlayerSpawn();
      // One tile in from the left, feet on a floor row near the bottom (in bounds).
      expect(result).toEqual({ x: 16, y: 224 });
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.x).toBeLessThan(928);
      expect(result.y).toBeGreaterThan(0);
      expect(result.y).toBeLessThanOrEqual(240);
    });

    it('returns the floor fallback when the object layer is missing', () => {
      const scene = new GameScene();
      scene.map = {
        tileWidth: 16,
        tileHeight: 16,
        widthInPixels: 928,
        heightInPixels: 240,
        getObjectLayer: vi.fn().mockReturnValue(null)
      };

      const result = scene._findPlayerSpawn();
      expect(result).toEqual({ x: 16, y: 224 });
    });

    it('returns a safe fallback when map is null', () => {
      const scene = new GameScene();
      scene.map = null;

      const result = scene._findPlayerSpawn();
      // With no map, defaults apply: tileW=16, tileH=16, heightPx=32 → (16, 16).
      expect(result).toEqual({ x: 16, y: 16 });
    });
  });
});
