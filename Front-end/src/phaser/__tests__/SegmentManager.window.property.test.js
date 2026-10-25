// Feature: infinite-hallway, Property 7: Loaded-window bound
// **Validates: Requirements 3.6, 3.7**
//
// At most maxLoaded (3) Hallway_Segments are concurrently instantiated. No matter how
// the player moves (right, left, teleporting back and forth), SegmentManager.update
// keeps loadedWindow.size <= maxLoaded on every frame, recycling the furthest segment
// (behind when moving right, ahead when moving left) to stay within the cap.
//
// Recycle is observable through the injected releaseSegment callback: every recycled
// segment is released exactly once, and the net live set (built - released) matches
// loadedWindow.size.
//
// SegmentManager imports no Phaser; builders are inert stubs.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import SegmentManager from '../SegmentManager.js';

const SEGMENT_WIDTH = 58 * 16; // 928

describe('SegmentManager — Property 7: loaded-window bound', () => {
  /**
   * Over an arbitrary bidirectional movement sequence, the number of concurrently
   * instantiated segments never exceeds maxLoaded, and every released segment is a
   * previously-built one released exactly once (no double release, no leak beyond cap).
   * **Validates: Requirements 3.6, 3.7**
   */
  it('never holds more than maxLoaded segments at once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 60 }), // finalSegmentIndex (room to roam)
        fc.integer({ min: 1, max: 4 }), // maxLoaded
        // Signed steps so the player can wander both directions.
        fc.array(fc.integer({ min: -3000, max: 3000 }), { minLength: 1, maxLength: 120 }),
        (finalSegmentIndex, maxLoaded, steps) => {
          const built = [];
          const released = [];

          const mgr = new SegmentManager({
            startRightEdgeX: 0,
            segmentWidthPx: SEGMENT_WIDTH,
            finalSegmentIndex,
            maxLoaded,
            generateAheadPx: SEGMENT_WIDTH,
            buildSegment: (index, worldOffsetX) => {
              const seg = { index, worldOffsetX };
              built.push(index);
              return seg;
            },
            releaseSegment: (seg) => {
              released.push(seg.index);
            }
          });

          let x = 0;
          for (const step of steps) {
            x = Math.max(0, x + step);
            mgr.update(x);

            // Hard cap every frame (Req 3.6).
            expect(mgr.loadedWindow.size).toBeLessThanOrEqual(maxLoaded);

            // Live set = built - released, and matches the window size exactly.
            expect(built.length - released.length).toBe(mgr.loadedWindow.size);
          }

          // Every released index was one that had been built.
          for (const idx of released) {
            expect(built).toContain(idx);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
