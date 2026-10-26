import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: wall-paintings, Property 7: Full bounds coverage
// **Validates: Requirements 4.2, 4.4**
//
// Feature: wall-paintings, Property 8: Wall depth ordering
// **Validates: Requirements 4.4**
//
// Feature: wall-paintings, Property 9: Non-collidable
// **Validates: Requirements 4.5**
//
// Feature: wall-paintings, Property 10: Graceful image fallback
// **Validates: Requirements 5.2, 5.4**
//
// These exercise `GameScene._createPaintingSprite` and the `WALL_DEPTH` constant with
// Phaser mocked at module level (jsdom has no Canvas/WebGL). The subsystem modules are
// stubbed so importing GameScene stays cheap.

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config && config.key;
    }
  }
}));
vi.mock('../PlayerController.js', () => ({ default: class { constructor() {} } }));
vi.mock('../SegmentManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../InteractionManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../PromptLabel.js', () => ({ default: class { constructor() {} } }));

import GameScene from '../GameScene.js';
import { PAINTING_PLACEHOLDER_KEY } from '../../data/paintings.js';

/**
 * Build a GameScene with a recording `add.image`, a texture cache whose membership is
 * controlled per-test, and a `physics.add` whose every method is a spy so we can assert
 * it is NEVER used to create a painting. The created sprites record their origin,
 * display size, and depth.
 *
 * @param {(key: string) => boolean} textureExists
 */
function makeScene(textureExists = () => true) {
  const scene = new GameScene();
  const created = [];

  scene.add = {
    image: vi.fn((x, y, key) => {
      const sprite = {
        x,
        y,
        key,
        origin: null,
        displaySize: null,
        depth: null,
        setOrigin: vi.fn(function (ox, oy) {
          this.origin = { x: ox, y: oy };
          return this;
        }),
        setDisplaySize: vi.fn(function (w, h) {
          this.displaySize = { w, h };
          return this;
        }),
        setDepth: vi.fn(function (d) {
          this.depth = d;
          return this;
        })
      };
      created.push(sprite);
      return sprite;
    })
  };

  scene.textures = { exists: vi.fn(textureExists) };

  // Every physics.add factory is a spy — a painting must touch NONE of them (Req 4.5).
  const physicsAdd = {
    image: vi.fn(),
    sprite: vi.fn(),
    existing: vi.fn(),
    staticImage: vi.fn(),
    staticSprite: vi.fn(),
    group: vi.fn(),
    staticGroup: vi.fn()
  };
  scene.physics = { add: physicsAdd };

  return { scene, created, physicsAdd };
}

const dims = fc.record({
  worldX: fc.integer({ min: -2000, max: 4000 }),
  worldY: fc.integer({ min: 0, max: 240 }),
  width: fc.integer({ min: 1, max: 256 }),
  height: fc.integer({ min: 1, max: 256 })
});

describe('GameScene._createPaintingSprite', () => {
  /**
   * Property 7: Full bounds coverage — for positive width/height, the sprite has
   * top-left origin (0,0), display size exactly (width, height), and depth WALL_DEPTH,
   * so it fully covers the authored bounds with no gaps.
   * **Validates: Requirements 4.2, 4.4**
   */
  it('Property 7: sets origin (0,0), display size (w,h), and depth WALL_DEPTH', () => {
    fc.assert(
      fc.property(dims, ({ worldX, worldY, width, height }) => {
        const { scene, created } = makeScene(() => true);
        const sprite = scene._createPaintingSprite(worldX, worldY, width, height, 'painting_x');

        expect(created).toHaveLength(1);
        expect(sprite).toBe(created[0]);
        expect(sprite.x).toBe(worldX);
        expect(sprite.y).toBe(worldY);
        expect(sprite.origin).toEqual({ x: 0, y: 0 });
        expect(sprite.displaySize).toEqual({ w: width, h: height });
        expect(sprite.depth).toBe(scene.WALL_DEPTH);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 8: Wall depth ordering — WALL_DEPTH is strictly greater than FLOOR_DEPTH
   * and strictly less than every positive feet-Y actor depth (the Y-sort band). Any
   * on-screen actor stands on the floor band (feet Y well above a single-digit value),
   * so WALL_DEPTH < feetY for all generated feet-Y in that band.
   * **Validates: Requirements 4.4**
   */
  it('Property 8: WALL_DEPTH is above FLOOR_DEPTH and below every actor feet-Y depth', () => {
    const { scene } = makeScene();
    expect(scene.WALL_DEPTH).toBeGreaterThan(scene.FLOOR_DEPTH);

    fc.assert(
      // Actor feet world Y across the walkable floor band (dozens of px down to the
      // bottom of the 240px-tall map). Depth of a Y-sort member equals its feet world Y.
      fc.property(fc.integer({ min: 16, max: 240 }), (feetY) => {
        expect(scene.WALL_DEPTH).toBeLessThan(feetY);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9: Non-collidable — creating a painting uses `this.add.image` and never
   * any `this.physics.add.*` factory, so no physics body is created and no movement
   * path is blocked.
   * **Validates: Requirements 4.5**
   */
  it('Property 9: creates no physics body (never calls physics.add.*)', () => {
    fc.assert(
      fc.property(dims, ({ worldX, worldY, width, height }) => {
        const { scene, physicsAdd } = makeScene(() => true);
        scene._createPaintingSprite(worldX, worldY, width, height, 'painting_x');

        for (const factory of Object.values(physicsAdd)) {
          expect(factory).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 10: Graceful image fallback — when the requested key is absent from the
   * texture cache, the sprite is still created, keyed with PAINTING_PLACEHOLDER_KEY,
   * and the scene-level `_loadError` is never set.
   * **Validates: Requirements 5.2, 5.4**
   */
  it('Property 10: substitutes the placeholder for an absent key, never sets _loadError', () => {
    fc.assert(
      fc.property(dims, fc.string(), ({ worldX, worldY, width, height }, missingKey) => {
        // Texture cache has NOTHING → every requested key is treated as absent.
        const { scene, created } = makeScene(() => false);
        const sprite = scene._createPaintingSprite(worldX, worldY, width, height, missingKey);

        expect(created).toHaveLength(1);
        expect(sprite.key).toBe(PAINTING_PLACEHOLDER_KEY);
        expect(scene._loadError).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
