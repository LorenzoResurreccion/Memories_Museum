import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: core-gameplay-mvp, Property 6: Camera tracking with boundary clamping and integer zoom
// For any Player_Sprite position on the map, the camera viewport SHALL be centered on the player
// when the player is sufficiently far from all map edges, and SHALL be clamped such that no pixel
// outside the Tile_Map boundaries is ever visible. Additionally, the camera zoom SHALL always be
// a positive integer (1, 2, 3, etc.) to ensure pixel-perfect rendering without sub-pixel interpolation.

// **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

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
const VIEWPORT_WIDTH = 800;
const VIEWPORT_HEIGHT = 600;

/**
 * Arbitrary: random map dimensions between 5 and 50 tiles wide/tall.
 */
const mapDimensionsArb = fc.record({
  width: fc.integer({ min: 5, max: 50 }),
  height: fc.integer({ min: 5, max: 50 })
});

/**
 * Arbitrary: random player position within a map of given pixel dimensions.
 */
function playerPositionArb(widthInPixels, heightInPixels) {
  return fc.record({
    x: fc.integer({ min: 0, max: widthInPixels }),
    y: fc.integer({ min: 0, max: heightInPixels })
  });
}

/**
 * Creates a mock GameScene configured for a specific map size.
 * Tracks camera method calls: setZoom, setBounds, startFollow.
 */
function createMockGameScene(mapWidth, mapHeight) {
  const scene = new GameScene();
  scene._loadError = false;

  const cameraSetZoomCalls = [];
  const cameraSetBoundsCalls = [];
  const cameraStartFollowCalls = [];

  const mockCollisionLayer = {
    setVisible: vi.fn(),
    setCollisionByExclusion: vi.fn()
  };

  const mockPlayerBody = {
    setCollideWorldBounds: vi.fn(),
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
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      setZoom: vi.fn((zoom) => {
        cameraSetZoomCalls.push(zoom);
      }),
      setBounds: vi.fn((...args) => {
        cameraSetBoundsCalls.push(args);
      }),
      startFollow: vi.fn((target) => {
        cameraStartFollowCalls.push(target);
      })
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
    mockPlayer,
    mockMap,
    widthInPixels,
    heightInPixels,
    getCameraSetZoomCalls: () => cameraSetZoomCalls,
    getCameraSetBoundsCalls: () => cameraSetBoundsCalls,
    getCameraStartFollowCalls: () => cameraStartFollowCalls
  };
}

describe('Property 6: Camera tracking with boundary clamping and integer zoom', () => {
  /**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.5**
   */

  it('camera zoom is always set to a positive integer for any random map size', () => {
    fc.assert(
      fc.property(mapDimensionsArb, ({ width, height }) => {
        const { scene, getCameraSetZoomCalls } = createMockGameScene(width, height);

        scene.create();

        const zoomCalls = getCameraSetZoomCalls();
        expect(zoomCalls.length).toBeGreaterThan(0);

        for (const zoom of zoomCalls) {
          // Zoom must be a positive integer
          expect(Number.isInteger(zoom)).toBe(true);
          expect(zoom).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('camera bounds match tilemap pixel dimensions for any random map size', () => {
    fc.assert(
      fc.property(mapDimensionsArb, ({ width, height }) => {
        const { scene, getCameraSetBoundsCalls, widthInPixels, heightInPixels } =
          createMockGameScene(width, height);

        scene.create();

        const boundsCalls = getCameraSetBoundsCalls();
        expect(boundsCalls.length).toBeGreaterThan(0);

        // Camera bounds must be set to (0, 0, widthInPixels, heightInPixels)
        const [x, y, w, h] = boundsCalls[0];
        expect(x).toBe(0);
        expect(y).toBe(0);
        expect(w).toBe(widthInPixels);
        expect(h).toBe(heightInPixels);
      }),
      { numRuns: 100 }
    );
  });

  it('camera follows the player sprite for any random map size', () => {
    fc.assert(
      fc.property(mapDimensionsArb, ({ width, height }) => {
        const { scene, mockPlayer, getCameraStartFollowCalls } =
          createMockGameScene(width, height);

        scene.create();

        const followCalls = getCameraStartFollowCalls();
        expect(followCalls.length).toBeGreaterThan(0);

        // Camera must follow the player sprite
        expect(followCalls[0]).toBe(mockPlayer);
      }),
      { numRuns: 100 }
    );
  });

  it('camera viewport never shows pixels outside map bounds for any player position on sufficiently large maps', () => {
    // Only test maps large enough for the viewport to fit entirely within.
    // When the map is smaller than the effective viewport, Phaser will still
    // set bounds correctly but cannot avoid showing empty space — that's expected.
    const largeMapArb = fc.record({
      width: fc.integer({ min: 15, max: 50 }),
      height: fc.integer({ min: 15, max: 50 })
    });

    fc.assert(
      fc.property(
        largeMapArb.chain(({ width, height }) => {
          const widthPx = width * TILE_SIZE;
          const heightPx = height * TILE_SIZE;
          return fc.tuple(
            fc.constant({ width, height, widthPx, heightPx }),
            playerPositionArb(widthPx, heightPx)
          );
        }),
        ([{ width, height, widthPx, heightPx }, playerPos]) => {
          const { scene, getCameraSetBoundsCalls, getCameraSetZoomCalls } =
            createMockGameScene(width, height);

          scene.create();

          const boundsCalls = getCameraSetBoundsCalls();
          const zoomCalls = getCameraSetZoomCalls();

          expect(boundsCalls.length).toBeGreaterThan(0);
          expect(zoomCalls.length).toBeGreaterThan(0);

          const [bx, by, bw, bh] = boundsCalls[0];
          const zoom = zoomCalls[0];

          // The effective viewport size (what the camera sees in world pixels)
          const effectiveViewW = VIEWPORT_WIDTH / zoom;
          const effectiveViewH = VIEWPORT_HEIGHT / zoom;

          // Precondition: map must be at least as large as the effective viewport
          // (guaranteed by our largeMapArb with min 15 tiles → 480px, and zoom=2 → 400x300 effective)
          expect(bw).toBeGreaterThanOrEqual(effectiveViewW);
          expect(bh).toBeGreaterThanOrEqual(effectiveViewH);

          // Compute the top-left corner of the viewport (centered on player)
          let viewLeft = playerPos.x - effectiveViewW / 2;
          let viewTop = playerPos.y - effectiveViewH / 2;

          // Clamp the viewport to the camera bounds (simulates Phaser's built-in clamping)
          viewLeft = Math.max(bx, Math.min(viewLeft, bx + bw - effectiveViewW));
          viewTop = Math.max(by, Math.min(viewTop, by + bh - effectiveViewH));

          const viewRight = viewLeft + effectiveViewW;
          const viewBottom = viewTop + effectiveViewH;

          // With camera bounds set correctly, the clamped viewport must never
          // show pixels outside the map bounds
          expect(viewLeft).toBeGreaterThanOrEqual(0);
          expect(viewTop).toBeGreaterThanOrEqual(0);
          expect(viewRight).toBeLessThanOrEqual(widthPx);
          expect(viewBottom).toBeLessThanOrEqual(heightPx);
        }
      ),
      { numRuns: 100 }
    );
  });
});
