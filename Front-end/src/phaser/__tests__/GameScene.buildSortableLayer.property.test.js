// Feature: infinite-hallway, Property N/A (supporting): Layer2 sprite build honors GID decode
// Over random Tile Layer 2 cells whose raw GID carries an arbitrary subset of the flip bits,
// _buildSortableLayer creates exactly one feet-origin sprite per cell whose masked frame is > 0
// (and none when masked frame <= 0), keys every sprite by the real tileset image (never
// "madison"), and applies setFlipX/setFlipY exactly matching the horizontal/vertical flip bits
// while treating a diagonal bit as a no-op warning. This exercises the sprite-build behavior that
// consumes gidDecode; the pure decode helper itself is covered by GameScene.gidDecode.property.test.js.

// **Validates: Requirements 7.1, 7.2, 7.7**

import { describe, it, expect, vi } from 'vitest';

// Mock Phaser's Scene class before importing GameScene (module-level, matching the suite style).
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config.key;
    }
  }
}));

// GameScene.create() imports these, but this test only drives _buildSortableLayer directly;
// mock them at module level so importing GameScene stays cheap and isolated.
vi.mock('../PlayerController.js', () => ({ default: class {} }));
vi.mock('../CollisionBuilder.js', () => ({ default: class {} }));
vi.mock('../SegmentManager.js', () => ({ default: class {} }));
vi.mock('../InteractionManager.js', () => ({ default: class {} }));
vi.mock('../PromptLabel.js', () => ({ default: class {} }));

import fc from 'fast-check';
import GameScene from '../GameScene.js';

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

/**
 * Build a scene whose createLayer returns a mock layer replaying `tiles` through
 * forEachTile, and capture every sprite handed to add.image.
 */
function makeScene(tiles) {
  const scene = new GameScene();

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

  return { scene, created };
}

describe('Supporting property: _buildSortableLayer honors GID decode', () => {
  it('creates one flipped, correctly-keyed sprite per non-empty cell and none for masked-empty cells', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    fc.assert(
      fc.property(
        // A list of cells: each has a base local id (may be 0 → masked-empty) and a flip-bit subset.
        fc.array(
          fc.record({
            baseId: fc.integer({ min: 0, max: 100 }),
            flipH: fc.boolean(),
            flipV: fc.boolean(),
            flipD: fc.boolean()
          }),
          { minLength: 0, maxLength: 20 }
        ),
        fc.constantFrom(
          { firstgid: 1, image: { key: 'museum_tileset' } },
          { firstgid: 41, image: { key: 'museum_decor' } }
        ),
        (cells, tileset) => {
          const tiles = cells.map((c, i) => {
            let gid = c.baseId; // masked frame equals baseId (all < 0x1FFFFFFF)
            if (c.flipH) gid |= FLIP_H;
            if (c.flipV) gid |= FLIP_V;
            if (c.flipD) gid |= FLIP_D;
            // Force the gid into a signed 32-bit int the way Phaser stores tile.index.
            return { index: gid | 0, pixelX: i * 16, pixelY: 0 };
          });

          const { scene, created } = makeScene(tiles);
          scene._buildSortableLayer('buildings', tileset);

          // Expected non-empty cells: masked frame (baseId) must be strictly > 0.
          const nonEmpty = cells.filter((c) => c.baseId > 0);

          expect(created).toHaveLength(nonEmpty.length);
          expect(scene.sortGroup.add).toHaveBeenCalledTimes(nonEmpty.length);

          created.forEach((sprite, k) => {
            const cell = nonEmpty[k];
            // Keyed by the real tileset image — never the legacy "madison" fallback.
            expect(sprite.key).toBe(tileset.image.key);
            expect(String(sprite.key)).not.toMatch(/madison/i);
            // Local frame = masked id - firstgid.
            expect(sprite.frame).toBe(cell.baseId - tileset.firstgid);
            // Feet origin and feet-aligned world Y.
            expect(sprite.setOrigin).toHaveBeenCalledWith(0.5, 1);
            expect(sprite.y).toBe(16);
            // Flips mirror exactly the H/V bits; the diagonal bit never flips.
            expect(sprite._flipX).toBe(cell.flipH);
            expect(sprite._flipY).toBe(cell.flipV);
          });
        }
      ),
      { numRuns: 100 }
    );

    warnSpy.mockRestore();
  });
});
