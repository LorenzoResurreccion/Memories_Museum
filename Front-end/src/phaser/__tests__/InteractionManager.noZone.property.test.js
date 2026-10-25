// Feature: infinite-hallway, Property 11: No activation outside zones
// **Validates: Requirements 9.4**
//
// When the player overlaps NO registered interaction zone, pressing the Open_Key (E)
// emits nothing — regardless of how many times or how long E is pressed. Activation
// requires both a rising E edge AND an overlapping zone.

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

/** Mock scene: overlap always false (player overlaps nothing). */
function createNoOverlapScene(keyState) {
  return {
    physics: {
      overlap: vi.fn(() => false)
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

function makeZone(i = 0) {
  const zone = { x: 0, y: 0, width: 32, height: 32, type: 'zone' };
  return {
    zone,
    zoneIndex: i,
    memoryIndex: i,
    id: `memory-${i}`,
    payload: { id: `memory-${i}`, text: ['page'], imageUrl: null }
  };
}

const player = { x: 999, y: 999 };

describe('InteractionManager — Property 11: no activation outside zones', () => {
  /**
   * With zones registered but the player overlapping none, an arbitrary E press/release
   * sequence never emits. **Validates: Requirements 9.4**
   */
  it('never emits when the player overlaps no zone (with zones registered)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 0, max: 5 }), // number of registered (non-overlapping) zones
        (frames, zoneCount) => {
          const keyState = { down: false };
          const scene = createNoOverlapScene(keyState);
          const eventBus = createMockEventBus();

          const mgr = new InteractionManager(scene, eventBus);
          const zones = [];
          for (let i = 0; i < zoneCount; i++) {
            zones.push(makeZone(i));
          }
          mgr.addZones(zones);

          for (const down of frames) {
            keyState.down = down;
            mgr.checkInteraction(player);
          }

          expect(eventBus.emit).not.toHaveBeenCalled();
          // And the overlap predicate agrees: no zone is under the player.
          expect(mgr.isPlayerOverlappingZone(player)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * With NO zones registered at all, E likewise never emits. **Validates: Requirements 9.4**
   */
  it('never emits when there are no registered zones', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }), (frames) => {
        const keyState = { down: false };
        const scene = createNoOverlapScene(keyState);
        const eventBus = createMockEventBus();

        const mgr = new InteractionManager(scene, eventBus);

        for (const down of frames) {
          keyState.down = down;
          mgr.checkInteraction(player);
        }

        expect(eventBus.emit).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});
