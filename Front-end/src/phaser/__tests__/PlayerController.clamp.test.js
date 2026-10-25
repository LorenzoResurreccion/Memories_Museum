import { describe, it, expect, vi } from 'vitest';

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom
vi.mock('phaser', () => ({}));

import PlayerController from '../PlayerController.js';

// Key codes matching PlayerController's internal mapping (arrow keys first).
const KEY_CODES = {
  up: [38, 87],    // UP arrow, W
  down: [40, 83],  // DOWN arrow, S
  left: [37, 65],  // LEFT arrow, A
  right: [39, 68]  // RIGHT arrow, D
};

/**
 * Helper: create a mock scene with keyboard event tracking.
 * Mirrors the harness in PlayerController.test.js / PlayerController.clamp.property.test.js.
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

const SPEED = 120;

// ---------------------------------------------------------------------------
// Feature: infinite-hallway — example tests for the two-sided horizontal clamp.
// **Validates: Requirements 5.3, 5.4, 13.3**
//
// NUANCE (strict inequalities): the clamp in _applyHorizontalClamp() fires only
// when the sprite is pushed STRICTLY past a bound (x < minX or x > maxX). When the
// sprite sits EXACTLY on a bound (x === minX or x === maxX) the position stays
// unchanged and the velocity is NOT zeroed — there is nothing to pin back. The
// "velocity zeroed" guarantee is therefore exercised in the strictly-past cases
// below (the meaningful ones); the at-boundary cases assert X simply stays put.
// This matches the impl and the sibling PlayerController.clamp.property.test.js.
// ---------------------------------------------------------------------------
describe('PlayerController horizontal clamp — left bound (minX)', () => {
  it('pins a sprite strictly left of minX to minX and zeroes leftward velocity', () => {
    const minX = 100;
    const scene = createMockScene();
    const sprite = createMockSprite(90); // strictly left of minX
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setBounds(minX, undefined);

    scene.pressKey(KEY_CODES.left[0]);
    controller.update(cursorsHolding('left'), emptyKeys());

    // Pushed past the edge → pinned to the bound AND leftward velocity zeroed.
    expect(sprite.x).toBe(100);
    expect(sprite.body.velocity.x).toBe(0);
  });

  it('leaves X unchanged when holding left exactly at minX (strict-inequality nuance)', () => {
    const minX = 100;
    const scene = createMockScene();
    const sprite = createMockSprite(100); // exactly at the boundary
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setBounds(minX, undefined);

    scene.pressKey(KEY_CODES.left[0]);
    controller.update(cursorsHolding('left'), emptyKeys());

    // At the bound the clamp is a no-op: X stays, never dips below minX.
    expect(sprite.x).toBe(100);
    expect(sprite.x).toBeGreaterThanOrEqual(minX);
  });
});

describe('PlayerController horizontal clamp — right bound (maxX)', () => {
  it('pins a sprite strictly right of maxX to maxX and zeroes rightward velocity', () => {
    const maxX = 500;
    const scene = createMockScene();
    const sprite = createMockSprite(510); // strictly right of maxX
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setBounds(undefined, maxX);

    scene.pressKey(KEY_CODES.right[0]);
    controller.update(cursorsHolding('right'), emptyKeys());

    // Pushed past the edge → pinned to the bound AND rightward velocity zeroed.
    expect(sprite.x).toBe(500);
    expect(sprite.body.velocity.x).toBe(0);
  });

  it('leaves X unchanged when holding right exactly at maxX (strict-inequality nuance)', () => {
    const maxX = 500;
    const scene = createMockScene();
    const sprite = createMockSprite(500); // exactly at the boundary
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setBounds(undefined, maxX);

    scene.pressKey(KEY_CODES.right[0]);
    controller.update(cursorsHolding('right'), emptyKeys());

    // At the bound the clamp is a no-op: X stays, never exceeds maxX.
    expect(sprite.x).toBe(500);
    expect(sprite.x).toBeLessThanOrEqual(maxX);
  });
});

describe('PlayerController horizontal clamp — within bounds', () => {
  it('does not alter X or the resolved velocity when moving inside [minX, maxX]', () => {
    const minX = 0;
    const maxX = 500;
    const scene = createMockScene();
    const sprite = createMockSprite(250); // comfortably inside the bounds
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setBounds(minX, maxX);

    scene.pressKey(KEY_CODES.right[0]);
    controller.update(cursorsHolding('right'), emptyKeys());

    // Inside the bounds the clamp is a no-op: position untouched, resolved
    // rightward velocity (+speed) preserved, and X stays within [minX, maxX].
    expect(sprite.x).toBe(250);
    expect(sprite.body.velocity.x).toBe(SPEED);
    expect(sprite.x).toBeGreaterThanOrEqual(minX);
    expect(sprite.x).toBeLessThanOrEqual(maxX);
  });
});
