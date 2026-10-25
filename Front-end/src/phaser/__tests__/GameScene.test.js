import { describe, it, expect, vi } from 'vitest';

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
    }
    update() {}
    freeze() { this._frozen = true; }
    unfreeze() { this._frozen = false; }
  }
}));

import GameScene from '../GameScene.js';

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

      // Should load tilemap JSON
      expect(tilemapTiledJSONMock).toHaveBeenCalledWith(
        'madison-map',
        'assets/maps/madison-map.json'
      );

      // Should load the combined location tileset image
      expect(imageMock).toHaveBeenCalledWith(
        'madison',
        'assets/tilesets/madison.png'
      );

      // Should load player spritesheet
      expect(spritesheetMock).toHaveBeenCalledWith(
        'player',
        'assets/sprites/Renzo_Sprite.png',
        { frameWidth: 16, frameHeight: 32 }
      );

      // Should start a 10s timeout timer
      expect(scene.time.delayedCall).toHaveBeenCalledWith(
        10000,
        expect.any(Function)
      );
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
      errorHandler({ type: 'tilemapJSON', key: 'madison-map' });

      expect(scene._loadError).toBe(true);
      expect(scene._errorMessage).toBe('Error: Map could not be loaded');
    });

    it('sets error message for tileset image load failure', () => {
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
      errorHandler({ type: 'image', key: 'madison' });

      expect(scene._loadError).toBe(true);
      expect(scene._errorMessage).toBe('Error: Missing tileset: madison');
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

    it('builds map layers and spawns player when assets load successfully', () => {
      const scene = new GameScene();
      scene._loadError = false;

      // Mock textures
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const mockCollisionLayer = {
        setVisible: vi.fn(),
        setCollisionByExclusion: vi.fn(),
        setDepth: vi.fn()
      };
      const mockGroundLayer = { setDepth: vi.fn() };
      const mockWallsLayer = { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
      const mockPropsLayer = { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
      const mockForegroundLayer = { setDepth: vi.fn() };
      const mockTileset = { firstgid: 1, image: { key: 'madison' } };

      const mockObjectLayer = {
        objects: [
          { name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }
        ]
      };

      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        addTilesetImage: vi.fn().mockReturnValue(mockTileset),
        createLayer: vi.fn((name) => {
          if (name === 'ground') return mockGroundLayer;
          if (name === 'buildings') return mockWallsLayer;
          if (name === 'props') return mockPropsLayer;
          if (name === 'collision') return mockCollisionLayer;
          if (name === 'foreground') return mockForegroundLayer;
          return null;
        }),
        getLayer: vi.fn().mockReturnValue({ name: 'collision' }),
        getObjectLayer: vi.fn().mockReturnValue(mockObjectLayer),
        widthInPixels: 640,
        heightInPixels: 640
      };

      scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };

      // Mock physics
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

      scene.physics = {
        add: {
          sprite: vi.fn().mockReturnValue(mockPlayerSprite),
          collider: vi.fn()
        },
        world: {
          setBounds: vi.fn()
        }
      };

      // Mock input
      const mockCursors = { up: {}, down: {}, left: {}, right: {} };
      const mockAddKey = vi.fn().mockReturnValue({ isDown: false });
      scene.input = {
        keyboard: {
          createCursorKeys: vi.fn().mockReturnValue(mockCursors),
          addKey: mockAddKey,
          on: vi.fn()
        }
      };

      // Mock cameras
      scene.cameras = {
        main: {
          width: 800,
          height: 600,
          setZoom: vi.fn(),
          setBounds: vi.fn(),
          startFollow: vi.fn()
        }
      };

      // Mock display list: group for depth sorting + image factory for tiles
      const mockGroup = { add: vi.fn(), getChildren: vi.fn().mockReturnValue([]) };
      scene.add = {
        group: vi.fn().mockReturnValue(mockGroup),
        image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() })
      };

      scene.create();

      // Map should be built
      expect(scene.map).toBe(mockMap);
      expect(scene.groundLayer).toBe(mockGroundLayer);
      expect(scene.wallsLayer).toBe(mockWallsLayer);
      expect(scene.propsLayer).toBe(mockPropsLayer);
      expect(scene.collisionLayer).toBe(mockCollisionLayer);
      expect(scene.foregroundLayer).toBe(mockForegroundLayer);

      // Collision layer configured
      expect(mockCollisionLayer.setVisible).toHaveBeenCalledWith(false);
      expect(mockCollisionLayer.setCollisionByExclusion).toHaveBeenCalledWith([-1, 0]);

      // Player spawned at spawn point coordinates
      expect(scene.physics.add.sprite).toHaveBeenCalledWith(160, 160, 'player', 0);
      // Origin moved to the feet (bottom-center) for correct Y-depth sorting
      expect(mockPlayerSprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
      // Player added to the depth-sort group
      expect(mockGroup.add).toHaveBeenCalledWith(mockPlayerSprite);
      expect(mockPlayerSprite.setFrame).toHaveBeenCalledWith(0);
      expect(mockBody.setCollideWorldBounds).toHaveBeenCalledWith(true);

      // Overhead (foreground) layer pinned to a fixed high depth
      expect(mockForegroundLayer.setDepth).toHaveBeenCalledWith(scene.OVERHEAD_DEPTH);

      // World bounds set to map size
      expect(scene.physics.world.setBounds).toHaveBeenCalledWith(0, 0, 640, 640);

      // Collider between player and collision layer
      expect(scene.physics.add.collider).toHaveBeenCalledWith(mockPlayerSprite, mockCollisionLayer);

      // Input created
      expect(scene.input.keyboard.createCursorKeys).toHaveBeenCalled();
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('W');
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('S');
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('A');
      expect(scene.input.keyboard.addKey).toHaveBeenCalledWith('D');

      // PlayerController instantiated
      expect(scene.playerController).not.toBeNull();
      expect(scene.player).toBe(mockPlayerSprite);
      expect(scene.cursors).toBe(mockCursors);
    });

    it('spawns player at tile (0,0) fallback when no player_spawn exists', () => {
      const scene = new GameScene();
      scene._loadError = false;
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const mockCollisionLayer = {
        setVisible: vi.fn(),
        setCollisionByExclusion: vi.fn()
      };
      const mockForegroundLayer = { setDepth: vi.fn() };
      const mockTileset = { firstgid: 1, image: { key: 'madison' } };

      // Objects layer with no player_spawn
      const mockObjectLayer = {
        objects: [
          { name: 'hotspot_1', type: 'memory_hotspot', x: 320, y: 256 }
        ]
      };

      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        addTilesetImage: vi.fn().mockReturnValue(mockTileset),
        createLayer: vi.fn((name) => {
          if (name === 'collision') return mockCollisionLayer;
          if (name === 'foreground') return mockForegroundLayer;
          return { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
        }),
        getLayer: vi.fn().mockReturnValue({ name: 'collision' }),
        getObjectLayer: vi.fn().mockReturnValue(mockObjectLayer),
        widthInPixels: 640,
        heightInPixels: 640
      };

      scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };

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

      scene.physics = {
        add: {
          sprite: vi.fn().mockReturnValue(mockPlayerSprite),
          collider: vi.fn()
        },
        world: { setBounds: vi.fn() }
      };

      scene.input = {
        keyboard: {
          createCursorKeys: vi.fn().mockReturnValue({}),
          addKey: vi.fn().mockReturnValue({ isDown: false }),
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

      scene.add = {
        group: vi.fn().mockReturnValue({ add: vi.fn(), getChildren: vi.fn().mockReturnValue([]) }),
        image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() })
      };

      scene.create();

      // Player should spawn at center of tile (0,0) = (16, 16)
      expect(scene.physics.add.sprite).toHaveBeenCalledWith(16, 16, 'player', 0);
    });

    it('spawns player at fallback when objects layer is missing', () => {
      const scene = new GameScene();
      scene._loadError = false;
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const mockTileset = { firstgid: 1, image: { key: 'madison' } };
      const mockForegroundLayer = { setDepth: vi.fn() };

      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        addTilesetImage: vi.fn().mockReturnValue(mockTileset),
        createLayer: vi.fn((name) => {
          if (name === 'foreground') return mockForegroundLayer;
          return { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
        }),
        getLayer: vi.fn().mockReturnValue(null),
        getObjectLayer: vi.fn().mockReturnValue(null),
        widthInPixels: 640,
        heightInPixels: 640
      };

      scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };

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

      scene.physics = {
        add: {
          sprite: vi.fn().mockReturnValue(mockPlayerSprite),
          collider: vi.fn()
        },
        world: { setBounds: vi.fn() }
      };

      scene.input = {
        keyboard: {
          createCursorKeys: vi.fn().mockReturnValue({}),
          addKey: vi.fn().mockReturnValue({ isDown: false }),
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

      scene.add = {
        group: vi.fn().mockReturnValue({ add: vi.fn(), getChildren: vi.fn().mockReturnValue([]) }),
        image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() })
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      scene.create();

      // Player should spawn at fallback (16, 16)
      expect(scene.physics.add.sprite).toHaveBeenCalledWith(16, 16, 'player', 0);

      warnSpy.mockRestore();
    });

    it('handles missing collision layer gracefully', () => {
      const scene = new GameScene();
      scene._loadError = false;
      scene.textures = { exists: vi.fn().mockReturnValue(true) };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mockTileset = { firstgid: 1, image: { key: 'madison' } };
      const mockForegroundLayer = { setDepth: vi.fn() };

      const mockObjectLayer = {
        objects: [{ name: 'player_spawn', type: 'player_spawn', x: 100, y: 100 }]
      };

      const mockMap = {
        tileWidth: 16,
        tileHeight: 16,
        addTilesetImage: vi.fn().mockReturnValue(mockTileset),
        createLayer: vi.fn((name) => {
          if (name === 'foreground') return mockForegroundLayer;
          return { setDepth: vi.fn(), setVisible: vi.fn(), forEachTile: vi.fn() };
        }),
        getLayer: vi.fn().mockReturnValue(null), // No collision layer
        getObjectLayer: vi.fn().mockReturnValue(mockObjectLayer),
        widthInPixels: 640,
        heightInPixels: 640
      };

      scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };

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

      scene.physics = {
        add: {
          sprite: vi.fn().mockReturnValue(mockPlayerSprite),
          collider: vi.fn()
        },
        world: { setBounds: vi.fn() }
      };

      scene.input = {
        keyboard: {
          createCursorKeys: vi.fn().mockReturnValue({}),
          addKey: vi.fn().mockReturnValue({ isDown: false }),
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

      scene.add = {
        group: vi.fn().mockReturnValue({ add: vi.fn(), getChildren: vi.fn().mockReturnValue([]) }),
        image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() })
      };

      scene.create();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No collision layer found')
      );
      expect(scene.collisionLayer).toBeNull();
      // collider should NOT be called when no collision layer
      expect(scene.physics.add.collider).not.toHaveBeenCalled();

      warnSpy.mockRestore();
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
  });

  describe('_findPlayerSpawn()', () => {
    it('returns spawn coordinates from objects layer', () => {
      const scene = new GameScene();
      scene.map = {
        getObjectLayer: vi.fn().mockReturnValue({
          objects: [
            { name: 'player_spawn', type: 'player_spawn', x: 256, y: 320 }
          ]
        })
      };

      const result = scene._findPlayerSpawn();
      expect(result).toEqual({ x: 256, y: 320 });
    });

    it('returns fallback (16, 16) when no player_spawn object exists', () => {
      const scene = new GameScene();
      scene.map = {
        getObjectLayer: vi.fn().mockReturnValue({
          objects: [
            { name: 'hotspot_1', type: 'memory_hotspot', x: 100, y: 200 }
          ]
        })
      };

      const result = scene._findPlayerSpawn();
      expect(result).toEqual({ x: 16, y: 16 });
    });

    it('returns fallback when objects layer is missing', () => {
      const scene = new GameScene();
      scene.map = {
        getObjectLayer: vi.fn().mockReturnValue(null)
      };

      const result = scene._findPlayerSpawn();
      expect(result).toEqual({ x: 16, y: 16 });
    });

    it('returns fallback when map is null', () => {
      const scene = new GameScene();
      scene.map = null;

      const result = scene._findPlayerSpawn();
      expect(result).toEqual({ x: 16, y: 16 });
    });
  });
});
