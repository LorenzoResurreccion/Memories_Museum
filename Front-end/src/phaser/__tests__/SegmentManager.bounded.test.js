import { describe, it, expect } from 'vitest';

// Feature: infinite-hallway — example tests for SegmentManager bounded generation.
//
// Concrete, hand-picked scenarios (no fast-check) pinning the right-bound contract:
//   - With N authored memories, driving fully right generates no index > finalSegmentIndex
//     and keeps segmentCount <= finalSegmentIndex + 1.
//   - N == 0 edge case: exactly one segment (index 0), nothing to its right, and all 6
//     of that segment's zones resolve to the future-memory payload.
//
// SegmentManager imports no Phaser, so it is constructed directly with inert builder
// stubs. Zone resolution is a segment-build responsibility; the N==0 "all 6 zones
// future" assertion is verified against the pure resolveZonePayload used at build time.
//
// _Requirements: 3.3, 3.4, 4.7, 13.1, 13.2, 13.8_

import SegmentManager from '../SegmentManager.js';
import { resolveZonePayload } from '../memoryResolve.js';
import { MEMORIES, FUTURE_MEMORY_TEXT } from '../../data/memories.js';

const SEGMENT_WIDTH = 58 * 16; // 928
const FAR_RIGHT = Number.MAX_SAFE_INTEGER / 2;

function authoredCount() {
  return MEMORIES instanceof Map ? MEMORIES.size : Object.keys(MEMORIES).length;
}

function makeManager(authoredMemoryCount) {
  const built = [];
  const mgr = new SegmentManager({
    startRightEdgeX: 0,
    segmentWidthPx: SEGMENT_WIDTH,
    authoredMemoryCount,
    maxLoaded: 3,
    generateAheadPx: SEGMENT_WIDTH,
    buildSegment: (index, worldOffsetX) => {
      built.push(index);
      return { index, worldOffsetX };
    },
    releaseSegment: () => {}
  });
  return { mgr, built };
}

describe('SegmentManager — bounded generation (example tests)', () => {
  it('derives finalSegmentIndex = floor((N-1)/6) and never generates past it (N = 8)', () => {
    // N = 8 => floor(7/6) = 1. Two segments total (indices 0 and 1).
    const { mgr, built } = makeManager(8);
    expect(mgr.finalSegmentIndex).toBe(1);

    // Drive the player arbitrarily far right.
    mgr.update(FAR_RIGHT);

    // No index beyond the bound was ever built.
    expect(Math.max(...built)).toBe(1);
    expect(built.every((i) => i >= 0 && i <= 1)).toBe(true);

    // Count capped at finalSegmentIndex + 1.
    expect(mgr.segmentCount).toBe(2);
    expect(mgr.segmentCount).toBeLessThanOrEqual(mgr.finalSegmentIndex + 1);

    // No loaded index exceeds the bound.
    for (const idx of mgr.loadedWindow.keys()) {
      expect(idx).toBeLessThanOrEqual(1);
    }
  });

  it('derives finalSegmentIndex = 2 for N = 13 and caps count at 3', () => {
    // N = 13 => floor(12/6) = 2. Three segments (0,1,2).
    const { mgr, built } = makeManager(13);
    expect(mgr.finalSegmentIndex).toBe(2);

    mgr.update(FAR_RIGHT);

    expect(Math.max(...built)).toBe(2);
    expect(mgr.segmentCount).toBe(3);
    expect(mgr.segmentCount).toBeLessThanOrEqual(mgr.finalSegmentIndex + 1);
  });

  it('uses the real manifest N and stays within its bound when driven fully right', () => {
    const n = authoredCount();
    const expectedFinal = n >= 1 ? Math.floor((n - 1) / 6) : 0;

    const { mgr, built } = makeManager(n);
    expect(mgr.finalSegmentIndex).toBe(expectedFinal);

    mgr.update(FAR_RIGHT);

    expect(built.every((i) => i >= 0 && i <= expectedFinal)).toBe(true);
    expect(mgr.segmentCount).toBe(expectedFinal + 1);
  });

  it('N == 0: exactly one segment (index 0), nothing to its right', () => {
    const { mgr, built } = makeManager(0);

    // finalSegmentIndex collapses to 0 (Req 13.2).
    expect(mgr.finalSegmentIndex).toBe(0);

    // Even pushed fully right, only index 0 exists; nothing generated to its right.
    mgr.update(FAR_RIGHT);

    expect(built).toEqual([0]);
    expect(mgr.segmentCount).toBe(1);
    expect([...mgr.loadedWindow.keys()]).toEqual([0]);
  });

  it('N == 0: all 6 zones of segment 0 resolve to the future-memory payload', () => {
    // Zone resolution is the build step's job; verify the pure resolver the builder
    // uses yields the future payload for every zone of segment 0 when N = 0 (Req 13.8).
    for (let zoneIndex = 0; zoneIndex < 6; zoneIndex++) {
      const { id, memoryIndex, payload } = resolveZonePayload(0, zoneIndex, MEMORIES, 0);

      expect(memoryIndex).toBe(zoneIndex);
      expect(id).toBe(`memory-${zoneIndex}`);
      expect(payload.text).toEqual([FUTURE_MEMORY_TEXT]);
      expect(payload.imageUrl).toBeNull();
    }
  });
});
