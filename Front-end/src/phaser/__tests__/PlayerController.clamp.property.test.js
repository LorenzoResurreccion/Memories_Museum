import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

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

/**
 * Helper: create a mock scene with keyboard event tracking.
 * Mirrors the harness in PlayerController.test.js / PlayerController.property.test.js.
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
 * Helper: create a mock sprite with a mutable `x` and a physics `body.velocity`.
 * `setVelocity`/`setVelocityX` write through to `body.velocity` so the controller's
 * clamp (which reads `sprite.body.velocity.x` and zeroes it via `setVelocityX`) can
 * be driven end-to-end exactly as it runs in the real scene.
 */
function createMockSprite(startX = 0) {
  const sprite = {
    x: startX,
    texture: { key: 'player' },
    body: { velocity: { x: 0, y: 0 } },
    anims: { play: vi.fn() }
  };
  sprite.setVelocity = vi.fn((vx, vy) => {
    sprite.body.velocity.x = vx;
    sprite.body.velocity.y = vy;
  });
  sprite.setVelocityX = vi.fn((vx) => {
    sprite.body.velocity.x = vx;
  });
  return sprite;
}

/**
 * Helper: cursor/wasd keys with a single direction held.
 */
function cursorsHolding(dir) {
  return {
    up: { isDown: dir === 'up' },
    down: { isDown: dir === 'down' },
    left: { isDown: dir === 'left' },
    right: { isDown: dir === 'right' }
  };
}

const emptyKeys = () => ({
  up: { isDown: false },
  down: { isDown: false },
  left: { isDown: false },
  right: { isDown: false }
});

// ---------------------------------------------------------------------------
// Feature: infinite-hallway, Property 1: Left-boundary invariant
// Player X never < minX; leftward input at minX leaves X unchanged (and the
// leftward velocity is zeroed).
// **Validates: Requirements 5.3, 5.4**
// ---------------------------------------------------------------------------
describe('Property 1: Left-boundary invariant', () => {
  // minX within a sane world range; player start spans below/within/above minX.
  const minXArb = fc.integer({ min: -500, max: 500 });
  const offsetArb = fc.integer({ min: -200, max: 400 }); // startX = minX + offset
  const speedArb = fc.integer({ min: 60, max: 240 });

  it('X never ends below minX for any start position while holding left', () => {
    fc.assert(
      fc.property(minXArb, offsetArb, speedArb, (minX, offset, speed) => {
        const scene = createMockScene();
        const sprite = createMockSprite(minX + offset);
        const controller = new PlayerController(scene, sprite, speed);
        // maxX kept at +Infinity so only the left bound is exercised.
        controller.setBounds(minX, undefined);

        // Hold left so update() resolves a leftward velocity, then clamps.
        scene.pressKey(KEY_CODES.left[0]);
        controller.update(cursorsHolding('left'), emptyKeys());

        expect(sprite.x).toBeGreaterThanOrEqual(minX);
      }),
      { numRuns: 100 }
    );
  });

  it('a player strictly left of minX is pinned to exactly minX and leftward velocity is zeroed', () => {
    // offset < 0 => start strictly left of minX, so the clamp fires and zeroes velocity.
    const leftOffsetArb = fc.integer({ min: -200, max: -1 });
    fc.assert(
      fc.property(minXArb, leftOffsetArb, speedArb, (minX, offset, speed) => {
        const scene = createMockScene();
        const sprite = createMockSprite(minX + offset);
        const controller = new PlayerController(scene, sprite, speed);
        controller.setBounds(minX, undefined);

        scene.pressKey(KEY_CODES.left[0]);
        controller.update(cursorsHolding('left'), emptyKeys());

        // Pinned to the boundary.
        expect(sprite.x).toBe(minX);
        // Leftward velocity (negative X) was zeroed when pushed past the edge.
        expect(sprite.body.velocity.x).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('leftward input exactly at minX leaves X unchanged across repeated updates', () => {
    fc.assert(
      fc.property(minXArb, speedArb, fc.integer({ min: 1, max: 8 }), (minX, speed, frames) => {
        const scene = createMockScene();
        const sprite = createMockSprite(minX); // exactly at the boundary
        const controller = new PlayerController(scene, sprite, speed);
        controller.setBounds(minX, undefined);

        scene.pressKey(KEY_CODES.left[0]);
        for (let i = 0; i < frames; i++) {
          controller.update(cursorsHolding('left'), emptyKeys());
          // X stays pinned every frame; never drifts below minX.
          expect(sprite.x).toBe(minX);
        }
        // The position invariant holds; X never goes below minX.
        expect(sprite.x).toBeGreaterThanOrEqual(minX);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: infinite-hallway, Property 6: Right-boundary invariant
// Player X never > maxX; rightward input at maxX leaves X unchanged (and the
// rightward velocity is zeroed).
// **Validates: Requirements 13.3**
// ---------------------------------------------------------------------------
describe('Property 6: Right-boundary invariant', () => {
  const maxXArb = fc.integer({ min: -500, max: 500 });
  const offsetArb = fc.integer({ min: -400, max: 200 }); // startX = maxX + offset
  const speedArb = fc.integer({ min: 60, max: 240 });

  it('X never ends above maxX for any start position while holding right', () => {
    fc.assert(
      fc.property(maxXArb, offsetArb, speedArb, (maxX, offset, speed) => {
        const scene = createMockScene();
        const sprite = createMockSprite(maxX + offset);
        const controller = new PlayerController(scene, sprite, speed);
        // minX kept at -Infinity so only the right bound is exercised.
        controller.setBounds(undefined, maxX);

        scene.pressKey(KEY_CODES.right[0]);
        controller.update(cursorsHolding('right'), emptyKeys());

        expect(sprite.x).toBeLessThanOrEqual(maxX);
      }),
      { numRuns: 100 }
    );
  });

  it('a player strictly right of maxX is pinned to exactly maxX and rightward velocity is zeroed', () => {
    // offset > 0 => start strictly right of maxX, so the clamp fires and zeroes velocity.
    const rightOffsetArb = fc.integer({ min: 1, max: 200 });
    fc.assert(
      fc.property(maxXArb, rightOffsetArb, speedArb, (maxX, offset, speed) => {
        const scene = createMockScene();
        const sprite = createMockSprite(maxX + offset);
        const controller = new PlayerController(scene, sprite, speed);
        controller.setBounds(undefined, maxX);

        scene.pressKey(KEY_CODES.right[0]);
        controller.update(cursorsHolding('right'), emptyKeys());

        expect(sprite.x).toBe(maxX);
        // Rightward velocity (positive X) was zeroed when pushed past the edge.
        expect(sprite.body.velocity.x).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('rightward input exactly at maxX leaves X unchanged across repeated updates', () => {
    fc.assert(
      fc.property(maxXArb, speedArb, fc.integer({ min: 1, max: 8 }), (maxX, speed, frames) => {
        const scene = createMockScene();
        const sprite = createMockSprite(maxX); // exactly at the boundary
        const controller = new PlayerController(scene, sprite, speed);
        controller.setBounds(undefined, maxX);

        scene.pressKey(KEY_CODES.right[0]);
        for (let i = 0; i < frames; i++) {
          controller.update(cursorsHolding('right'), emptyKeys());
          expect(sprite.x).toBe(maxX);
        }
        // The position invariant holds; X never goes above maxX.
        expect(sprite.x).toBeLessThanOrEqual(maxX);
      }),
      { numRuns: 100 }
    );
  });
});
