// Feature: infinite-hallway, Property 10: Single activation per press
// **Validates: Requirements 9.3**
//
// The Open_Key (E) is edge-detected: within a single discrete press cycle (E held down
// across one or more consecutive frames, then released for at least one frame), at most
// ONE `hotspot-activated` event is emitted. Holding E does not re-fire; a new emit
// requires a fresh rising edge (release then press again).
//
// InteractionManager reads the E key via `scene.input.keyboard.addKey('E')` each frame
// and queries overlap via `scene.physics.overlap`. We mock Phaser at module level and
// drive the key's `isDown` frame-by-frame.

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import InteractionManager from '../InteractionManager.js';

/** A mock scene whose single E key reads from a mutable `keyState.down`. */
function createMockScene(keyState, zone) {
  return {
    physics: {
      // Player always overlaps the one registered zone in this test.
      overlap: vi.fn((_player, z) => z === zone)
    },
    input: {
      keyboard: {
        addKey: vi.fn(() => ({
          get isDown() {
            return keyState.down;
          }
        }))
      }
    }
  };
}

function createMockEventBus() {
  return { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
}

/** One registered, resolved zone descriptor with a non-empty payload. */
function makeZone() {
  const zone = { x: 0, y: 0, width: 32, height: 32, type: 'zone' };
  return {
    zone,
    zoneIndex: 0,
    memoryIndex: 0,
    id: 'memory-0',
    payload: { id: 'memory-0', text: ['hello'], imageUrl: null }
  };
}

const player = { x: 10, y: 10 };

describe('InteractionManager — Property 10: single activation per press', () => {
  /**
   * Over an arbitrary sequence of per-frame E states (true = down), the number of
   * emits equals the number of rising edges (false/undefined -> true transitions),
   * and never exceeds the number of discrete presses. A run of consecutive `down`
   * frames yields exactly one emit. **Validates: Requirements 9.3**
   */
  it('emits exactly once per rising edge, never on held frames', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        (frames) => {
          const keyState = { down: false };
          const zoneDesc = makeZone();
          const scene = createMockScene(keyState, zoneDesc.zone);
          const eventBus = createMockEventBus();

          const mgr = new InteractionManager(scene, eventBus);
          mgr.addZones([zoneDesc]);

          // Count rising edges in the frame sequence (previous frame starts "up").
          let expectedEmits = 0;
          let prev = false;
          for (const down of frames) {
            if (down && !prev) {
              expectedEmits++;
            }
            prev = down;
          }

          // Drive the manager frame-by-frame.
          for (const down of frames) {
            keyState.down = down;
            mgr.checkInteraction(player);
          }

          expect(eventBus.emit).toHaveBeenCalledTimes(expectedEmits);
          // Every emit is the activation event.
          for (const call of eventBus.emit.mock.calls) {
            expect(call[0]).toBe('hotspot-activated');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * A single uninterrupted hold (N consecutive down-frames) fires exactly once,
   * regardless of how long it is held. **Validates: Requirements 9.3**
   */
  it('a single continuous hold of any length fires exactly one activation', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (holdFrames) => {
        const keyState = { down: false };
        const zoneDesc = makeZone();
        const scene = createMockScene(keyState, zoneDesc.zone);
        const eventBus = createMockEventBus();

        const mgr = new InteractionManager(scene, eventBus);
        mgr.addZones([zoneDesc]);

        for (let i = 0; i < holdFrames; i++) {
          keyState.down = true;
          mgr.checkInteraction(player);
        }

        expect(eventBus.emit).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});
