import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: core-gameplay-mvp, Property 4: Collision layer completeness
// For any Tile_Map with a collision layer, every tile marked in the Collision_Layer
// SHALL be configured as impassable, and the Player_Sprite SHALL be unable to enter
// any of those tile positions from any approach direction.

// Mock Phaser's Scene class
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config.key;
    }
  }
}));

// Mock PlayerController to avoid animation setup overhead
vi.mock('../PlayerController.js', () => ({
  default: class MockPlayerController {
    constructor() {}
    update() {}
    freeze() {}
    unfreeze() {}
  }
}));

import GameScene from '../GameScene.js';

/**
 * Helper: generate a 20×20 collision layer data array.
 * Each cell is either 0 (passable/empty) or a positive tile index (collidable).
 */
const collisionLayerDataArb = fc.array(
  fc.integer({ min: 0, max: 10 }), // 0 = empty, 1-10 = collision tile IDs
  { minLength: 400, maxLength: 400 } // 20×20 = 400 tiles
);

/**
 * Creates a mock tilemap with the given collision layer data.
 * Simulates Phaser's tilemap API surface used by GameScene.create().
 */
function createMockScene(collisionData) {
  const scene = new GameScene();
  scene._loadError = false;

  // Track which tile indices were excluded from collision
  let collisionExclusions = null;

  const mockCollisionLayer = {
    setVisible: vi.fn(),
    setCollisionByExclusion: vi.fn((exclusions) => {
      collisionExclusions = exclusions;
    })
  };

  const mockTileset = {};

  const mockObjectLayer = {
    objects: [
      { name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }
    ]
  };

  const mockMap = {
    widthInPixels: 640,
    heightInPixels: 640,
    addTilesetImage: vi.fn().mockReturnValue(mockTileset),
    createLayer: vi.fn((name) => {
      if (name === 'collision') return mockCollisionLayer;
      return { setDepth: vi.fn() };
    }),
    getLayer: vi.fn((name) => {
      if (name === 'collision') {
        return {
          name: 'collision',
          data: collisionData
        };
      }
      return null;
    }),
    getObjectLayer: vi.fn(() => mockObjectLayer)
  };

  const mockPlayer = {
    setDepth: vi.fn(),
    setOrigin: vi.fn(),
    setFrame: vi.fn(),
    body: {
      setCollideWorldBounds: vi.fn(),
      setSize: vi.fn(),
      setOffset: vi.fn()
    }
  };

  scene.make = { tilemap: vi.fn().mockReturnValue(mockMap) };
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
    text: vi.fn().mockReturnValue({ setOrigin: vi.fn() }),
    rectangle: vi.fn(),
    group: vi.fn().mockReturnValue({ add: vi.fn(), getChildren: vi.fn().mockReturnValue([]) }),
    image: vi.fn().mockReturnValue({ setOrigin: vi.fn(), setDepth: vi.fn() })
  };
  scene.physics = {
    add: {
      sprite: vi.fn().mockReturnValue(mockPlayer),
      collider: vi.fn()
    },
    world: {
      setBounds: vi.fn()
    }
  };
  scene.input = {
    keyboard: {
      createCursorKeys: vi.fn().mockReturnValue({}),
      addKey: vi.fn().mockReturnValue({}),
      on: vi.fn()
    }
  };
  scene.textures = {
    exists: vi.fn().mockReturnValue(true)
  };
  scene.anims = {
    exists: vi.fn().mockReturnValue(false),
    create: vi.fn(),
    generateFrameNumbers: vi.fn((key, config) => {
      const frames = [];
      for (let i = config.start; i <= config.end; i++) {
        frames.push({ key, frame: i });
      }
      return frames;
    })
  };

  return {
    scene,
    mockCollisionLayer,
    getExclusions: () => collisionExclusions,
    collisionData
  };
}

describe('Property 4: Collision layer completeness', () => {
  it('all non-zero tiles in the collision layer are configured as impassable', { timeout: 30000 }, () => {
    fc.assert(
      fc.property(collisionLayerDataArb, (collisionData) => {
        const { scene, mockCollisionLayer, getExclusions } = createMockScene(collisionData);

        // Run create()
        scene.create();

        // The collision layer should exist
        expect(scene.collisionLayer).toBe(mockCollisionLayer);

        // setCollisionByExclusion must have been called
        expect(mockCollisionLayer.setCollisionByExclusion).toHaveBeenCalledTimes(1);

        // Get the exclusion list
        const exclusions = getExclusions();
        expect(exclusions).not.toBeNull();

        // Exclusions should be [-1, 0]: only empty/missing tiles are excluded
        // This means ALL positive tile indices are collidable
        expect(exclusions).toEqual([-1, 0]);

        // Verify the property: for every non-zero tile in the collision data,
        // it must NOT be in the exclusion list (meaning it IS collidable)
        const nonZeroTiles = collisionData.filter(tile => tile > 0);
        for (const tileId of nonZeroTiles) {
          expect(exclusions).not.toContain(tileId);
        }

        // Additionally verify: the exclusion list only contains -1 and 0,
        // confirming that the implementation makes ALL positive-indexed tiles impassable
        for (const excluded of exclusions) {
          expect(excluded).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('collision layer is made invisible (data-only)', () => {
    fc.assert(
      fc.property(collisionLayerDataArb, (collisionData) => {
        const { scene, mockCollisionLayer } = createMockScene(collisionData);

        scene.create();

        // Collision layer must be invisible — it's for physics only, not rendering
        expect(mockCollisionLayer.setVisible).toHaveBeenCalledWith(false);
      }),
      { numRuns: 100 }
    );
  });

  it('handles maps where all tiles are collision tiles', { timeout: 30000 }, () => {
    fc.assert(
      fc.property(
        // Generate arrays where every tile is non-zero (fully walled map)
        fc.array(
          fc.integer({ min: 1, max: 10 }),
          { minLength: 400, maxLength: 400 }
        ),
        (collisionData) => {
          const { scene, mockCollisionLayer, getExclusions } = createMockScene(collisionData);

          scene.create();

          const exclusions = getExclusions();
          expect(exclusions).toEqual([-1, 0]);

          // Every tile in the data is non-zero, so every tile is collidable
          for (const tileId of collisionData) {
            expect(tileId).toBeGreaterThan(0);
            expect(exclusions).not.toContain(tileId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles maps where no tiles are collision tiles (all empty)', { timeout: 30000 }, () => {
    fc.assert(
      fc.property(
        // Generate arrays of all zeros (no collision)
        fc.constant(new Array(400).fill(0)),
        (collisionData) => {
          const { scene, mockCollisionLayer, getExclusions } = createMockScene(collisionData);

          scene.create();

          // Even with all-zero data, the exclusion method is still called correctly
          const exclusions = getExclusions();
          expect(exclusions).toEqual([-1, 0]);

          // All tiles are 0, which IS in the exclusion list — so none are collidable
          for (const tileId of collisionData) {
            expect(exclusions).toContain(tileId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
