// Feature: infinite-hallway, Property 8: Return-path consistency
// **Validates: Requirements 5.1, 5.5**
//
// Walking back left visits segment indices in exactly the reverse of the order they
// were visited walking right, terminating at the start map (index 0), and never holds
// an index < 0. Because segment placement is a deterministic function of index
// (worldOffsetForIndex), the "index the player stands within" at a given X is the same
// on the way out and the way back — so the return path is the mirror of the outbound
// path.
//
// SegmentManager imports no Phaser; builders are inert and deterministic (identical
// decor/zones per index), so a re-instantiated index rebuilds identically (Req 5.6).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import SegmentManager from '../SegmentManager.js';

const SEGMENT_WIDTH = 58 * 16; // 928
const START_RIGHT_EDGE = 320;

/** Index of the segment whose span contains world X (clamped at the start seam, >= 0). */
function indexAtX(mgr, x) {
  const rel = x - START_RIGHT_EDGE;
  const idx = Math.floor(rel / SEGMENT_WIDTH);
  return idx < 0 ? 0 : idx;
}

describe('SegmentManager — Property 8: return-path consistency', () => {
  /**
   * The sequence of distinct segment indices entered while walking right, then the
   * sequence entered while walking back left to the start, are exact reverses of each
   * other; the return path terminates at index 0 and never produces an index < 0.
   * Re-instantiated indices rebuild at the same deterministic world offset.
   * **Validates: Requirements 5.1, 5.5**
   */
  it('left path is the reverse of the right path and never holds a negative index', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 40 }), // finalSegmentIndex
        (finalSegmentIndex) => {
          const offsetsByIndex = new Map();

          const mgr = new SegmentManager({
            startRightEdgeX: START_RIGHT_EDGE,
            segmentWidthPx: SEGMENT_WIDTH,
            finalSegmentIndex,
            maxLoaded: 3,
            generateAheadPx: SEGMENT_WIDTH,
            buildSegment: (index, worldOffsetX) => {
              // Deterministic: a given index must always build at the same offset (Req 5.6).
              if (offsetsByIndex.has(index)) {
                expect(worldOffsetX).toBe(offsetsByIndex.get(index));
              } else {
                offsetsByIndex.set(index, worldOffsetX);
              }
              return { index, worldOffsetX };
            },
            releaseSegment: () => {}
          });

          // --- Walk right to the far end, recording distinct indices entered. ---
          const rightPath = [];
          const stepPx = Math.floor(SEGMENT_WIDTH / 2); // two samples per segment
          const maxX = START_RIGHT_EDGE + (finalSegmentIndex + 1) * SEGMENT_WIDTH;
          for (let x = START_RIGHT_EDGE; x <= maxX; x += stepPx) {
            mgr.update(x);
            const idx = Math.min(indexAtX(mgr, x), finalSegmentIndex);
            if (rightPath.length === 0 || rightPath[rightPath.length - 1] !== idx) {
              rightPath.push(idx);
            }
            // Never a negative index loaded (Req 5.5).
            for (const k of mgr.loadedWindow.keys()) {
              expect(k).toBeGreaterThanOrEqual(0);
            }
          }

          // --- Walk back left to the start, recording distinct indices entered. ---
          const leftPath = [];
          for (let x = maxX; x >= START_RIGHT_EDGE; x -= stepPx) {
            mgr.update(x);
            const idx = Math.min(indexAtX(mgr, x), finalSegmentIndex);
            if (leftPath.length === 0 || leftPath[leftPath.length - 1] !== idx) {
              leftPath.push(idx);
            }
            for (const k of mgr.loadedWindow.keys()) {
              expect(k).toBeGreaterThanOrEqual(0);
            }
          }

          // Return path is the reverse of the outbound path.
          expect(leftPath).toEqual([...rightPath].reverse());

          // It terminates at the start map (index 0).
          expect(leftPath[leftPath.length - 1]).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
