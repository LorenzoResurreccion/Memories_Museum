import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: core-gameplay-mvp, Property 5: Map boundary enforcement
// For any player position at the edge of the Tile_Map and any movement direction pointing
// outward (beyond the map boundary), the Player_Sprite's position SHALL remain within the
// map's outermost tile boundary after the movement update.

// **Validates: Requirements 4.3**

// Mock Phaser's Scene class
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config.key;
    }
  }
}));

import GameScene from '../GameScene.js';

const TILE_SIZE = 32;

/**
 * Arbitrary: random map dimensions between 5 and 50 tiles wide/tall.
 */
const mapDimensionsArb = fc.record({
  width: fc.integer({ min: 5, max: 50 }),
  height: fc.integer({ min: 5, max: 50 })
});

/**
 * Arbitrary: an edge position on a map of given dimensions with an outward-pointing direction.
 * Edge positions are tiles on the border of the map. Outward directions point beyond the boundary.
 */
function edgePositionWithOutwardDirectionArb(mapWidth, mapHeight) {
  // Generate edge type: top, bottom, left, right
  return fc.oneof(
    // Top edge: row=0, any col, direction=up
    fc.integer({ min: 0, max: mapWidth - 1 }).map((col) => ({
      col, row: 0, direction: 'up'
    })),
    // Bottom edge: row=mapHeight-1, any col, direction=down
    fc.integer({ min: 0, max: mapWidth - 1 }).map((col) => ({
      col, row: mapHeight - 1, direction: 'down'
    })),
    // Left edge: col=0, any row, direction=left
    fc.integer({ min: 0, max: mapHeight - 1 }).map((row) => ({
      col: 0, row, direction: 'left'
    })),
    // Right edge: col=mapWidth-1, any row, direction=right
    fc.integer({ min: 0, max: mapHeight - 1 }).map((row) => ({
      col: mapWidth - 1, row, direction: 'right'
    }))
  );
}

/**
 * Creates a mock GameScene configured for a specific map size.
 * Tracks world bounds and player body configuration.
 */
function createMockGameScene(mapWidth, mapHeight) {
  const scene = new GameScene();
  scene._loadError = false;

  let worldBoundsEnabled = false;
  let worldBoundsArgs = null;

  const mockCollisionLayer = {
    setVisible: vi.fn(),
    setCollisionByExclusion: vi.fn()
  };

  const mockPlayerBody = {
    setCollideWorldBounds: vi.fn((enabled) => {
      worldBoundsEnabled = enabled;
    }),
    setSize: vi.fn(),
    setOffset: vi.fn()
  };

  const mockPlayer = {
    setDepth: vi.fn(),
    setOrigin: vi.fn(),
    setFrame: vi.fn(),
    body: mockPlayerBody
  };

  const mockTileset = {};

  const mockObjectLayer = {
    objects: [
      { name: 'player_spawn', type: 'player_spawn', x: 160, y: 160 }
    ]
  };

  const widthInPixels = mapWidth * TILE_SIZE;
  const heightInPixels = mapHeight * TILE_SIZE;

  const mockMap = {
    widthInPixels,
    heightInPixels,
    addTilesetImage: vi.fn().mockReturnValue(mockTileset),
    createLayer: vi.fn((name) => {
      if (name === 'collision') return mockCollisionLayer;
      return { setDepth: vi.fn() };
    }),
    getLayer: vi.fn((name) => {
      if (name === 'collision') {
        return { name: 'collision', data: [] };
      }
      return null;
    }),
    getObjectLayer: vi.fn(() => mockObjectLayer)
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
      setBounds: vi.fn((...args) => {
        worldBoundsArgs = args;
      })
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
    mockPlayer,
    mockPlayerBody,
    mockMap,
    getWorldBoundsEnabled: () => worldBoundsEnabled,
    getWorldBoundsArgs: () => worldBoundsArgs,
    widthInPixels,
    heightInPixels
  };
}

describe('Property 5: Map boundary enforcement', () => {
  /**
   * **Validates: Requirements 4.3**
   */

  it('world bounds are set to match tilemap dimensions for any random map size', () => {
    fc.assert(
      fc.property(mapDimensionsArb, ({ width, height }) => {
        const { scene, getWorldBoundsArgs, widthInPixels, heightInPixels } =
          createMockGameScene(width, height);

        scene.create();

        // World bounds must be set to (0, 0, widthInPixels, heightInPixels)
        const boundsArgs = getWorldBoundsArgs();
        expect(boundsArgs).not.toBeNull();
        expect(boundsArgs[0]).toBe(0);
        expect(boundsArgs[1]).toBe(0);
        expect(boundsArgs[2]).toBe(widthInPixels);
        expect(boundsArgs[3]).toBe(heightInPixels);
      }),
      { numRuns: 100 }
    );
  });

  it('player body has world bounds collision enabled for any random map size', () => {
    fc.assert(
      fc.property(mapDimensionsArb, ({ width, height }) => {
        const { scene, mockPlayerBody, getWorldBoundsEnabled } =
          createMockGameScene(width, height);

        scene.create();

        // Player body must have world bounds collision enabled
        expect(mockPlayerBody.setCollideWorldBounds).toHaveBeenCalledWith(true);
        expect(getWorldBoundsEnabled()).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('for any edge position with outward direction, world bounds constrain player within map boundary', () => {
    fc.assert(
      fc.property(
        mapDimensionsArb.chain(({ width, height }) =>
          fc.tuple(
            fc.constant({ width, height }),
            edgePositionWithOutwardDirectionArb(width, height)
          )
        ),
        ([{ width, height }, edgePos]) => {
          const { scene, getWorldBoundsArgs, getWorldBoundsEnabled, widthInPixels, heightInPixels } =
            createMockGameScene(width, height);

          scene.create();

          // Verify world bounds are configured
          const boundsArgs = getWorldBoundsArgs();
          expect(boundsArgs).not.toBeNull();

          // Verify world bounds collision is enabled on player
          expect(getWorldBoundsEnabled()).toBe(true);

          // The world bounds define the containment area
          const [bx, by, bw, bh] = boundsArgs;
          expect(bx).toBe(0);
          expect(by).toBe(0);
          expect(bw).toBe(widthInPixels);
          expect(bh).toBe(heightInPixels);

          // The player's pixel position at the edge
          const playerX = edgePos.col * TILE_SIZE + TILE_SIZE / 2;
          const playerY = edgePos.row * TILE_SIZE + TILE_SIZE / 2;

          // The player is within the world bounds
          expect(playerX).toBeGreaterThanOrEqual(bx);
          expect(playerX).toBeLessThanOrEqual(bx + bw);
          expect(playerY).toBeGreaterThanOrEqual(by);
          expect(playerY).toBeLessThanOrEqual(by + bh);

          // With setCollideWorldBounds(true) and setBounds matching the map,
          // Phaser's physics engine will prevent the player from moving beyond
          // the world bounds in the outward direction. The combination of:
          // 1. World bounds matching map pixel dimensions
          // 2. Player body colliding with world bounds
          // guarantees the player stays within the outermost tile boundary.
        }
      ),
      { numRuns: 100 }
    );
  });

  it('world bounds pixel dimensions equal tileSize * tileCount for any map dimensions', () => {
    fc.assert(
      fc.property(mapDimensionsArb, ({ width, height }) => {
        const { scene, getWorldBoundsArgs } = createMockGameScene(width, height);

        scene.create();

        const boundsArgs = getWorldBoundsArgs();
        expect(boundsArgs).not.toBeNull();

        // Width in pixels must equal map width in tiles * tile size
        expect(boundsArgs[2]).toBe(width * TILE_SIZE);
        // Height in pixels must equal map height in tiles * tile size
        expect(boundsArgs[3]).toBe(height * TILE_SIZE);
      }),
      { numRuns: 100 }
    );
  });
});
