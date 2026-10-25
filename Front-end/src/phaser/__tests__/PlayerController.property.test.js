import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// Feature: core-gameplay-mvp, Property 1: Cardinal-only movement with priority resolution
// For any combination of simultaneously held directional input keys (up, down, left, right),
// the resulting velocity vector SHALL have exactly one non-zero component (either X or Y,
// never both), ensuring strictly cardinal movement with no diagonal motion. When multiple
// keys are held, the most recently pressed key SHALL determine the movement direction.

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom
vi.mock('phaser', () => ({}));

import PlayerController from '../PlayerController.js';

// Key codes matching PlayerController's internal mapping
const KEY_CODES = {
  up: [38, 87],    // UP arrow, W
  down: [40, 83],  // DOWN arrow, S
  left: [37, 65],  // LEFT arrow, A
  right: [39, 68]  // RIGHT arrow, D
};

const DIRECTIONS = ['up', 'down', 'left', 'right'];

/**
 * Helper: create a mock scene with keyboard event tracking.
 */
function createMockScene() {
  const keydownListeners = [];
  const keyupListeners = [];

  return {
    input: {
      keyboard: {
        on: vi.fn((event, handler) => {
          if (event === 'keydown') keydownListeners.push(handler);
          if (event === 'keyup') keyupListeners.push(handler);
        })
      }
    },
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
    },
    pressKey(keyCode) {
      for (const handler of keydownListeners) {
        handler({ keyCode });
      }
    },
    releaseKey(keyCode) {
      for (const handler of keyupListeners) {
        handler({ keyCode });
      }
    }
  };
}

/**
 * Helper: create a mock sprite.
 */
function createMockSprite() {
  return {
    texture: { key: 'player' },
    setVelocity: vi.fn(),
    anims: { play: vi.fn() }
  };
}

/**
 * Arbitrary: a non-empty subset of directions (1–4 directions held simultaneously).
 */
const heldDirectionsArb = fc.uniqueArray(
  fc.constantFrom(...DIRECTIONS),
  { minLength: 1, maxLength: 4 }
);

/**
 * Arbitrary: a permutation representing the order keys were pressed.
 * The array contains the directions in the order they were pressed
 * (last element = most recently pressed).
 */
const pressOrderArb = fc.shuffledSubarray(DIRECTIONS, { minLength: 1, maxLength: 4 });

/**
 * Arbitrary: choose between arrow key or WASD for each direction.
 * Index 0 = arrow, index 1 = WASD.
 */
const keyVariantArb = fc.integer({ min: 0, max: 1 });

/**
 * Arbitrary: a random speed within the valid range.
 */
const speedArb = fc.integer({ min: 60, max: 240 });

describe('Property 1: Cardinal-only movement with priority resolution', () => {
  it('velocity has exactly one non-zero component for any combination of held keys', () => {
    fc.assert(
      fc.property(
        pressOrderArb,
        speedArb,
        fc.array(keyVariantArb, { minLength: 4, maxLength: 4 }),
        (pressOrder, speed, keyVariants) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          // Simulate pressing keys in the given order
          for (const dir of pressOrder) {
            const dirIndex = DIRECTIONS.indexOf(dir);
            const keyCode = KEY_CODES[dir][keyVariants[dirIndex]];
            scene.pressKey(keyCode);
          }

          // Build cursors/wasd state reflecting all pressed keys as held
          const heldSet = new Set(pressOrder);
          const cursors = {
            up: { isDown: heldSet.has('up') },
            down: { isDown: heldSet.has('down') },
            left: { isDown: heldSet.has('left') },
            right: { isDown: heldSet.has('right') }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          controller.update(cursors, wasd);

          // Extract the velocity that was set
          expect(sprite.setVelocity).toHaveBeenCalled();
          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // Property: exactly one component is non-zero (cardinal only, no diagonal)
          const nonZeroCount = (vx !== 0 ? 1 : 0) + (vy !== 0 ? 1 : 0);
          expect(nonZeroCount).toBe(1);

          // The non-zero component must have magnitude equal to the configured speed
          expect(Math.abs(vx) + Math.abs(vy)).toBe(speed);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('most recently pressed key determines movement direction', () => {
    fc.assert(
      fc.property(
        pressOrderArb,
        speedArb,
        (pressOrder, speed) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          // Simulate pressing keys in the given order
          for (const dir of pressOrder) {
            const keyCode = KEY_CODES[dir][0]; // Use arrow keys
            scene.pressKey(keyCode);
          }

          // All pressed keys are held
          const heldSet = new Set(pressOrder);
          const cursors = {
            up: { isDown: heldSet.has('up') },
            down: { isDown: heldSet.has('down') },
            left: { isDown: heldSet.has('left') },
            right: { isDown: heldSet.has('right') }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          controller.update(cursors, wasd);

          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // The most recently pressed key (last in pressOrder) should determine direction
          const expectedDir = pressOrder[pressOrder.length - 1];
          switch (expectedDir) {
            case 'up':
              expect(vx).toBe(0);
              expect(vy).toBe(-speed);
              break;
            case 'down':
              expect(vx).toBe(0);
              expect(vy).toBe(speed);
              break;
            case 'left':
              expect(vx).toBe(-speed);
              expect(vy).toBe(0);
              break;
            case 'right':
              expect(vx).toBe(speed);
              expect(vy).toBe(0);
              break;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('releasing the most recent key falls back to the previous key in press order', () => {
    fc.assert(
      fc.property(
        // Need at least 2 keys to test fallback
        fc.shuffledSubarray(DIRECTIONS, { minLength: 2, maxLength: 4 }),
        speedArb,
        (pressOrder, speed) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          // Press all keys in order
          for (const dir of pressOrder) {
            scene.pressKey(KEY_CODES[dir][0]);
          }

          // Release the most recent key
          const releasedDir = pressOrder[pressOrder.length - 1];
          scene.releaseKey(KEY_CODES[releasedDir][0]);

          // Build held state: all except the released key
          const heldSet = new Set(pressOrder.slice(0, -1));
          const cursors = {
            up: { isDown: heldSet.has('up') },
            down: { isDown: heldSet.has('down') },
            left: { isDown: heldSet.has('left') },
            right: { isDown: heldSet.has('right') }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          controller.update(cursors, wasd);

          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // Should fall back to the second-to-last pressed key
          const expectedDir = pressOrder[pressOrder.length - 2];
          switch (expectedDir) {
            case 'up':
              expect(vx).toBe(0);
              expect(vy).toBe(-speed);
              break;
            case 'down':
              expect(vx).toBe(0);
              expect(vy).toBe(speed);
              break;
            case 'left':
              expect(vx).toBe(-speed);
              expect(vy).toBe(0);
              break;
            case 'right':
              expect(vx).toBe(speed);
              expect(vy).toBe(0);
              break;
          }

          // Still cardinal: exactly one non-zero component
          const nonZeroCount = (vx !== 0 ? 1 : 0) + (vy !== 0 ? 1 : 0);
          expect(nonZeroCount).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('velocity magnitude always equals the configured speed when any key is held', () => {
    fc.assert(
      fc.property(
        pressOrderArb,
        speedArb,
        (pressOrder, speed) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          // Press keys
          for (const dir of pressOrder) {
            scene.pressKey(KEY_CODES[dir][0]);
          }

          const heldSet = new Set(pressOrder);
          const cursors = {
            up: { isDown: heldSet.has('up') },
            down: { isDown: heldSet.has('down') },
            left: { isDown: heldSet.has('left') },
            right: { isDown: heldSet.has('right') }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          controller.update(cursors, wasd);

          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // Magnitude of the velocity vector must equal speed exactly
          // Since movement is cardinal-only, one component is 0 and the other is ±speed
          const magnitude = Math.abs(vx) + Math.abs(vy);
          expect(magnitude).toBe(speed);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('WASD and arrow keys for the same direction resolve identically', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...DIRECTIONS),
        speedArb,
        (dir, speed) => {
          // Test with arrow key
          const scene1 = createMockScene();
          const sprite1 = createMockSprite();
          const ctrl1 = new PlayerController(scene1, sprite1, speed);
          scene1.pressKey(KEY_CODES[dir][0]); // Arrow key

          const cursors1 = {
            up: { isDown: dir === 'up' },
            down: { isDown: dir === 'down' },
            left: { isDown: dir === 'left' },
            right: { isDown: dir === 'right' }
          };
          ctrl1.update(cursors1, { up: { isDown: false }, down: { isDown: false }, left: { isDown: false }, right: { isDown: false } });

          // Test with WASD key
          const scene2 = createMockScene();
          const sprite2 = createMockSprite();
          const ctrl2 = new PlayerController(scene2, sprite2, speed);
          scene2.pressKey(KEY_CODES[dir][1]); // WASD key

          const wasd2 = {
            up: { isDown: dir === 'up' },
            down: { isDown: dir === 'down' },
            left: { isDown: dir === 'left' },
            right: { isDown: dir === 'right' }
          };
          ctrl2.update({ up: { isDown: false }, down: { isDown: false }, left: { isDown: false }, right: { isDown: false } }, wasd2);

          // Both should produce identical velocity
          const [vx1, vy1] = sprite1.setVelocity.mock.calls[0];
          const [vx2, vy2] = sprite2.setVelocity.mock.calls[0];
          expect(vx1).toBe(vx2);
          expect(vy1).toBe(vy2);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// Feature: core-gameplay-mvp, Property 2: Frame-rate-independent displacement
// For any configured speed within the valid range (60–240 px/s), and for any cardinal
// direction, the velocity set on the sprite body SHALL equal the configured speed constant
// exactly (not speed × deltaTime). Phaser's Arcade Physics handles frame-rate-independent
// integration internally — PlayerController must pass flat velocity values.

describe('Property 2: Frame-rate-independent displacement', () => {
  /**
   * **Validates: Requirements 3.4**
   */

  /**
   * Arbitrary: a random speed within the valid configurable range.
   */
  const speedArb = fc.integer({ min: 60, max: 240 });

  /**
   * Arbitrary: a random direction.
   */
  const directionArb = fc.constantFrom('up', 'down', 'left', 'right');

  /**
   * Arbitrary: a random positive deltaTime value (in seconds) to simulate various frame rates.
   * Ranges from 1ms to 200ms (covering 5fps to 1000fps scenarios).
   */
  const deltaTimeArb = fc.double({ min: 0.001, max: 0.2, noNaN: true });

  it('velocity set on sprite equals the configured speed constant, not speed × deltaTime', () => {
    fc.assert(
      fc.property(
        speedArb,
        directionArb,
        deltaTimeArb,
        (speed, direction, deltaTime) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          // Simulate pressing the key for the chosen direction
          const keyCode = KEY_CODES[direction][0];
          scene.pressKey(keyCode);

          // Build input state with only the target direction held
          const cursors = {
            up: { isDown: direction === 'up' },
            down: { isDown: direction === 'down' },
            left: { isDown: direction === 'left' },
            right: { isDown: direction === 'right' }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          // Call update — note: the update method does NOT accept deltaTime
          // because Phaser handles integration. We pass only cursors and wasd.
          controller.update(cursors, wasd);

          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // The velocity must equal the flat speed constant, NOT speed * deltaTime
          const expectedVelocity = speed;
          const actualMagnitude = Math.abs(vx) + Math.abs(vy);

          // Property: magnitude equals the configured speed exactly
          expect(actualMagnitude).toBe(expectedVelocity);

          // Property: the velocity is NOT scaled by deltaTime
          // (if it were multiplied by delta, the magnitude would be speed * deltaTime)
          const incorrectScaledValue = speed * deltaTime;
          expect(actualMagnitude).not.toBeCloseTo(incorrectScaledValue, 5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('velocity components are exactly ±speed with no deltaTime scaling for all directions', () => {
    fc.assert(
      fc.property(
        speedArb,
        directionArb,
        (speed, direction) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          // Press key
          scene.pressKey(KEY_CODES[direction][0]);

          const cursors = {
            up: { isDown: direction === 'up' },
            down: { isDown: direction === 'down' },
            left: { isDown: direction === 'left' },
            right: { isDown: direction === 'right' }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          controller.update(cursors, wasd);

          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // Verify exact velocity values match the speed constant directly
          switch (direction) {
            case 'up':
              expect(vx).toBe(0);
              expect(vy).toBe(-speed);
              break;
            case 'down':
              expect(vx).toBe(0);
              expect(vy).toBe(speed);
              break;
            case 'left':
              expect(vx).toBe(-speed);
              expect(vy).toBe(0);
              break;
            case 'right':
              expect(vx).toBe(speed);
              expect(vy).toBe(0);
              break;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('update() method signature does not accept or use a deltaTime parameter', () => {
    fc.assert(
      fc.property(
        speedArb,
        directionArb,
        deltaTimeArb,
        (speed, direction, deltaTime) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          scene.pressKey(KEY_CODES[direction][0]);

          const cursors = {
            up: { isDown: direction === 'up' },
            down: { isDown: direction === 'down' },
            left: { isDown: direction === 'left' },
            right: { isDown: direction === 'right' }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          // Call update with various deltaTime values as a third argument
          // to prove the controller ignores any such parameter
          controller.update(cursors, wasd, deltaTime);

          const [vx, vy] = sprite.setVelocity.mock.calls[0];

          // Regardless of what deltaTime value was passed, velocity must be flat speed
          const magnitude = Math.abs(vx) + Math.abs(vy);
          expect(magnitude).toBe(speed);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('velocity remains constant across consecutive frames regardless of simulated frame timing', () => {
    fc.assert(
      fc.property(
        speedArb,
        directionArb,
        fc.array(deltaTimeArb, { minLength: 2, maxLength: 10 }),
        (speed, direction, deltaTimeSequence) => {
          const scene = createMockScene();
          const sprite = createMockSprite();
          const controller = new PlayerController(scene, sprite, speed);

          scene.pressKey(KEY_CODES[direction][0]);

          const cursors = {
            up: { isDown: direction === 'up' },
            down: { isDown: direction === 'down' },
            left: { isDown: direction === 'left' },
            right: { isDown: direction === 'right' }
          };
          const wasd = {
            up: { isDown: false },
            down: { isDown: false },
            left: { isDown: false },
            right: { isDown: false }
          };

          // Simulate multiple frames with varying deltaTime values
          for (const dt of deltaTimeSequence) {
            sprite.setVelocity.mockClear();
            controller.update(cursors, wasd, dt);

            const [vx, vy] = sprite.setVelocity.mock.calls[0];
            const magnitude = Math.abs(vx) + Math.abs(vy);

            // Every frame must set the same flat velocity regardless of frame timing
            expect(magnitude).toBe(speed);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
