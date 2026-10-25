// Feature: infinite-hallway, Property 18: Future zone opens future-memory overlay
// For all zones whose Memory_Index is >= N (the Authored_Memory_Count), resolveZonePayload
// returns the constant future-memory overlay: payload.text === ["A future memory, not yet saved ❤"],
// payload.imageUrl === null, and id === `memory-${memoryIndex}`.

// **Validates: Requirements 12.6, 13.5**

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveZonePayload } from '../memoryResolve.js';
import { FUTURE_MEMORY_TEXT } from '../../data/memories.js';

describe('Property 18: Future zone opens future-memory overlay', () => {
  it('future-memory copy is the exact expected string', () => {
    // Pin the constant so the overlay assertions below have a single source of truth.
    expect(FUTURE_MEMORY_TEXT).toBe('A future memory, not yet saved ❤');
  });

  it('for every memoryIndex >= N, payload is the constant future overlay', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }), // segIndex (s)
        fc.integer({ min: 0, max: 5 }), // zoneIndex (z)
        fc.nat({ max: 60 }), // raw N candidate
        (s, z, rawN) => {
          const memoryIndex = s * 6 + z;
          // Force a Future_Zone: clamp N to <= memoryIndex so memoryIndex >= N always holds.
          const N = Math.min(rawN, memoryIndex);

          // The future-zone payload does NOT depend on manifest contents, so a
          // synthetic empty manifest is sufficient for this property.
          const manifest = {};

          const result = resolveZonePayload(s, z, manifest, N);

          expect(result.memoryIndex).toBe(memoryIndex);
          expect(result.id).toBe(`memory-${memoryIndex}`);
          expect(result.payload.id).toBe(result.id);
          expect(result.payload.text).toEqual([FUTURE_MEMORY_TEXT]);
          expect(result.payload.imageUrl).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
