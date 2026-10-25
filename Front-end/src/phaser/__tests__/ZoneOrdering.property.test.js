// Feature: infinite-hallway, Property 17: Zone ordering determinism
// **Validates: Requirements 12.2**
//
// `assignZoneIndices` ranks the 6 zone descriptors of a segment by
// `(x asc, then y asc, then Tiled id asc)` and tags each with a 0-based
// `zoneIndex`. Because the Tiled `id` is unique per object it breaks every
// `(x, y)` tie, so the sort is a TOTAL order and the assignment is a bijection
// onto `{0,1,2,3,4,5}`. This property asserts that bijection, the stability of
// the id→zoneIndex mapping across repeated calls, the (x,y,id) ascending order
// of the returned array, and the purity (no mutation) of the input.
//
// `assignZoneIndices` is a pure helper that imports only from ../data/memories.js
// (no Phaser), so it is imported directly with no module mock.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { assignZoneIndices } from '../memoryResolve.js';

/**
 * Generator: exactly 6 `{x, y, id}` records with UNIQUE integer ids and x/y
 * drawn from a SMALL range (0..3) so equal-x and equal-(x,y) ties occur
 * frequently — forcing the unique id to act as the final tie-breaker and
 * yielding a total order.
 *
 * Six unique ids are produced by shuffling the permutation of [1..6], so every
 * record is guaranteed a distinct id regardless of its (x, y).
 */
const SMALL = { min: 0, max: 3 };

const sixRecords = fc
  .tuple(
    // a permutation of ids 1..6 → guaranteed-unique integer ids
    fc.shuffledSubarray([1, 2, 3, 4, 5, 6], { minLength: 6, maxLength: 6 }),
    fc.array(fc.integer(SMALL), { minLength: 6, maxLength: 6 }), // xs
    fc.array(fc.integer(SMALL), { minLength: 6, maxLength: 6 }) // ys
  )
  .map(([ids, xs, ys]) => ids.map((id, i) => ({ x: xs[i], y: ys[i], id })));

/** Deep structural clone for mutation snapshots. */
const clone = (records) => records.map((r) => ({ ...r }));

/** Build a stable id→zoneIndex lookup from an assigned result. */
const idToZone = (assigned) => {
  const map = new Map();
  for (const r of assigned) map.set(r.id, r.zoneIndex);
  return map;
};

describe('Property 17: Zone ordering determinism', () => {
  /**
   * (1) Bijection: the assigned zoneIndex values, sorted, are exactly
   *     [0,1,2,3,4,5] — every index assigned once, no gaps or duplicates.
   * (2) Stability: two calls on the same input produce an identical
   *     id→zoneIndex mapping.
   * (3) Ordering: the returned array is sorted ascending by (x, y, id) for all
   *     consecutive entries (and zoneIndex matches array position).
   * (4) Purity: neither the input array nor its objects are mutated.
   * **Validates: Requirements 12.2**
   */
  it('assigns a stable bijection in (x,y,id) order without mutating input', () => {
    fc.assert(
      fc.property(sixRecords, (records) => {
        const snapshot = clone(records);

        const first = assignZoneIndices(records);
        const second = assignZoneIndices(records);

        // (1) bijection onto {0,1,2,3,4,5}
        const indices = first.map((r) => r.zoneIndex).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 2, 3, 4, 5]);

        // (2) stability — identical id→zoneIndex mapping across calls
        const mapA = idToZone(first);
        const mapB = idToZone(second);
        expect([...mapB.entries()].sort()).toEqual([...mapA.entries()].sort());

        // (3) ordering — consecutive entries are (x,y,id) ascending, and the
        //     zoneIndex equals the array position.
        for (let i = 0; i < first.length; i++) {
          expect(first[i].zoneIndex).toBe(i);
          if (i > 0) {
            const prev = first[i - 1];
            const cur = first[i];
            const ordered =
              prev.x < cur.x ||
              (prev.x === cur.x && prev.y < cur.y) ||
              (prev.x === cur.x && prev.y === cur.y && prev.id < cur.id);
            expect(ordered).toBe(true);
          }
        }

        // (4) purity — input array and its objects are untouched.
        expect(records).toEqual(snapshot);
        expect(first).not.toBe(records);
        for (let i = 0; i < records.length; i++) {
          expect(records[i]).not.toHaveProperty('zoneIndex');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Explicit equal-x example: three records share x = 10; their relative order
   * must fall first to ascending y, then (for the y-tie) to ascending id.
   * Expected sorted order by (x,y,id):
   *   (10,0,id7) → (10,2,id3) → (10,2,id9) → (12,0,id1)
   * **Validates: Requirements 12.2**
   */
  it('breaks equal-x ties by y then by unique id (explicit example)', () => {
    const records = [
      { x: 12, y: 0, id: 1 },
      { x: 10, y: 2, id: 9 },
      { x: 10, y: 2, id: 3 },
      { x: 10, y: 0, id: 7 },
    ];
    const snapshot = clone(records);

    const assigned = assignZoneIndices(records);

    expect(assigned.map((r) => r.id)).toEqual([7, 3, 9, 1]);
    expect(assigned.map((r) => r.zoneIndex)).toEqual([0, 1, 2, 3]);

    // purity on the explicit example too
    expect(records).toEqual(snapshot);
  });
});
