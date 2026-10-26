import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Feature: wall-paintings, Property 2: Zone-index invariance under paintings
// **Validates: Requirements 1.6, 2.1, 2.2**
//
// Feature: wall-paintings, Property 3: Zone-count invariance
// **Validates: Requirements 2.3, 2.4**
//
// These properties exercise the composition that `_buildSegment` uses:
// `partitionObjectsByType` → `assignZoneIndices` over the memory_zone subset
// ONLY. Both helpers are pure (no Phaser), imported directly with no mock.
import { partitionObjectsByType } from '../paintingResolve.js';
import { assignZoneIndices } from '../memoryResolve.js';

const SMALL = { min: 0, max: 5 };

/**
 * Six memory_zone objects with UNIQUE ids (so the (x,y,id) order is total) and
 * small x/y so ties — and therefore the id tie-breaker — occur frequently.
 */
const sixZones = fc
  .tuple(
    fc.shuffledSubarray([1, 2, 3, 4, 5, 6], { minLength: 6, maxLength: 6 }),
    fc.array(fc.integer(SMALL), { minLength: 6, maxLength: 6 }),
    fc.array(fc.integer(SMALL), { minLength: 6, maxLength: 6 })
  )
  .map(([ids, xs, ys]) =>
    ids.map((id, i) => ({ type: 'memory_zone', x: xs[i], y: ys[i], id }))
  );

/**
 * An arbitrary number of painting objects with ids that cannot collide with the
 * zone ids (offset well past 6), at arbitrary positions.
 */
const paintingObjects = fc.array(
  fc
    .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }))
    .map(([i, x, y]) => ({ type: 'painting', x, y, id: 1000 + i, width: 48, height: 48 })),
  { maxLength: 20 }
);

/** Rank zones, keyed by stable zone id → its assigned memoryIndex at segIndex. */
const zoneIndexMap = (zones, segIndex) => {
  const ranked = assignZoneIndices(zones.map((z) => ({ x: z.x, y: z.y, id: z.id })));
  const map = new Map();
  for (const r of ranked) map.set(r.id, { zoneIndex: r.zoneIndex, memoryIndex: segIndex * 6 + r.zoneIndex });
  return map;
};

describe('Property 2: Zone-index invariance under paintings', () => {
  /**
   * For a FIXED set of 6 memory_zone objects, adding any number of painting
   * objects (anywhere) and partitioning does not change any zone's zoneIndex or
   * memoryIndex: partitioning drops the paintings before `assignZoneIndices`
   * ever sees them.
   * **Validates: Requirements 1.6, 2.1, 2.2**
   */
  it('leaves every zone index unchanged when paintings are added', () => {
    fc.assert(
      fc.property(sixZones, paintingObjects, fc.nat({ max: 10000 }), (zones, paintings, segIndex) => {
        // Baseline: the zones alone.
        const baseline = zoneIndexMap(zones, segIndex);

        // With paintings interleaved into the same Object Layer 1.
        const layer = [...paintings, ...zones, ...paintings];
        const { memoryZones } = partitionObjectsByType(layer);
        const withPaintings = zoneIndexMap(memoryZones, segIndex);

        // Same 6 zone ids, same zoneIndex and memoryIndex for each.
        expect([...withPaintings.keys()].sort()).toEqual([...baseline.keys()].sort());
        for (const [id, base] of baseline) {
          expect(withPaintings.get(id)).toEqual(base);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Zone-count invariance', () => {
  /**
   * With exactly 6 memory_zone objects, the partitioned zone count is 6
   * regardless of how many painting objects share the layer.
   * **Validates: Requirements 2.3, 2.4**
   */
  it('yields exactly 6 memory zones regardless of painting count', () => {
    fc.assert(
      fc.property(sixZones, paintingObjects, (zones, paintings) => {
        const layer = [...paintings, ...zones];
        const { memoryZones, paintings: builtPaintings } = partitionObjectsByType(layer);
        expect(memoryZones).toHaveLength(6);
        expect(builtPaintings).toHaveLength(paintings.length);

        // The 6 ranked zones form a bijection onto {0..5} independent of paintings.
        const ranked = assignZoneIndices(memoryZones.map((z) => ({ x: z.x, y: z.y, id: z.id })));
        const indices = ranked.map((r) => r.zoneIndex).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
      }),
      { numRuns: 100 }
    );
  });
});
