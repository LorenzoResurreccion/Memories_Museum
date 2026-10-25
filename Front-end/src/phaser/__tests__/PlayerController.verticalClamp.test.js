import { describe, it, expect, vi } from 'vitest';

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom
vi.mock('phaser', () => ({}));

import PlayerController from '../PlayerController.js';

// Key codes matching PlayerController's internal mapping (arrow keys first).
const KEY_CODES = {
  up: [38, 87],    // UP arrow, W
  down: [40, 83]   // DOWN arrow, S
};

/**
 * Helper: create a mock scene with keyboard event tracking.
 * Mirrors the harness in PlayerController.clamp.test.js.
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
      for (const handler of keydownListeners) handler({ keyCode });
    },
    releaseKey(keyCode) {
      for (const handler of keyupListeners) handler({ keyCode });
    }
  };
}

/**
 * Helper: mock sprite with a mutable `y` and a physics `body.velocity`.
 * `setVelocity`/`setVelocityY` write through so the vertical clamp (which reads
 * `sprite.body.velocity.y` and zeroes it via `setVelocityY`) runs end-to-end.
 */
function createMockSprite(startY = 0) {
  const sprite = {
    x: 0,
    y: startY,
    texture: { key: 'player' },
    body: { velocity: { x: 0, y: 0 } },
    anims: { play: vi.fn() }
  };
  sprite.setVelocity = vi.fn((vx, vy) => {
    sprite.body.velocity.x = vx;
    sprite.body.velocity.y = vy;
  });
  sprite.setVelocityY = vi.fn((vy) => {
    sprite.body.velocity.y = vy;
  });
  return sprite;
}

function cursorsHolding(dir) {
  return {
    up: { isDown: dir === 'up' },
    down: { isDown: dir === 'down' },
    left: { isDown: false },
    right: { isDown: false }
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
// Vertical floor clamp: the player's feet (feet-origin sprite, so sprite.y IS
// the feet position) must stay within the walkable floor band [minFeetY, maxFeetY].
// This keeps the character from stepping up onto the back wall or below the floor.
// Same strict-inequality nuance as the horizontal clamp: firing only when pushed
// STRICTLY past a bound.
// ---------------------------------------------------------------------------
describe('PlayerController vertical clamp — floor top (minFeetY)', () => {
  it('pins feet above the floor top back down to minFeetY and zeroes upward velocity', () => {
    const minFeetY = 160;
    const scene = createMockScene();
    const sprite = createMockSprite(150); // strictly above the floor top
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setVerticalBounds(minFeetY, 240);

    scene.pressKey(KEY_CODES.up[0]);
    controller.update(cursorsHolding('up'), emptyKeys());

    expect(sprite.y).toBe(160);
    expect(sprite.body.velocity.y).toBe(0);
  });

  it('leaves Y unchanged when holding up exactly at the floor top', () => {
    const minFeetY = 160;
    const scene = createMockScene();
    const sprite = createMockSprite(160); // exactly on the bound
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setVerticalBounds(minFeetY, 240);

    scene.pressKey(KEY_CODES.up[0]);
    controller.update(cursorsHolding('up'), emptyKeys());

    expect(sprite.y).toBe(160);
    expect(sprite.y).toBeGreaterThanOrEqual(minFeetY);
  });
});

describe('PlayerController vertical clamp — floor bottom (maxFeetY)', () => {
  it('pins feet below the floor bottom back up to maxFeetY and zeroes downward velocity', () => {
    const maxFeetY = 240;
    const scene = createMockScene();
    const sprite = createMockSprite(250); // strictly below the floor bottom
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setVerticalBounds(160, maxFeetY);

    scene.pressKey(KEY_CODES.down[0]);
    controller.update(cursorsHolding('down'), emptyKeys());

    expect(sprite.y).toBe(240);
    expect(sprite.body.velocity.y).toBe(0);
  });
});

describe('PlayerController vertical clamp — within the floor band', () => {
  it('does not alter Y or the resolved velocity when moving inside [minFeetY, maxFeetY]', () => {
    const minFeetY = 160;
    const maxFeetY = 240;
    const scene = createMockScene();
    const sprite = createMockSprite(200); // comfortably inside the band
    const controller = new PlayerController(scene, sprite, SPEED);
    controller.setVerticalBounds(minFeetY, maxFeetY);

    scene.pressKey(KEY_CODES.down[0]);
    controller.update(cursorsHolding('down'), emptyKeys());

    expect(sprite.y).toBe(200);
    expect(sprite.body.velocity.y).toBe(SPEED);
  });

  it('is a no-op by default (bounds -Infinity / +Infinity) so unbounded scenes are unaffected', () => {
    const scene = createMockScene();
    const sprite = createMockSprite(-1000); // far above any real floor
    const controller = new PlayerController(scene, sprite, SPEED);
    // No setVerticalBounds call — defaults leave the clamp inert.

    scene.pressKey(KEY_CODES.up[0]);
    controller.update(cursorsHolding('up'), emptyKeys());

    expect(sprite.y).toBe(-1000);
    expect(sprite.body.velocity.y).toBe(-SPEED);
  });
});
