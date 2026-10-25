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
