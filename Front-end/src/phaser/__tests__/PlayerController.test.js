import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom
vi.mock('phaser', () => ({}));

import PlayerController from '../PlayerController.js';

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
    _keydownListeners: keydownListeners,
    _keyupListeners: keyupListeners,
    // Helper to simulate a keydown event
    pressKey(keyCode) {
      for (const handler of keydownListeners) {
        handler({ keyCode });
      }
    },
    // Helper to simulate a keyup event
    releaseKey(keyCode) {
      for (const handler of keyupListeners) {
        handler({ keyCode });
      }
    }
  };
}

/**
 * Helper: create a mock sprite with velocity and animation tracking.
 */
function createMockSprite() {
  return {
    texture: { key: 'player' },
    setVelocity: vi.fn(),
    anims: {
      play: vi.fn()
    }
  };
}

/**
 * Helper: create mock cursor keys (all up by default).
 */
function createMockCursors(overrides = {}) {
  return {
    up: { isDown: overrides.up || false },
    down: { isDown: overrides.down || false },
    left: { isDown: overrides.left || false },
    right: { isDown: overrides.right || false }
  };
}

/**
 * Helper: create mock WASD keys (all up by default).
 */
function createMockWasd(overrides = {}) {
  return {
    up: { isDown: overrides.up || false },
    down: { isDown: overrides.down || false },
    left: { isDown: overrides.left || false },
    right: { isDown: overrides.right || false }
  };
}

// Key codes
const KEY = {
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39,
  W: 87, S: 83, A: 65, D: 68
};

describe('PlayerController', () => {
  let scene, sprite, controller;

  beforeEach(() => {
    scene = createMockScene();
    sprite = createMockSprite();
    controller = new PlayerController(scene, sprite);
  });

  describe('constructor', () => {
    it('exports a class as default', () => {
      expect(PlayerController).toBeDefined();
      expect(typeof PlayerController).toBe('function');
    });

    it('accepts scene, sprite, and speed with default 120', () => {
      expect(controller.scene).toBe(scene);
      expect(controller.sprite).toBe(sprite);
      expect(controller.speed).toBe(120);
    });

    it('accepts custom speed', () => {
      const custom = new PlayerController(scene, sprite, 200);
      expect(custom.speed).toBe(200);
    });

    it('initializes as unfrozen', () => {
      expect(controller._frozen).toBe(false);
    });

    it('initializes facing direction as down', () => {
      expect(controller.getFacingDirection()).toBe('down');
    });

    it('sets up keyboard event listeners', () => {
      expect(scene.input.keyboard.on).toHaveBeenCalledWith('keydown', expect.any(Function));
      expect(scene.input.keyboard.on).toHaveBeenCalledWith('keyup', expect.any(Function));
    });

    it('creates animations for all four directions', () => {
      // 4 walk + 4 idle = 8 animations
      expect(scene.anims.create).toHaveBeenCalledTimes(8);
    });
  });

  describe('update() — cardinal movement', () => {
    it('sets velocity to (0, -speed) when up is held', () => {
      scene.pressKey(KEY.UP);
      const cursors = createMockCursors({ up: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(0, -120);
    });

    it('sets velocity to (0, speed) when down is held', () => {
      scene.pressKey(KEY.DOWN);
      const cursors = createMockCursors({ down: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(0, 120);
    });

    it('sets velocity to (-speed, 0) when left is held', () => {
      scene.pressKey(KEY.LEFT);
      const cursors = createMockCursors({ left: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(-120, 0);
    });

    it('sets velocity to (speed, 0) when right is held', () => {
      scene.pressKey(KEY.RIGHT);
      const cursors = createMockCursors({ right: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(120, 0);
    });

    it('sets velocity to (0, 0) when no keys are held', () => {
      controller.update(createMockCursors(), createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(0, 0);
    });

    it('works with WASD keys (W for up)', () => {
      scene.pressKey(KEY.W);
      const wasd = createMockWasd({ up: true });
      controller.update(createMockCursors(), wasd);

      expect(sprite.setVelocity).toHaveBeenCalledWith(0, -120);
    });

    it('works with WASD keys (A for left)', () => {
      scene.pressKey(KEY.A);
      const wasd = createMockWasd({ left: true });
      controller.update(createMockCursors(), wasd);

      expect(sprite.setVelocity).toHaveBeenCalledWith(-120, 0);
    });

    it('does NOT multiply velocity by deltaTime', () => {
      scene.pressKey(KEY.RIGHT);
      const cursors = createMockCursors({ right: true });
      controller.update(cursors, createMockWasd());

      // Velocity should be exactly the configured speed, not scaled by any delta
      expect(sprite.setVelocity).toHaveBeenCalledWith(120, 0);
      // Verify it was called with exactly those arguments (no third param)
      expect(sprite.setVelocity.mock.calls[0]).toEqual([120, 0]);
    });
  });

  describe('update() — most-recent-key-priority', () => {
    it('uses the most recently pressed key when multiple are held', () => {
      // Press right, then up — up should win
      scene.pressKey(KEY.RIGHT);
      scene.pressKey(KEY.UP);

      const cursors = createMockCursors({ right: true, up: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(0, -120);
    });

    it('falls back to previous key when most recent is released', () => {
      // Press right, then up
      scene.pressKey(KEY.RIGHT);
      scene.pressKey(KEY.UP);
      // Release up
      scene.releaseKey(KEY.UP);

      const cursors = createMockCursors({ right: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(120, 0);
    });

    it('ensures only one velocity component is non-zero (cardinal only)', () => {
      // Press all four directions
      scene.pressKey(KEY.UP);
      scene.pressKey(KEY.DOWN);
      scene.pressKey(KEY.LEFT);
      scene.pressKey(KEY.RIGHT);

      const cursors = createMockCursors({ up: true, down: true, left: true, right: true });
      controller.update(cursors, createMockWasd());

      const [vx, vy] = sprite.setVelocity.mock.calls[0];
      // Exactly one component is non-zero
      const nonZeroCount = (vx !== 0 ? 1 : 0) + (vy !== 0 ? 1 : 0);
      expect(nonZeroCount).toBe(1);
    });

    it('last pressed key wins among all four directions held', () => {
      scene.pressKey(KEY.UP);
      scene.pressKey(KEY.DOWN);
      scene.pressKey(KEY.LEFT);
      scene.pressKey(KEY.RIGHT); // Last pressed

      const cursors = createMockCursors({ up: true, down: true, left: true, right: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(120, 0);
    });
  });

  describe('freeze() / unfreeze()', () => {
    it('freeze() sets velocity to 0 and prevents movement', () => {
      controller.freeze();

      expect(sprite.setVelocity).toHaveBeenCalledWith(0, 0);

      // Try to move while frozen
      sprite.setVelocity.mockClear();
      scene.pressKey(KEY.RIGHT);
      const cursors = createMockCursors({ right: true });
      controller.update(cursors, createMockWasd());

      // update() should not change velocity while frozen
      expect(sprite.setVelocity).not.toHaveBeenCalled();
    });

    it('unfreeze() allows movement again', () => {
      controller.freeze();
      controller.unfreeze();

      scene.pressKey(KEY.LEFT);
      const cursors = createMockCursors({ left: true });
      controller.update(cursors, createMockWasd());

      expect(sprite.setVelocity).toHaveBeenCalledWith(-120, 0);
    });

    it('freeze() plays idle animation for current facing direction', () => {
      // Face right first
      scene.pressKey(KEY.RIGHT);
      controller.update(createMockCursors({ right: true }), createMockWasd());
      sprite.anims.play.mockClear();

      controller.freeze();

      expect(sprite.anims.play).toHaveBeenCalledWith('player-idle-right', true);
    });
  });

  describe('getFacingDirection()', () => {
    it('returns "down" initially', () => {
      expect(controller.getFacingDirection()).toBe('down');
    });

    it('returns last movement direction after moving up', () => {
      scene.pressKey(KEY.UP);
      controller.update(createMockCursors({ up: true }), createMockWasd());

      expect(controller.getFacingDirection()).toBe('up');
    });

    it('returns last movement direction after moving left', () => {
      scene.pressKey(KEY.LEFT);
      controller.update(createMockCursors({ left: true }), createMockWasd());

      expect(controller.getFacingDirection()).toBe('left');
    });

    it('preserves facing direction when no keys are held', () => {
      scene.pressKey(KEY.RIGHT);
      controller.update(createMockCursors({ right: true }), createMockWasd());
      scene.releaseKey(KEY.RIGHT);
      controller.update(createMockCursors(), createMockWasd());

      expect(controller.getFacingDirection()).toBe('right');
    });
  });

  describe('animations', () => {
    it('plays walk animation while moving', () => {
      scene.pressKey(KEY.DOWN);
      controller.update(createMockCursors({ down: true }), createMockWasd());

      expect(sprite.anims.play).toHaveBeenCalledWith('player-walk-down', true);
    });

    it('plays idle animation when stopped', () => {
      // Move then stop
      scene.pressKey(KEY.UP);
      controller.update(createMockCursors({ up: true }), createMockWasd());
      sprite.anims.play.mockClear();

      scene.releaseKey(KEY.UP);
      controller.update(createMockCursors(), createMockWasd());

      expect(sprite.anims.play).toHaveBeenCalledWith('player-idle-up', true);
    });

    it('plays correct idle frame per direction on stop', () => {
      scene.pressKey(KEY.LEFT);
      controller.update(createMockCursors({ left: true }), createMockWasd());
      sprite.anims.play.mockClear();

      scene.releaseKey(KEY.LEFT);
      controller.update(createMockCursors(), createMockWasd());

      expect(sprite.anims.play).toHaveBeenCalledWith('player-idle-left', true);
    });

    it('creates walk animations at 8fps', () => {
      const walkCalls = scene.anims.create.mock.calls.filter(
        call => call[0].key.includes('walk')
      );
      for (const call of walkCalls) {
        expect(call[0].frameRate).toBe(8);
      }
    });

    it('creates animations for all four directions', () => {
      const animKeys = scene.anims.create.mock.calls.map(call => call[0].key);
      expect(animKeys).toContain('player-walk-down');
      expect(animKeys).toContain('player-walk-left');
      expect(animKeys).toContain('player-walk-right');
      expect(animKeys).toContain('player-walk-up');
      expect(animKeys).toContain('player-idle-down');
      expect(animKeys).toContain('player-idle-left');
      expect(animKeys).toContain('player-idle-right');
      expect(animKeys).toContain('player-idle-up');
    });
  });

  describe('edge cases', () => {
    it('handles null cursors gracefully', () => {
      expect(() => {
        controller.update(null, createMockWasd());
      }).not.toThrow();
    });

    it('handles null wasd gracefully', () => {
      expect(() => {
        controller.update(createMockCursors(), null);
      }).not.toThrow();
    });

    it('handles sprite without anims property', () => {
      const bareSprite = { setVelocity: vi.fn(), texture: { key: 'player' } };
      // Need a scene without anims for this edge case
      const bareScene = {
        input: { keyboard: { on: vi.fn() } },
        anims: null
      };
      const ctrl = new PlayerController(bareScene, bareSprite);

      scene.pressKey(KEY.UP);
      // Use the controller's own internal key stack by directly manipulating it
      ctrl._keyStack.push('up');

      expect(() => {
        ctrl.update(createMockCursors({ up: true }), createMockWasd());
      }).not.toThrow();
    });
  });
});
