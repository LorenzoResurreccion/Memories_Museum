import { describe, it, expect, vi } from 'vitest';

// Mock Phaser's Scene class before importing GameScene (jsdom has no Canvas/WebGL).
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config && config.key;
    }
  }
}));

// The subsystem modules are not under test here; stub the heavy ones so importing
// GameScene stays cheap and _buildSegment can run with partial mocks.
vi.mock('../PlayerController.js', () => ({ default: class { constructor() {} } }));
vi.mock('../SegmentManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../InteractionManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../PromptLabel.js', () => ({ default: class { constructor() {} } }));

import GameScene from '../GameScene.js';
import CollisionBuilder from '../CollisionBuilder.js';

/**
 * A tiny raw-JSON hallway map: 3 wide × 2 tall. `Tile Layer 1` top row is a wall
 * (frame 13 → main-tileset id 12, which carries a collision rectangle) and bottom row
 * is floor (frame 14 → id 13, no collision). `Tile Layer 2` has one collidable decor
 * tile (frame 48 → decor-tileset id 7, a collision polygon) and empties. Both embedded
 * tilesets carry the Tiled-shaped `tiles: [{ id, objectgroup }]` the collision builder
 * reads. This mirrors the flat-GID + raw-tileset shape the loader caches.
 */
function rawHallwayJson() {
  return {
    layers: [
      {
        type: 'tilelayer',
        name: 'Tile Layer 1',
        width: 3,
        height: 2,
        data: [13, 13, 13, 14, 14, 14]
      },
      {
        type: 'tilelayer',
        name: 'Tile Layer 2',
        width: 3,
        height: 2,
        data: [48, 0, 0, 0, 0, 0]
      }
    ],
    tilesets: [
      {
        name: 'museum_tileset',
        firstgid: 1,
        tiles: [
          // id 12 = wall (GID 13). id 26 = bench_front_left (GID 27) — a main-tileset
          // furniture tile that is placed on Tile Layer 2 in the real hallway map.
          { id: 12, objectgroup: { objects: [{ x: 0, y: 0, width: 16, height: 16 }] } },
          { id: 26, objectgroup: { objects: [{ x: 0, y: 2, width: 16, height: 12 }] } }
        ]
      },
      {
        name: 'museum_decor',
        firstgid: 41,
        tiles: [
          {
            id: 7,
            objectgroup: {
              objects: [{ x: 3, y: 0, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 16 }, { x: 0, y: 16 }] }]
            }
          }
        ]
      }
    ]
  };
}

/**
 * Build a GameScene instance with just enough wiring for _buildSegment to render the
 * floor: a tilemap cache returning raw JSON, an image factory that records calls, a
 * main tileset, a sort group, and a no-op collision builder.
 */
function makeScene() {
  const scene = new GameScene();

  const created = [];
  scene.add = {
    image: vi.fn((x, y, key, frame) => {
      const sprite = {
        x, y, key, frame,
        depth: 0,
        setOrigin: vi.fn(),
        setDepth: vi.fn(function (d) { this.depth = d; return this; }),
        setFlipX: vi.fn(),
        setFlipY: vi.fn(),
        destroy: vi.fn()
      };
      created.push(sprite);
      return sprite;
    })
  };

  scene.map = { tileWidth: 16, tileHeight: 16 };
  scene.tilesetMain = { firstgid: 1, image: { key: 'museum_tileset' } };
  scene.tilesetDecor = { firstgid: 41, image: { key: 'museum_decor' } };
  scene.sortGroup = { add: vi.fn(), remove: vi.fn() };
  scene.collisionBuilder = { buildForLayer: vi.fn().mockReturnValue([]) };
  scene.hallwayMap = {
    getObjectLayer: vi.fn().mockReturnValue(null)
  };

  scene.cache = {
    tilemap: {
      get: vi.fn((key) =>
        key === 'museum_hallway' ? { format: 1, data: rawHallwayJson() } : null
      )
    }
  };

  // `create()` normally sets these raw tilesets; these tests call _buildSegment
  // directly, so wire them from the same raw JSON the cache serves.
  scene.rawTilesetMain = scene._getRawTileset('museum_hallway', 'museum_tileset');
  scene.rawTilesetDecor = scene._getRawTileset('museum_hallway', 'museum_decor');

  return { scene, created };
}

describe('GameScene._buildSegment floor rendering (black-hallway fix)', () => {
  it('draws Tile Layer 1 floor/wall tiles as fixed-depth sprites offset by worldOffsetX', () => {
    const { scene } = makeScene();

    const worldOffsetX = 928;
    const segment = scene._buildSegment(0, worldOffsetX);

    // 3×2 layer, all 6 cells of Tile Layer 1 non-empty → 6 floor sprites on the handle.
    expect(segment).toBeTruthy();
    expect(Array.isArray(segment.floorSprites)).toBe(true);
    expect(segment.floorSprites).toHaveLength(6);

    const floor = segment.floorSprites;

    // Every floor sprite keys off the main tileset and is pinned to FLOOR_DEPTH.
    for (const sprite of floor) {
      expect(sprite.key).toBe('museum_tileset');
      expect(sprite.depth).toBe(scene.FLOOR_DEPTH);
    }

    // First cell is at the segment's world offset (top-left origin, col 0 / row 0).
    expect(floor[0].x).toBe(worldOffsetX);
    expect(floor[0].y).toBe(0);
    // Local frame = GID(13) - firstgid(1) = 12 (a wall tile).
    expect(floor[0].frame).toBe(12);

    // Bottom-row floor cell (index 3): col 0, row 1 → y = 16, frame = 14 - 1 = 13.
    expect(floor[3].x).toBe(worldOffsetX);
    expect(floor[3].y).toBe(16);
    expect(floor[3].frame).toBe(13);
  });

  it('_releaseSegment destroys the floor sprites it created', () => {
    const { scene } = makeScene();
    const segment = scene._buildSegment(0, 928);
    const floor = segment.floorSprites.slice();

    scene._releaseSegment(segment);

    for (const sprite of floor) {
      expect(sprite.destroy).toHaveBeenCalled();
    }
  });

  it('returns no floor sprites when the tilemap cache lacks the hallway map', () => {
    const { scene } = makeScene();
    scene.cache.tilemap.get = vi.fn().mockReturnValue(null);

    const segment = scene._buildSegment(0, 928);

    expect(segment).toBeTruthy();
    expect(segment.floorSprites).toHaveLength(0);
  });
});

describe('GameScene._buildSegment collision from both layers (decor + structural)', () => {
  it('builds collision bodies from Tile Layer 1 AND Tile Layer 2 using the raw tilesets', () => {
    const { scene } = makeScene();

    // A real CollisionBuilder with a mock static group that records created bodies.
    const bodies = [];
    const group = {
      create: vi.fn((x, y) => {
        const body = {
          x, y,
          setVisible: vi.fn(),
          setSize: vi.fn(),
          setDisplaySize: vi.fn(),
          body: { setSize: vi.fn(), updateFromGameObject: vi.fn() },
          destroy: vi.fn()
        };
        bodies.push(body);
        return body;
      })
    };
    scene.collisionBuilder = new CollisionBuilder(scene, group);

    const worldOffsetX = 928;
    const segment = scene._buildSegment(0, worldOffsetX);

    // Three wall tiles on Tile Layer 1 (GID 13 → id 12, collidable) + one decor pillar
    // on Tile Layer 2 (GID 48 → decor id 7, collidable) = 4 collision bodies. The floor
    // row (GID 14 → id 13) has no collision shape and creates nothing.
    expect(bodies).toHaveLength(4);
    expect(segment.collisionBodies).toHaveLength(4);

    // The decor body is offset into the segment's world X (col 0 → centered at
    // worldOffsetX + the polygon's x..x+width midpoint).
    const decorBody = bodies.find((b) => b.x >= worldOffsetX && b.x < worldOffsetX + 16);
    expect(decorBody).toBeTruthy();
  });

  it('builds collision for a MAIN-tileset furniture tile (bench) placed on Tile Layer 2', () => {
    const { scene } = makeScene();

    // Place a bench tile (GID 27 → main-tileset id 26, collidable) on Tile Layer 2 —
    // exactly how the real hallway mixes main-range furniture onto the decor layer.
    const json = rawHallwayJson();
    json.layers[1].data = [27, 0, 0, 0, 0, 0];
    scene.cache.tilemap.get = vi.fn((key) =>
      key === 'museum_hallway' ? { format: 1, data: json } : null
    );
    scene.rawTilesetMain = scene._getRawTileset('museum_hallway', 'museum_tileset');
    scene.rawTilesetDecor = scene._getRawTileset('museum_hallway', 'museum_decor');

    const bodies = [];
    const group = { create: vi.fn((x, y) => { const b = { x, y, setVisible: vi.fn(), setSize: vi.fn(), setDisplaySize: vi.fn(), body: { setSize: vi.fn(), updateFromGameObject: vi.fn() }, destroy: vi.fn() }; bodies.push(b); return b; }) };
    scene.collisionBuilder = new CollisionBuilder(scene, group);

    const segment = scene._buildSegment(0, 928);

    // 3 wall tiles on Tile Layer 1 + 1 bench tile on Tile Layer 2 = 4 collision bodies.
    // Before the both-tilesets fix the bench produced none (decor tileset didn't own it).
    expect(segment.collisionBodies).toHaveLength(4);
  });

  it('builds no decor-layer collision bodies when the decor tile is not collidable', () => {
    const { scene } = makeScene();

    // Swap the decor layer's only collidable tile (48) for a non-collidable one (42).
    const json = rawHallwayJson();
    json.layers[1].data = [42, 0, 0, 0, 0, 0];
    scene.cache.tilemap.get = vi.fn((key) =>
      key === 'museum_hallway' ? { format: 1, data: json } : null
    );

    const bodies = [];
    const group = { create: vi.fn((x, y) => { const b = { x, y, setVisible: vi.fn(), setSize: vi.fn(), setDisplaySize: vi.fn(), body: { setSize: vi.fn(), updateFromGameObject: vi.fn() }, destroy: vi.fn() }; bodies.push(b); return b; }) };
    scene.collisionBuilder = new CollisionBuilder(scene, group);

    const segment = scene._buildSegment(0, 928);

    // Only the 3 structural wall tiles on Tile Layer 1 remain collidable.
    expect(segment.collisionBodies).toHaveLength(3);
  });
});
