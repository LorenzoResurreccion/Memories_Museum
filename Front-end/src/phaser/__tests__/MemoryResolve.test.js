/**
 * MemoryResolve.test.js — example-based tests for the pure memory-resolution
 * helpers in `../memoryResolve.js` (`resolveZonePayload`, `assignZoneIndices`).
 *
 * These are concrete, hand-computed examples that complement the property
 * tests. With Authored_Memory_Count N = 8 the authored memories occupy
 * Memory_Index 0..7 (segment 0 zones 0..5 = memory 0..5; segment 1 zones 0..1 =
 * memory 6..7), and segment 1 zone 2 (memory 8) is the first Future_Zone.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */

import { describe, it, expect } from 'vitest';
import { resolveZonePayload, assignZoneIndices } from '../memoryResolve.js';
import { partitionObjectsByType } from '../paintingResolve.js';
import { FUTURE_MEMORY_TEXT } from '../../data/memories.js';

const N = 8;

// Synthetic manifest with 8 authored entries at indices 0..7, so the example
// assertions control the exact authored content.
const manifest = Object.fromEntries(
  Array.from({ length: N }, (_, i) => [i, { text: [`m${i}`], imageUrl: null }]),
);

describe('resolveZonePayload (N = 8)', () => {
  it('seg0 zone0 ⇒ memory-0 (authored)', () => {
    const { id, memoryIndex, payload } = resolveZonePayload(0, 0, manifest, N);
    expect(memoryIndex).toBe(0);
    expect(id).toBe('memory-0');
    expect(payload).toEqual({ id: 'memory-0', text: ['m0'], imageUrl: null });
  });

  it('seg0 zone1 ⇒ memory-1 (authored)', () => {
    const { id, memoryIndex, payload } = resolveZonePayload(0, 1, manifest, N);
    expect(memoryIndex).toBe(1);
    expect(id).toBe('memory-1');
    expect(payload).toEqual({ id: 'memory-1', text: ['m1'], imageUrl: null });
  });

  it('seg1 zone0 ⇒ memory-6 (authored)', () => {
    const { id, memoryIndex, payload } = resolveZonePayload(1, 0, manifest, N);
    expect(memoryIndex).toBe(6);
    expect(id).toBe('memory-6');
    expect(payload).toEqual({ id: 'memory-6', text: ['m6'], imageUrl: null });
  });

  it('seg1 zone1 ⇒ memory-7 (authored)', () => {
    const { id, memoryIndex, payload } = resolveZonePayload(1, 1, manifest, N);
    expect(memoryIndex).toBe(7);
    expect(id).toBe('memory-7');
    expect(payload).toEqual({ id: 'memory-7', text: ['m7'], imageUrl: null });
  });

  it('seg1 zone2 ⇒ memory-8, a Future_Zone with the future payload (Req 12.6)', () => {
    const { id, memoryIndex, payload } = resolveZonePayload(1, 2, manifest, N);
    expect(memoryIndex).toBe(8);
    expect(id).toBe('memory-8');
    expect(payload).toEqual({ id: 'memory-8', text: [FUTURE_MEMORY_TEXT], imageUrl: null });
  });

  it('every returned id matches /^memory-\\d+$/ and equals `memory-${memoryIndex}` (Req 12.5)', () => {
    for (let seg = 0; seg <= 2; seg += 1) {
      for (let zone = 0; zone <= 5; zone += 1) {
        const { id, memoryIndex } = resolveZonePayload(seg, zone, manifest, N);
        expect(id).toMatch(/^memory-\d+$/);
        expect(id).toBe(`memory-${memoryIndex}`);
      }
    }
  });

  it('re-resolving the same zone yields identical content (Req 12.7)', () => {
    // Authored case.
    const a1 = resolveZonePayload(1, 0, manifest, N);
    const a2 = resolveZonePayload(1, 0, manifest, N);
    expect(a2.payload).toEqual(a1.payload);
    expect(a2).toEqual(a1);

    // Future case.
    const f1 = resolveZonePayload(1, 2, manifest, N);
    const f2 = resolveZonePayload(1, 2, manifest, N);
    expect(f2.payload).toEqual(f1.payload);
    expect(f2).toEqual(f1);
  });
});

describe('assignZoneIndices (Req 12.1, 12.2)', () => {
  it('ranks 6 zones by (x asc, y asc, id asc) and tags each with its zoneIndex', () => {
    // Given (unsorted) input. Two zones share x = 20 to exercise the y/id
    // tiebreakers; among those, equal x+y falls back to ascending id.
    const input = [
      { x: 40, y: 10, id: 3 }, // rank 4
      { x: 10, y: 10, id: 1 }, // rank 0 (smallest x)
      { x: 20, y: 10, id: 9 }, // rank 2 (x=20, y=10, id 9 after id 5)
      { x: 20, y: 10, id: 5 }, // rank 1 (x=20, y=10, id 5 first)
      { x: 50, y: 5, id: 2 }, // rank 5 (largest x)
      { x: 20, y: 30, id: 0 }, // rank 3 (x=20, larger y)
    ];

    const result = assignZoneIndices(input);

    // Hand-computed sorted order with assigned zoneIndex.
    expect(result).toEqual([
      { x: 10, y: 10, id: 1, zoneIndex: 0 },
      { x: 20, y: 10, id: 5, zoneIndex: 1 },
      { x: 20, y: 10, id: 9, zoneIndex: 2 },
      { x: 20, y: 30, id: 0, zoneIndex: 3 },
      { x: 40, y: 10, id: 3, zoneIndex: 4 },
      { x: 50, y: 5, id: 2, zoneIndex: 5 },
    ]);

    // Pure: original input array is not mutated.
    expect(input[0]).toEqual({ x: 40, y: 10, id: 3 });
    expect(input).toHaveLength(6);
  });
});

/**
 * Backward compatibility with the Wall Paintings type-partition change (Req 2.3, 7.3).
 *
 * `_buildSegment` now reads `Object Layer 1` via `partitionObjectsByType` and ranks
 * ONLY the `memory_zone` subset before resolving. These tests prove that, with the 6
 * existing interaction objects tagged `type: 'memory_zone'`, the resolved
 * `hotspot-activated` payloads for seg0 zone0..5 and seg1 zone0 match the PRE-feature
 * `memory-{n}` resolution EXACTLY — and that adding `painting` objects to the same
 * layer does not change any of them (Req 1.6, 2.1, 2.2).
 */
describe('backward compatibility: memory_zone partition preserves resolution (N = 8)', () => {
  // The 6 authored interaction objects at each frame's left edge, now type-tagged.
  const xs = [48, 208, 368, 512, 672, 832];
  const memoryZoneObjects = xs.map((x, i) => ({
    type: 'memory_zone',
    x,
    y: 176,
    id: 10 + i,
    width: 0,
    height: 0
  }));

  // Painting objects that share the layer but must not affect zone resolution.
  const paintingObjects = xs.map((x, i) => ({
    type: 'painting',
    x: x + 4,
    y: 150,
    id: 20 + i,
    width: 40,
    height: 24
  }));

  /** Resolve a segment's zones exactly as `_buildSegment` does, from a raw object list. */
  function resolveSegment(segIndex, rawObjects) {
    const { memoryZones } = partitionObjectsByType(rawObjects);
    const ordered = assignZoneIndices(
      memoryZones.map((o) => ({ x: o.x, y: o.y, id: o.id }))
    );
    return ordered.map((d) => resolveZonePayload(segIndex, d.zoneIndex, manifest, N));
  }

  it('seg0 zone0..5 resolve to memory-0..5 with the authored payloads', () => {
    const resolved = resolveSegment(0, memoryZoneObjects);
    expect(resolved).toHaveLength(6);
    for (let z = 0; z <= 5; z += 1) {
      expect(resolved[z].memoryIndex).toBe(z);
      expect(resolved[z].id).toBe(`memory-${z}`);
      expect(resolved[z].payload).toEqual({ id: `memory-${z}`, text: [`m${z}`], imageUrl: null });
    }
  });

  it('seg1 zone0 resolves to memory-6 (authored)', () => {
    const resolved = resolveSegment(1, memoryZoneObjects);
    expect(resolved[0].memoryIndex).toBe(6);
    expect(resolved[0].id).toBe('memory-6');
    expect(resolved[0].payload).toEqual({ id: 'memory-6', text: ['m6'], imageUrl: null });
  });

  it('adding painting objects to the same layer does not change any zone resolution', () => {
    const withoutPaintings = resolveSegment(0, memoryZoneObjects);
    const withPaintings = resolveSegment(0, [...paintingObjects, ...memoryZoneObjects, ...paintingObjects]);
    expect(withPaintings).toEqual(withoutPaintings);
  });

  it('builds exactly 6 zones regardless of painting count (count invariance)', () => {
    const { memoryZones } = partitionObjectsByType([...memoryZoneObjects, ...paintingObjects]);
    expect(memoryZones).toHaveLength(6);
  });
});
