import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom
vi.mock('phaser', () => ({}));

import PlayerController from '../PlayerController.js';

/**
 * Frame-layout tests for the 32×32 player spritesheet (128×128 = 4 columns × 4 rows).
 *
 * Phaser numbers frames row-major, so frame = row * 4 + column. Rows are
 * 0 = down, 1 = left, 2 = right, 3 = up; columns are neutral, step, neutral, step.
 * The old 16×32 sheet had 3 columns per row; reading a 4-column sheet with `row * 3`
 * math pulls frames from the wrong rows, so these tests pin the 4-per-row layout.
 */

const DIRECTIONS = ['down', 'left', 'right', 'up'];
const FRAMES_PER_ROW = 4;

/** Build a scene mock that records the animations PlayerController registers. */
function createScene() {
  return {
    input: { keyboard: { on: vi.fn() } },
    anims: {
      exists: vi.fn().mockReturnValue(false),
      create: vi.fn(),
      generateFrameNumbers: vi.fn((key, config) => {
        const frames = [];
        for (let i = config.start; i <= config.end; i++) {
          frames.push({ key, frame: i });
        }
        return frames;
      })
    }
  };
}

/** Create a controller and return the config of each registered animation by key. */
function registeredAnimations() {
  const scene = createScene();
  const sprite = { texture: { key: 'player' }, setVelocity: vi.fn(), anims: { play: vi.fn() } };
  new PlayerController(scene, sprite, 120);
  const byKey = {};
  for (const [config] of scene.anims.create.mock.calls) {
    byKey[config.key] = config;
  }
  return byKey;
}

describe('PlayerController — 32×32 sheet frame layout (4 columns per row)', () => {
  it('walks each direction across its whole 4-frame row; idle holds the first column', () => {
    const anims = registeredAnimations();

    // Hand-computed: down 0-3, left 4-7, right 8-11, up 12-15.
    const expectedRowStart = { down: 0, left: 4, right: 8, up: 12 };

    for (const dir of DIRECTIONS) {
      const start = expectedRowStart[dir];
      const walkFrames = anims[`player-walk-${dir}`].frames.map((f) => f.frame);
      expect(walkFrames).toEqual([start, start + 1, start + 2, start + 3]);

      const idleFrames = anims[`player-idle-${dir}`].frames.map((f) => f.frame);
      expect(idleFrames).toEqual([start]);
    }
  });

  it('property: every direction row maps to frames [row*4 .. row*4+3] and idles on row*4', () => {
    // Feature: player-sprite-32x32, Property: row-major frame mapping
    fc.assert(
      fc.property(fc.integer({ min: 0, max: DIRECTIONS.length - 1 }), (row) => {
        const anims = registeredAnimations();
        const dir = DIRECTIONS[row];

        const walk = anims[`player-walk-${dir}`].frames.map((f) => f.frame);
        const idle = anims[`player-idle-${dir}`].frames.map((f) => f.frame);

        // Walk covers exactly this row's four frames, in order, with no frame from
        // another row; idle is the row's first (neutral) frame.
        expect(walk).toEqual(
          Array.from({ length: FRAMES_PER_ROW }, (_, col) => row * FRAMES_PER_ROW + col)
        );
        expect(idle).toEqual([row * FRAMES_PER_ROW]);
        for (const frame of walk) {
          expect(Math.floor(frame / FRAMES_PER_ROW)).toBe(row);
        }
      }),
      { numRuns: 100 }
    );
  });
});
