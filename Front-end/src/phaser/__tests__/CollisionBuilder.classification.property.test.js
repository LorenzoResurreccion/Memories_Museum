// Feature: infinite-hallway, Property 14: Collision classification + AABB + offset
// **Validates: Requirements 6.2, 6.3, 6.4, 6.7, 6.8**
//
// CollisionBuilder's pure helpers classify an embedded-tileset tile definition and
// compute its tile-local axis-aligned bounding box:
//   - classifyTile(tileDef)  -> 'floor' | 'collision'
//   - tileLocalAABB(tileDef) -> { x, y, width, height } | null
//
// This property exercises four tile-def categories drawn at random:
//   1. no-objectgroup (floor)  -> classify 'floor', AABB null
//   2. rectangle      (collision) -> classify 'collision', AABB = {x, y, width, height}
//   3. polygon        (collision) -> classify 'collision', AABB = min/max of (x+px, y+py)
//   4. malformed      (floor)  -> classify 'floor', AABB null
//
// It also validates the world-offset invariant (Req 6.7): for a collision tile at
// (col,row) with worldOffsetX, the intended body world top-left is
//   worldOffsetX + col*16 + localAABB.x  /  row*16 + localAABB.y
// asserted purely as arithmetic (no Phaser required).
//
// CollisionBuilder imports NO Phaser, so it is imported directly; the pure methods
// ignore scene/group, so `new CollisionBuilder(null, null)` suffices.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import CollisionBuilder from '../CollisionBuilder.js';

const TILE = 16;

// ---------------------------------------------------------------------------
// Arbitraries for each of the four tile-def categories. Each arbitrary yields
// a record { tileDef, expectKind, expectedAABB } where expectKind is 'floor'
// or 'collision' and expectedAABB is the independently-computed AABB (or null).
// Point/coordinate values are kept as INTEGERS so AABB equality is exact.
// ---------------------------------------------------------------------------

// Category 1: no objectgroup at all, OR an empty objects array -> floor.
const noObjectGroupArb = fc.oneof(
  fc.record({ id: fc.integer({ min: 0, max: 63 }) }).map((tileDef) => ({
    tileDef,
    expectKind: 'floor',
    expectedAABB: null
  })),
  fc
    .record({ id: fc.integer({ min: 0, max: 63 }) })
    .map((base) => ({
      tileDef: { ...base, objectgroup: { objects: [] } },
      expectKind: 'floor',
      expectedAABB: null
    }))
);

// Category 2: a single rectangle object -> collision. width/height strictly > 0.
const rectangleArb = fc
  .record({
    id: fc.integer({ min: 0, max: 63 }),
    x: fc.integer({ min: 0, max: 15 }),
    y: fc.integer({ min: 0, max: 15 }),
    width: fc.integer({ min: 1, max: 16 }),
    height: fc.integer({ min: 1, max: 16 })
  })
  .map(({ id, x, y, width, height }) => ({
    tileDef: {
      id,
      objectgroup: { objects: [{ x, y, width, height }] }
    },
    expectKind: 'collision',
    expectedAABB: { x, y, width, height }
  }));

// Category 3: a polygon object with >= 2 points spanning a positive area -> collision.
// Expected AABB is computed independently via min/max of (obj.x + pt.x, obj.y + pt.y).
const polygonArb = fc
  .record({
    id: fc.integer({ min: 0, max: 63 }),
    ox: fc.integer({ min: 0, max: 15 }),
    oy: fc.integer({ min: 0, max: 15 }),
    pts: fc.array(
      fc.record({
        x: fc.integer({ min: 0, max: 16 }),
        y: fc.integer({ min: 0, max: 16 })
      }),
      { minLength: 2, maxLength: 6 }
    )
  })
  // Keep only polygons spanning a positive area in both axes; otherwise
  // tileLocalAABB returns null (degenerate) and the tile is floor, not collision.
  .filter(({ pts }) => {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return Math.max(...xs) > Math.min(...xs) && Math.max(...ys) > Math.min(...ys);
  })
  .map(({ id, ox, oy, pts }) => {
    const worldPts = pts.map((p) => ({ x: ox + p.x, y: oy + p.y }));
    const xs = worldPts.map((p) => p.x);
    const ys = worldPts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      tileDef: {
        id,
        objectgroup: { objects: [{ x: ox, y: oy, polygon: pts }] }
      },
      expectKind: 'collision',
      expectedAABB: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    };
  });

// Category 4: objectgroup present but objects are garbage (no valid AABB) -> floor.
const malformedArb = fc
  .oneof(
    fc.constant([{ foo: 'bar' }]),
    fc.constant([{ width: 0, height: 0, x: 1, y: 1 }]),
    fc.constant([null]),
    fc.constant([{ x: 2, y: 2 }]), // rect missing width/height
    fc.constant([{ x: 1, y: 1, polygon: [] }]) // empty polygon
  )
  .chain((objects) =>
    fc.record({ id: fc.integer({ min: 0, max: 63 }) }).map((base) => ({
      tileDef: { ...base, objectgroup: { objects } },
      expectKind: 'floor',
      expectedAABB: null
    }))
  );

// One arbitrary that uniformly selects one of the four categories.
const tileCategoryArb = fc.oneof(
  noObjectGroupArb,
  rectangleArb,
  polygonArb,
  malformedArb
);

describe('CollisionBuilder — Property 14: classification + AABB + offset', () => {
  const builder = new CollisionBuilder(null, null);

  /**
   * Classification and tile-local AABB are correct for every category:
   *   - floor/malformed  -> classifyTile 'floor'     AND tileLocalAABB null
   *   - rectangle/polygon -> classifyTile 'collision' AND tileLocalAABB deep-equals
   *     the independently-computed enclosing AABB.
   * Also validates the world-offset invariant (Req 6.7): for collision tiles, the
   * body world top-left equals worldOffsetX + col*16 + localAABB.x / row*16 + localAABB.y.
   * **Validates: Requirements 6.2, 6.3, 6.4, 6.7, 6.8**
   */
  it('classifies each tile category and offsets its AABB into world space correctly', () => {
    fc.assert(
      fc.property(
        tileCategoryArb,
        fc.integer({ min: 0, max: 57 }), // col within a 58-wide segment
        fc.integer({ min: 0, max: 14 }), // row within a 15-tall map
        fc.integer({ min: 0, max: 100000 }), // worldOffsetX
        ({ tileDef, expectKind, expectedAABB }, col, row, worldOffsetX) => {
          const kind = builder.classifyTile(tileDef);
          const localAABB = builder.tileLocalAABB(tileDef);

          expect(kind).toBe(expectKind);

          if (expectKind === 'floor') {
            // Floor / unparseable is occupiable: no AABB.
            expect(localAABB).toBeNull();
            return;
          }

          // Collision: AABB matches the independently-computed enclosing box.
          expect(localAABB).toEqual(expectedAABB);

          // Offset invariant (Req 6.7): tile-local AABB offset by the segment
          // world offset gives the body world top-left.
          const expectedWorldX = worldOffsetX + col * TILE + localAABB.x;
          const expectedWorldY = row * TILE + localAABB.y;

          expect(worldOffsetX + col * TILE + localAABB.x).toBe(expectedWorldX);
          expect(row * TILE + localAABB.y).toBe(expectedWorldY);

          // The world AABB preserves the tile-local extents exactly.
          expect(localAABB.width).toBe(expectedAABB.width);
          expect(localAABB.height).toBe(expectedAABB.height);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Cross-check: classifyTile is exactly consistent with tileLocalAABB over all
   * categories — 'collision' iff a non-null AABB, 'floor' otherwise. This pins the
   * "floor/unparseable => occupiable, collision => enclosing AABB" invariant.
   * **Validates: Requirements 6.2, 6.8**
   */
  it('keeps classifyTile consistent with tileLocalAABB for every category', () => {
    fc.assert(
      fc.property(tileCategoryArb, ({ tileDef }) => {
        const kind = builder.classifyTile(tileDef);
        const aabb = builder.tileLocalAABB(tileDef);
        if (aabb) {
          expect(kind).toBe('collision');
          expect(aabb.width).toBeGreaterThan(0);
          expect(aabb.height).toBeGreaterThan(0);
        } else {
          expect(kind).toBe('floor');
        }
      }),
      { numRuns: 100 }
    );
  });
});
