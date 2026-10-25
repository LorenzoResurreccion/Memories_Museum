// Feature: infinite-hallway, Property 15: Camera never reveals pre-start space —
// with the left bound set at the Start_Map left edge, the camera's visible left edge
// SHALL never be less than the left edge of the Start_Map.
// **Validates: Requirements 10.3**

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock Phaser's Scene so GameScene can be constructed headlessly (same style as the
// sibling GameScene.test.js).
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config.key;
    }
  }
}));

// The bounded-hallway subsystems GameScene imports are irrelevant here; stub them so
// importing GameScene never pulls their real implementations.
vi.mock('../PlayerController.js', () => ({ default: class {} }));
vi.mock('../CollisionBuilder.js', () => ({ default: class {} }));
vi.mock('../SegmentManager.js', () => ({ default: class {} }));
vi.mock('../InteractionManager.js', () => ({ default: class {} }));
vi.mock('../PromptLabel.js', () => ({ default: class {} }));

import GameScene from '../GameScene.js';

/** Segment width: 58 tiles * 16px. */
const SEGMENT_WIDTH_PX = 58 * 16;

/**
 * Build a GameScene with injected hallway geometry and a spy camera so we can read the
 * bounds it applies. `startRightEdgeX` is the start-map right edge (== segment 0 left
 * edge); minX is always 0 (start-map left edge); maxX is the final segment right edge.
 */
function makeSceneWithGeometry({ startRightEdgeX, finalSegmentIndex, cameraHeight }) {
  const scene = new GameScene();
  scene._minX = 0;
  scene._startRightEdgeX = startRightEdgeX;
  scene._maxX = startRightEdgeX + finalSegmentIndex * SEGMENT_WIDTH_PX + SEGMENT_WIDTH_PX;
  scene._cameraHeight = cameraHeight;

  const calls = [];
  scene.cameras = {
    main: {
      setBounds: (x, y, w, h) => calls.push({ x, y, w, h })
    }
  };
  return { scene, calls };
}

describe('Property 15 — camera left bound never reveals pre-start space', () => {
  it('always pins the applied left bound at the start-map left edge (minX = 0)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16, max: 4096 }), // startRightEdgeX
        fc.integer({ min: 0, max: 40 }), // finalSegmentIndex
        fc.integer({ min: 0, max: 200 }), // current segmentCount (may exceed final)
        fc.integer({ min: 16, max: 2048 }), // cameraHeight
        (startRightEdgeX, finalSegmentIndex, segmentCount, cameraHeight) => {
          const { scene, calls } = makeSceneWithGeometry({
            startRightEdgeX,
            finalSegmentIndex,
            cameraHeight
          });
          scene.segmentManager = { segmentCount };

          scene._applyCameraBounds();

          expect(calls.length).toBe(1);
          const { x, y, w, h } = calls[0];
          // Left bound is the start-map left edge — the camera can never scroll left of it.
          expect(x).toBe(0);
          expect(x).toBeGreaterThanOrEqual(scene._minX);
          expect(y).toBe(0);
          expect(h).toBe(cameraHeight);
          // Width is non-negative so the right bound is never left of the left bound.
          expect(w).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('keeps the right bound within [startRightEdgeX, maxX] for any segment count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16, max: 4096 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 500 }),
        (startRightEdgeX, finalSegmentIndex, segmentCount) => {
          const { scene } = makeSceneWithGeometry({
            startRightEdgeX,
            finalSegmentIndex,
            cameraHeight: 240
          });
          scene.segmentManager = { segmentCount };

          const right = scene._cameraRightBound();

          // Never reveals space left of the start seam, never past the final segment.
          expect(right).toBeGreaterThanOrEqual(startRightEdgeX);
          expect(right).toBeLessThanOrEqual(scene._maxX);
        }
      ),
      { numRuns: 100 }
    );
  });
});
