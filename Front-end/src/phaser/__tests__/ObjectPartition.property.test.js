// Feature: wall-paintings, Property 1: Type-partitioned reads
// **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
//
// For all object arrays mixing `memory_zone`, `painting`, and other/untyped
// objects, `partitionObjectsByType` returns `memoryZones` equal to exactly the
// `memory_zone` objects and `paintings` equal to exactly the `painting` objects;
// no other-typed, empty-typed, or untyped object appears in either subset. The
// class is read as `obj.type ?? obj.class ?? ''` (robust across Tiled versions).
// The helper is pure (no Phaser), imported directly with no module mock.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { partitionObjectsByType } from '../paintingResolve.js';

/**
 * An object carrying a class under the `type` field (older Tiled export), with a
 * unique id so set membership is checkable by identity-free structural compare.
 */
const typeFieldObject = (classValue) =>
  fc.record({
    type: fc.constant(classValue),
    x: fc.integer(),
    y: fc.integer(),
    id: fc.integer(),
  });

/** Same but under the `class` field (Tiled >= 1.9 export). */
const classFieldObject = (classValue) =>
  fc.record({
    class: fc.constant(classValue),
    x: fc.integer(),
    y: fc.integer(),
    id: fc.integer(),
  });

// A mixed object: a recognized type, an unrecognized type, an empty type, or no
// type field at all — authored under either the `type` or the `class` field.
const mixedObject = fc.oneof(
  typeFieldObject('memory_zone'),
  typeFieldObject('painting'),
  classFieldObject('memory_zone'),
  classFieldObject('painting'),
  typeFieldObject('decor'),
  typeFieldObject('prop'),
  typeFieldObject(''),
  fc.record({ x: fc.integer(), y: fc.integer(), id: fc.integer() }) // no type/class
);

const mixedLayer = fc.array(mixedObject, { maxLength: 30 });

/** Read an object's class the same way the helper does. */
const classOf = (o) => (o && (o.type ?? o.class ?? '')) || '';

describe('Property 1: Type-partitioned reads', () => {
  /**
   * `memoryZones` is exactly the `memory_zone` objects (by reference), `paintings`
   * is exactly the `painting` objects (by reference), input order is preserved
   * within each subset, and no other/empty/missing-typed object appears in either.
   * **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
   */
  it('selects exactly the memory_zone and painting subsets, excluding all others', () => {
    fc.assert(
      fc.property(mixedLayer, (objects) => {
        const { memoryZones, paintings } = partitionObjectsByType(objects);

        const expectedZones = objects.filter((o) => classOf(o) === 'memory_zone');
        const expectedPaintings = objects.filter((o) => classOf(o) === 'painting');

        // Exact subsets, same objects, same relative order.
        expect(memoryZones).toEqual(expectedZones);
        expect(paintings).toEqual(expectedPaintings);
        memoryZones.forEach((o, i) => expect(o).toBe(expectedZones[i]));
        paintings.forEach((o, i) => expect(o).toBe(expectedPaintings[i]));

        // No cross-contamination: nothing other-typed slipped in.
        for (const o of memoryZones) expect(classOf(o)).toBe('memory_zone');
        for (const o of paintings) expect(classOf(o)).toBe('painting');

        // Counts add up: no object is both, none duplicated.
        expect(memoryZones.length + paintings.length).toBeLessThanOrEqual(objects.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Purity: the input array is not mutated and no new object identities are
   * created (the helper filters, it does not clone).
   * **Validates: Requirements 1.2, 1.3**
   */
  it('does not mutate the input array', () => {
    fc.assert(
      fc.property(mixedLayer, (objects) => {
        const snapshot = [...objects];
        partitionObjectsByType(objects);
        expect(objects).toEqual(snapshot);
        objects.forEach((o, i) => expect(o).toBe(snapshot[i]));
      }),
      { numRuns: 100 }
    );
  });

  it('returns empty subsets for a non-array input (defensive)', () => {
    expect(partitionObjectsByType(undefined)).toEqual({ memoryZones: [], paintings: [] });
    expect(partitionObjectsByType(null)).toEqual({ memoryZones: [], paintings: [] });
  });
});
