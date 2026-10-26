import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: wall-paintings, Property 11: No events from paintings
// **Validates: Requirements 7.1, 7.2**
//
// For player paths that overlap ONLY `painting` objects (overlapping no `memory_zone`),
// no `hotspot-activated` event is emitted and the player does not freeze. Freezing is
// GameScene's reaction to a `hotspot-activated` emit, so "no emit" ⇒ "no freeze".
//
// This composes the real `InteractionManager` with a segment built by
// `GameScene._buildSegment` whose `Object Layer 1` contains only `painting` objects:
// the type partition yields zero zones, so even with E pressed while overlapping the
// painting sprites, the manager finds no zone and emits nothing.

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config && config.key;
    }
  }
}));
vi.mock('../PlayerController.js', () => ({ default: class { constructor() {} } }));
vi.mock('../SegmentManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../PromptLabel.js', () => ({ default: class { constructor() {} } }));
// NOTE: InteractionManager is NOT mocked — this property uses the real one.

import GameScene from '../GameScene.js';
import InteractionManager from '../InteractionManager.js';

function rawHallwayJson() {
  return {
    layers: [
      { type: 'tilelayer', name: 'Tile Layer 1', width: 3, height: 1, data: [0, 0, 0] },
      { type: 'tilelayer', name: 'Tile Layer 2', width: 3, height: 1, data: [0, 0, 0] }
    ],
    tilesets: [
      { name: 'museum_tileset', firstgid: 1, tiles: [] },
      { name: 'museum_decor', firstgid: 41, tiles: [] }
    ]
  };
}

/**
 * Build a GameScene wired for the painting pass, plus a REAL InteractionManager whose
 * E-key state and overlap predicate are controllable. `physics.overlap` returns true
 * for every created painting sprite (the player is "standing on" a painting), so the
 * test proves that even full overlap of paintings never activates.
 *
 * @param {object[]} objects  the hallway Object Layer 1 objects (paintings only here)
 * @param {{down: boolean}} keyState  mutable E-key state
 */
function makeScene(objects, keyState) {
  const scene = new GameScene();
  const paintingSprites = new Set();

  scene.add = {
    image: vi.fn((x, y, key) => {
      const sprite = {
        x, y, key,
        setOrigin: vi.fn().mockReturnThis(),
        setDisplaySize: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setFlipX: vi.fn(),
        setFlipY: vi.fn(),
        destroy: vi.fn()
      };
      paintingSprites.add(sprite);
      return sprite;
    }),
    zone: vi.fn((x, y, w, h) => ({ x, y, width: w, height: h, setOrigin: vi.fn(), destroy: vi.fn() }))
  };

  scene.textures = { exists: vi.fn().mockReturnValue(true) };
  scene.map = { tileWidth: 16, tileHeight: 16 };
  scene.tilesetMain = { firstgid: 1, image: { key: 'museum_tileset' } };
  scene.tilesetDecor = { firstgid: 41, image: { key: 'museum_decor' } };
  scene.sortGroup = { add: vi.fn(), remove: vi.fn() };
  scene.collisionBuilder = { buildForLayer: vi.fn().mockReturnValue([]) };

  // Overlap returns true for any painting sprite the manager checks (there are none,
  // since paintings are not zones), and the E key reads from keyState.
  scene.physics = {
    add: { existing: vi.fn() },
    overlap: vi.fn((_player, target) => paintingSprites.has(target))
  };
  scene.input = {
    keyboard: {
      addKey: vi.fn(() => ({
        get isDown() {
          return keyState.down;
        }
      }))
    }
  };

  scene.hallwayMap = {
    getObjectLayer: vi.fn((name) => (name === 'Object Layer 1' ? { objects } : null))
  };
  scene.cache = {
    tilemap: {
      get: vi.fn((key) => (key === 'museum_hallway' ? { format: 1, data: rawHallwayJson() } : null))
    }
  };
  scene.rawTilesetMain = scene._getRawTileset('museum_hallway', 'museum_tileset');
  scene.rawTilesetDecor = scene._getRawTileset('museum_hallway', 'museum_decor');

  return { scene };
}

/** Six painting rectangles (no memory_zone objects at all). */
function paintingsOnly() {
  const xs = [52, 212, 372, 516, 676, 836];
  return xs.map((x, i) => ({ type: 'painting', x, y: 150, id: 20 + i, width: 40, height: 24 }));
}

const player = { x: 100, y: 176 };

describe('Property 11: No events from paintings', () => {
  /**
   * For any sequence of per-frame E states while the player overlaps only paintings,
   * the real InteractionManager emits NO `hotspot-activated` (there are zero zones),
   * and therefore never triggers the freeze/lock path.
   * **Validates: Requirements 7.1, 7.2**
   */
  it('emits no hotspot-activated and never locks for a painting-only segment', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), (frames) => {
        const keyState = { down: false };
        const { scene } = makeScene(paintingsOnly(), keyState);

        const emit = vi.fn();
        const eventBus = { on: vi.fn(), off: vi.fn(), emit };
        const mgr = new InteractionManager(scene, eventBus);

        // Build the painting-only segment and register its (zero) zones.
        const segment = scene._buildSegment(0, 928);
        expect(segment.zones).toHaveLength(0);
        expect(segment.paintingSprites).toHaveLength(6);
        mgr.addZones(segment.zones);

        // Player never overlaps a zone (there are none), though it "stands on" paintings.
        expect(mgr.isPlayerOverlappingZone(player)).toBe(false);

        // Drive the E key frame-by-frame.
        for (const down of frames) {
          keyState.down = down;
          mgr.checkInteraction(player);
        }

        // No activation ever fired, so no freeze/lock was ever requested.
        expect(emit).not.toHaveBeenCalled();
        expect(mgr._locked).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
