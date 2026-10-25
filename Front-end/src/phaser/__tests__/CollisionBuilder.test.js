import { describe, it, expect, vi } from 'vitest';

// Feature: infinite-hallway — example tests for CollisionBuilder.
//
// Concrete, hand-picked examples (no fast-check) that pin down the per-tile
// collision math against the REAL embedded-tileset shapes the converted maps
// emit, plus the graceful-degradation contract:
//   - museum_tileset id 12  — a (float-coord) RECTANGLE collision shape
//   - museum_tileset id 24  — a POLYGON collision shape (min/max AABB)
//   - museum_decor   id 7   — a POLYGON collision shape (min/max AABB)
//   - a malformed objectgroup — classified floor, no AABB, buildForLayer skips
//     it WITHOUT throwing and CONTINUES building the surrounding tiles.
//
// CollisionBuilder imports no Phaser, so it is imported directly; the pure
// helpers (classifyTile / tileLocalAABB) use `new CollisionBuilder(null, null)`.
// buildForLayer is exercised with a minimal mock static group.
//
// **Validates: Requirements 6.2, 6.3, 6.4, 6.8**

import CollisionBuilder from '../CollisionBuilder.js';

describe('CollisionBuilder — pure classification + AABB (example tests)', () => {
  const builder = new CollisionBuilder(null, null);

  it('museum_tileset id 12 (rectangle, float coords) => collision + float AABB', () => {
    const tileDef = {
      id: 12,
      objectgroup: {
        objects: [{ x: 0, y: 0.0752185, width: 16, height: 15.9248 }]
      }
    };

    expect(builder.classifyTile(tileDef)).toBe('collision');

    const aabb = builder.tileLocalAABB(tileDef);
    expect(aabb).not.toBeNull();
    expect(aabb.x).toBeCloseTo(0, 5);
    expect(aabb.y).toBeCloseTo(0.0752185, 5);
    expect(aabb.width).toBeCloseTo(16, 5);
    expect(aabb.height).toBeCloseTo(15.9248, 5);
  });

  it('museum_tileset id 24 (polygon) => collision + min/max AABB', () => {
    const tileDef = {
      id: 24,
      objectgroup: {
        objects: [
          {
            x: 3,
            y: 0,
            polygon: [
              { x: 0, y: 0 },
              { x: 0, y: 1 },
              { x: -1, y: 1 },
              { x: -1, y: 3 },
              { x: 0, y: 4 },
              { x: 1, y: 5 },
              { x: 1, y: 16 },
              { x: 5, y: 16 },
              { x: 5, y: 13 },
              { x: 4, y: 9 },
              { x: 3, y: 5 },
              { x: 4, y: 4 },
              { x: 5, y: 3 },
              { x: 5, y: 1 },
              { x: 4, y: 1 },
              { x: 4, y: 0 }
            ]
          }
        ]
      }
    };

    expect(builder.classifyTile(tileDef)).toBe('collision');
    // minX = 3 + (-1) = 2, maxX = 3 + 5 = 8 => width 6; minY = 0, maxY = 16 => height 16.
    expect(builder.tileLocalAABB(tileDef)).toEqual({ x: 2, y: 0, width: 6, height: 16 });
  });

  it('museum_decor id 7 (polygon) => collision + min/max AABB', () => {
    const tileDef = {
      id: 7,
      objectgroup: {
        objects: [
          {
            x: 3,
            y: 0,
            polygon: [
              { x: 0, y: 0 },
              { x: 0, y: 16 },
              { x: 10, y: 16 },
              { x: 10, y: 0 }
            ]
          }
        ]
      }
    };

    expect(builder.classifyTile(tileDef)).toBe('collision');
    // minX = 3 + 0 = 3, maxX = 3 + 10 = 13 => width 10; minY = 0, maxY = 16 => height 16.
    expect(builder.tileLocalAABB(tileDef)).toEqual({ x: 3, y: 0, width: 10, height: 16 });
  });

  it('malformed objectgroup => floor, null AABB (no throw)', () => {
    const malformed = { id: 99, objectgroup: { objects: [{ foo: 'bar' }] } };

    expect(builder.classifyTile(malformed)).toBe('floor');
    expect(builder.tileLocalAABB(malformed)).toBeNull();
  });

  it('tile with no objectgroup => floor, null AABB (no throw)', () => {
    const plain = { id: 1 };

    expect(builder.classifyTile(plain)).toBe('floor');
    expect(builder.tileLocalAABB(plain)).toBeNull();
  });
});

describe('CollisionBuilder.buildForLayer — build continues past malformed tile', () => {
  /**
   * Minimal mock static group: `create(x, y)` returns a fake body exposing the
   * surface CollisionBuilder._createBody touches (setVisible / setSize /
   * setDisplaySize and a nested body with setSize / updateFromGameObject).
   */
  function makeMockGroup() {
    const created = [];
    const group = {
      create: vi.fn((x, y) => {
        const body = {
          x,
          y,
          setVisible: vi.fn(),
          setSize: vi.fn(),
          setDisplaySize: vi.fn(),
          body: {
            setSize: vi.fn(),
            updateFromGameObject: vi.fn()
          }
        };
        created.push(body);
        return body;
      })
    };
    return { group, created };
  }

  it('skips the malformed tile but still builds the two valid collision tiles', () => {
    const { group } = makeMockGroup();
    const builder = new CollisionBuilder(null, group);

    // firstgid 1, so gid = localId + 1.
    // local id 12 -> valid rectangle collision tile (gid 13)
    // local id 99 -> malformed objectgroup (gid 100)
    // local id 24 -> valid polygon collision tile (gid 25)
    const tileset = {
      firstgid: 1,
      tiles: [
        {
          id: 12,
          objectgroup: { objects: [{ x: 0, y: 0, width: 16, height: 16 }] }
        },
        {
          id: 99,
          objectgroup: { objects: [{ foo: 'bar' }] }
        },
        {
          id: 24,
          objectgroup: {
            objects: [
              {
                x: 0,
                y: 0,
                polygon: [
                  { x: 0, y: 0 },
                  { x: 8, y: 0 },
                  { x: 8, y: 16 },
                  { x: 0, y: 16 }
                ]
              }
            ]
          }
        }
      ]
    };

    const layer = { data: [13, 100, 25], width: 3, height: 1 };

    let bodies;
    expect(() => {
      bodies = builder.buildForLayer(layer, tileset, 0);
    }).not.toThrow();

    // Exactly two bodies: the malformed middle tile is skipped, build continues.
    expect(bodies).toHaveLength(2);
    expect(group.create).toHaveBeenCalledTimes(2);

    // Each created body was made invisible and sized to its AABB.
    for (const body of bodies) {
      expect(body.setVisible).toHaveBeenCalledWith(false);
      expect(body.setSize).toHaveBeenCalled();
    }
  });
});
