import { describe, it, expect, vi } from 'vitest';

/**
 * GameScene.paintings.test.js — example-based tests for the painting render pass and
 * release in `GameScene._buildSegment` / `_releaseSegment`.
 *
 * Phaser is mocked at module level (jsdom has no Canvas/WebGL) and the heavy subsystem
 * modules are stubbed, mirroring `GameScene.segmentFloor.test.js`. These tests drive
 * `_buildSegment` directly with a raw-JSON hallway cache and an `Object Layer 1` that
 * mixes `memory_zone`, `painting`, and an unrecognized-type object.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 2.3, 2.4, 4.2, 4.5, 4.6, 5.2
 */

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

/** A hallway raw JSON with empty tile layers (floor/decor not under test here). */
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

/** Six memory_zone rectangle objects at the authored frame left edges (48×24). */
function sixMemoryZones() {
  const xs = [48, 208, 368, 512, 672, 832];
  return xs.map((x, i) => ({ type: 'memory_zone', x, y: 176, id: 10 + i, width: 48, height: 24 }));
}

/** Six painting rectangles, one per frame, sized to the frame inner area. */
function sixPaintings() {
  const xs = [52, 212, 372, 516, 676, 836];
  return xs.map((x, i) => ({ type: 'painting', x, y: 150, id: 20 + i, width: 40, height: 24 }));
}

/**
 * Build a GameScene wired so `_buildSegment` runs the painting pass: a recording
 * `add.image`, a texture cache (default: all keys present), a mock InteractionManager
 * recording `addZones`/`removeZones`, and a hallway map whose `Object Layer 1` returns
 * the supplied objects.
 *
 * @param {object[]} objects
 * @param {(key: string) => boolean} [textureExists]
 */
function makeScene(objects, textureExists = () => true) {
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
        body: undefined,
        setOrigin: vi.fn(function (ox, oy) { this.origin = { x: ox, y: oy }; return this; }),
        setDisplaySize: vi.fn(function (w, h) { this.displaySize = { w, h }; return this; }),
        setDepth: vi.fn(function (d) { this.depth = d; return this; }),
        setFlipX: vi.fn(),
        setFlipY: vi.fn(),
        destroy: vi.fn()
      };
      created.push(sprite);
      return sprite;
    }),
    zone: vi.fn((x, y, w, h) => ({ x, y, width: w, height: h, setOrigin: vi.fn(), destroy: vi.fn() }))
  };

  scene.textures = { exists: vi.fn(textureExists) };

  scene.map = { tileWidth: 16, tileHeight: 16 };
  scene.tilesetMain = { firstgid: 1, image: { key: 'museum_tileset' } };
  scene.tilesetDecor = { firstgid: 41, image: { key: 'museum_decor' } };
  scene.sortGroup = { add: vi.fn(), remove: vi.fn() };
  scene.collisionBuilder = { buildForLayer: vi.fn().mockReturnValue([]) };

  // physics.add.zone / existing used by _createZone; record so we can confirm paintings
  // never create a body. _createZone uses add.zone (above) + physics.add.existing.
  scene.physics = { add: { existing: vi.fn() } };

  const registered = [];
  scene.interactionManager = {
    addZones: vi.fn((z) => registered.push(...(z || []))),
    removeZones: vi.fn()
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

  return { scene, created, registered };
}

describe('GameScene._buildSegment painting pass', () => {
  it('builds exactly 6 zones and 6 painting sprites from 6 memory_zone + 6 painting objects', () => {
    const objects = [
      ...sixMemoryZones(),
      ...sixPaintings(),
      // An unrecognized-type object yields neither a zone nor a painting (Req 1.5).
      { type: 'decor', x: 300, y: 100, id: 99, width: 16, height: 16 }
    ];
    const { scene, registered } = makeScene(objects);

    const worldOffsetX = 928;
    const segment = scene._buildSegment(0, worldOffsetX);

    // 6 memory zones registered with the InteractionManager (Req 2.3, 2.4).
    expect(segment.zones).toHaveLength(6);
    expect(scene.interactionManager.addZones).toHaveBeenCalled();
    expect(registered).toHaveLength(6);

    // 6 painting sprites on the segment handle.
    expect(segment.paintingSprites).toHaveLength(6);

    // The unrecognized-type object produced nothing: 6 + 6 accounted for, no 7th of either.
    expect(segment.zones).toHaveLength(6);
    expect(segment.paintingSprites).toHaveLength(6);
  });

  it('sizes each interaction zone from the authored memory_zone rectangle (width/height)', () => {
    const worldOffsetX = 928;
    const { scene } = makeScene([
      { type: 'memory_zone', x: 48, y: 176, id: 10, width: 48, height: 24 }
    ]);

    const segment = scene._buildSegment(0, worldOffsetX);

    expect(segment.zones).toHaveLength(1);
    const { zone } = segment.zones[0];
    // Positioned at the segment world offset, sized to the authored rectangle.
    expect(zone.x).toBe(worldOffsetX + 48);
    expect(zone.y).toBe(176);
    expect(zone.width).toBe(48);
    expect(zone.height).toBe(24);
  });

  it('falls back to the default zone footprint for a sizeless memory_zone object', () => {
    const { scene } = makeScene([
      { type: 'memory_zone', x: 48, y: 176, id: 10, width: 0, height: 0 }
    ]);

    const segment = scene._buildSegment(0, 0);

    expect(segment.zones).toHaveLength(1);
    const { zone } = segment.zones[0];
    // _createZone defaults: ZONE_WIDTH_PX / ZONE_HEIGHT_PX = 48 × 48.
    expect(zone.width).toBe(48);
    expect(zone.height).toBe(48);
  });

  it('renders a painting at worldOffsetX + x, origin (0,0), display size (w,h), depth WALL_DEPTH, no body', () => {
    const { scene, created } = makeScene([
      { type: 'painting', x: 52, y: 150, id: 20, width: 40, height: 24 }
    ]);

    const worldOffsetX = 928;
    const segment = scene._buildSegment(0, worldOffsetX);

    expect(segment.paintingSprites).toHaveLength(1);
    const sprite = segment.paintingSprites[0];
    // The only image created in this run is the painting (tile layers are empty).
    expect(created).toContain(sprite);

    expect(sprite.x).toBe(worldOffsetX + 52);
    expect(sprite.y).toBe(150);
    expect(sprite.origin).toEqual({ x: 0, y: 0 });
    expect(sprite.displaySize).toEqual({ w: 40, h: 24 });
    expect(sprite.depth).toBe(scene.WALL_DEPTH);
    // add.image sprites carry no physics body.
    expect(sprite.body).toBeUndefined();
  });

  it('falls back to the placeholder texture when the resolved key is absent from the cache (Req 5.2)', () => {
    // Texture cache has nothing → the resolved key is treated as missing.
    const { scene } = makeScene(
      [{ type: 'painting', x: 52, y: 150, id: 20, width: 40, height: 24 }],
      () => false
    );

    const segment = scene._buildSegment(0, 928);

    expect(segment.paintingSprites).toHaveLength(1);
    expect(segment.paintingSprites[0].key).toBe(PAINTING_PLACEHOLDER_KEY);
    // Painting fallback is non-fatal.
    expect(scene._loadError).toBe(false);
  });

  it('_releaseSegment destroys every painting sprite it created (Req 4.6)', () => {
    const { scene } = makeScene(sixPaintings());

    const segment = scene._buildSegment(0, 928);
    const paintings = segment.paintingSprites.slice();
    expect(paintings).toHaveLength(6);

    scene._releaseSegment(segment);

    for (const sprite of paintings) {
      expect(sprite.destroy).toHaveBeenCalled();
    }
  });

  it('builds no paintings and no zones when every object is an unrecognized type', () => {
    const { scene } = makeScene([
      { type: 'decor', x: 10, y: 10, id: 1, width: 16, height: 16 },
      { type: '', x: 20, y: 20, id: 2, width: 0, height: 0 },
      { x: 30, y: 30, id: 3 } // no type at all
    ]);

    const segment = scene._buildSegment(0, 928);

    expect(segment.zones).toHaveLength(0);
    expect(segment.paintingSprites).toHaveLength(0);
    expect(scene.interactionManager.addZones).not.toHaveBeenCalled();
  });
});
