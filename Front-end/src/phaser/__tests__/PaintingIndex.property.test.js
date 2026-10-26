// Feature: wall-paintings, Property 4: Painting–memory index agreement
// **Validates: Requirements 3.1, 3.2**
//
// For all segment indices `s` and ranks `z` in `0..5`, ranking `painting`
// objects and `memory_zone` objects by the SAME `(x asc, y asc, id asc)` rule
// yields, at rank `z`, a Painting_Object and a Memory_Zone_Object with the
// identical `Memory_Index = s*6 + z`. `assignPaintingIndices` and
// `assignZoneIndices` are pure helpers (no Phaser), imported directly with no
// module mock.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { assignPaintingIndices } from '../paintingResolve.js';
import { assignZoneIndices } from '../memoryResolve.js';

const SMALL = { min: 0, max: 3 };

/**
 * Generator: exactly 6 `{x, y, id}` records with UNIQUE integer ids and x/y
 * drawn from a SMALL range so equal-x and equal-(x,y) ties occur frequently —
 * forcing the unique id to act as the final tie-breaker and yielding a total
 * order. (Six unique ids come from shuffling the permutation of [1..6].)
 */
const sixRecords = fc
  .tuple(
    fc.shuffledSubarray([1, 2, 3, 4, 5, 6], { minLength: 6, maxLength: 6 }),
    fc.array(fc.integer(SMALL), { minLength: 6, maxLength: 6 }),
    fc.array(fc.integer(SMALL), { minLength: 6, maxLength: 6 })
  )
  .map(([ids, xs, ys]) => ids.map((id, i) => ({ x: xs[i], y: ys[i], id })));

const segArb = fc.nat({ max: 10000 });

describe('Property 4: Painting–memory index agreement', () => {
  /**
   * For a single shared set of object positions, ranking the same objects as
   * paintings and as memory zones must produce IDENTICAL rankings (same object
   * at each rank), so at every rank `z` the derived `memoryIndex = s*6 + z` is
   * the same for the painting and the zone.
   * **Validates: Requirements 3.1, 3.2**
   */
  it('aligns painting rank k with memory-zone rank k at identical memoryIndex', () => {
    fc.assert(
      fc.property(segArb, sixRecords, (s, records) => {
        const paintings = assignPaintingIndices(records);
        const zones = assignZoneIndices(records);

        expect(paintings).toHaveLength(6);
        expect(zones).toHaveLength(6);

        for (let z = 0; z <= 5; z += 1) {
          const painting = paintings.find((p) => p.paintingIndex === z);
          const zone = zones.find((zn) => zn.zoneIndex === z);

          // Same object occupies rank z in both rankings.
          expect(painting.id).toBe(zone.id);
          expect(painting.x).toBe(zone.x);
          expect(painting.y).toBe(zone.y);

          // Therefore the derived Memory_Index agrees at every rank.
          const paintingMemoryIndex = s * 6 + painting.paintingIndex;
          const zoneMemoryIndex = s * 6 + zone.zoneIndex;
          expect(paintingMemoryIndex).toBe(zoneMemoryIndex);
          expect(paintingMemoryIndex).toBe(s * 6 + z);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * The painting ranking alone is a bijection onto {0..5} in (x,y,id) order and
   * does not mutate its input — the same contract `assignZoneIndices` upholds.
   * **Validates: Requirements 3.1, 3.2**
   */
  it('assigns paintingIndex as a bijection onto {0..5} without mutating input', () => {
    fc.assert(
      fc.property(sixRecords, (records) => {
        const snapshot = records.map((r) => ({ ...r }));
        const assigned = assignPaintingIndices(records);

        const indices = assigned.map((p) => p.paintingIndex).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 2, 3, 4, 5]);

        for (let i = 0; i < assigned.length; i += 1) {
          expect(assigned[i].paintingIndex).toBe(i);
          if (i > 0) {
            const prev = assigned[i - 1];
            const cur = assigned[i];
            const ordered =
              prev.x < cur.x ||
              (prev.x === cur.x && prev.y < cur.y) ||
              (prev.x === cur.x && prev.y === cur.y && prev.id < cur.id);
            expect(ordered).toBe(true);
          }
        }

        // Purity: input untouched, no paintingIndex leaked onto inputs.
        expect(records).toEqual(snapshot);
        for (const r of records) {
          expect(r).not.toHaveProperty('paintingIndex');
        }
      }),
      { numRuns: 100 }
    );
  });
});
