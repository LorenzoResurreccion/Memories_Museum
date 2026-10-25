import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Feature: infinite-hallway, Property 16: Memory-index determinism
// **Validates: Requirements 12.3, 12.7**
//
// `resolveZonePayload(segIndex, zoneIndex, manifest, N)` is a PURE resolver: it
// derives `memoryIndex = segIndex*6 + zoneIndex`, a stable `id = memory-{n}`, and
// a payload that either mirrors the authored manifest entry (when
// `memoryIndex < N`) or is the constant future-memory overlay (when
// `memoryIndex >= N`). The helper imports only the static manifest module (no
// Phaser, no DOM, no network), so no module mock is required.
import { resolveZonePayload } from '../memoryResolve.js';
import { MEMORIES, FUTURE_MEMORY_TEXT } from '../../data/memories.js';

const AUTHORED_N = Object.keys(MEMORIES).length;

// Generators per the design's input space.
const segArb = fc.nat({ max: 10000 }); // s >= 0
const zoneArb = fc.integer({ min: 0, max: 5 }); // z in 0..5
const nArb = fc.nat({ max: 60 }); // synthetic authored-memory count

/**
 * Build a synthetic plain-object manifest with `n` contiguous authored entries
 * at indices `0..n-1`, each MemoryEntry-shaped. Values are deterministic in `n`
 * so the generator stays pure and reproducible.
 * @param {number} n
 * @returns {Record<number, {text: string[], imageUrl: string|null}>}
 */
function syntheticManifest(n) {
  const m = {};
  for (let i = 0; i < n; i++) {
    m[i] = {
      text: [`synthetic memory ${i} — page 1`, `synthetic memory ${i} — page 2`],
      imageUrl: i % 2 === 0 ? null : `https://cdn.example/photo-${i}.png`,
    };
  }
  return m;
}

describe('resolveZonePayload (Property 16: memory-index determinism)', () => {
  /**
   * memoryIndex and id are the pure arithmetic/string functions of (s, z):
   * `memoryIndex === s*6 + z` and `id === memory-{s*6+z}`, independent of the
   * manifest and N.
   * **Validates: Requirements 12.3, 12.7**
   */
  it('derives memoryIndex === s*6+z and id === `memory-${s*6+z}` for all (s, z)', () => {
    fc.assert(
      fc.property(segArb, zoneArb, nArb, (s, z, n) => {
        const manifest = syntheticManifest(n);
        const { memoryIndex, id } = resolveZonePayload(s, z, manifest, n);
        expect(memoryIndex).toBe(s * 6 + z);
        expect(id).toBe(`memory-${s * 6 + z}`);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Re-resolving the same (s, z) against the same manifest/N yields a deeply
   * identical result every time: memoryIndex, id, and the full payload are
   * reproducible (pure, no hidden state).
   * **Validates: Requirements 12.7**
   */
  it('is deterministic — two calls for the same (s, z, manifest, N) deeply equal', () => {
    fc.assert(
      fc.property(segArb, zoneArb, nArb, (s, z, n) => {
        const manifest = syntheticManifest(n);
        const first = resolveZonePayload(s, z, manifest, n);
        const second = resolveZonePayload(s, z, manifest, n);
        expect(second.memoryIndex).toEqual(first.memoryIndex);
        expect(second.id).toEqual(first.id);
        expect(second.payload).toEqual(first.payload);
        // Whole result object equality (covers any added fields too).
        expect(second).toEqual(first);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Authored-vs-future split against a synthetic manifest:
   *  - memoryIndex < N  → payload mirrors the manifest entry, with the per-zone
   *    id embedded and text/imageUrl defaulted gracefully.
   *  - memoryIndex >= N → payload is the constant future overlay:
   *    `text === [FUTURE_MEMORY_TEXT]`, `imageUrl === null`.
   * **Validates: Requirements 12.3, 12.7**
   */
  it('splits authored vs future on N and mirrors / overlays the payload accordingly', () => {
    fc.assert(
      fc.property(segArb, zoneArb, nArb, (s, z, n) => {
        const manifest = syntheticManifest(n);
        const { memoryIndex, id, payload } = resolveZonePayload(s, z, manifest, n);
        expect(payload.id).toBe(id);
        if (memoryIndex < n) {
          const entry = manifest[memoryIndex];
          expect(payload.text).toEqual(entry.text);
          expect(payload.imageUrl).toEqual(entry.imageUrl);
        } else {
          expect(payload.text).toEqual([FUTURE_MEMORY_TEXT]);
          expect(payload.imageUrl).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * The same split holds against the REAL static manifest (MEMORIES) using the
   * real authored count N. This exercises the production source of truth, not
   * just synthetic data.
   * **Validates: Requirements 12.3, 12.7**
   */
  it('mirrors the real MEMORIES manifest below N and future overlay at/above N', () => {
    fc.assert(
      fc.property(segArb, zoneArb, (s, z) => {
        const { memoryIndex, id, payload } = resolveZonePayload(s, z, MEMORIES, AUTHORED_N);
        expect(memoryIndex).toBe(s * 6 + z);
        expect(id).toBe(`memory-${s * 6 + z}`);
        expect(payload.id).toBe(id);
        if (memoryIndex < AUTHORED_N) {
          expect(payload.text).toEqual(MEMORIES[memoryIndex].text);
          expect(payload.imageUrl).toEqual(MEMORIES[memoryIndex].imageUrl ?? null);
        } else {
          expect(payload.text).toEqual([FUTURE_MEMORY_TEXT]);
          expect(payload.imageUrl).toBeNull();
        }
      }),
      { numRuns: 100 }
    );
  });
});
