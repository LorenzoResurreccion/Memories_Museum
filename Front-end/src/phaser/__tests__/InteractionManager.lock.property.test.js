// Feature: infinite-hallway, Property 12: No re-open while locked
// **Validates: Requirements 9.5**
//
// While the InteractionManager is locked (an overlay is open), no `hotspot-activated`
// event is emitted — no matter how many E rising edges occur or that the player is
// squarely over a zone. Unlocking restores normal activation.

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

function createMockScene(keyState, zone) {
  return {
    physics: {
      overlap: vi.fn((_player, z) => z === zone) // always overlapping the zone
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

function makeZone() {
  const zone = { x: 0, y: 0, width: 32, height: 32, type: 'zone' };
  return {
    zone,
    zoneIndex: 0,
    memoryIndex: 0,
    id: 'memory-0',
    payload: { id: 'memory-0', text: ['page'], imageUrl: null }
  };
}

const player = { x: 10, y: 10 };

describe('InteractionManager — Property 12: no re-open while locked', () => {
  /**
   * Locked for the entire run: an arbitrary E sequence over a zone emits nothing.
   * **Validates: Requirements 9.5**
   */
  it('emits nothing while locked, even over a zone with E edges', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), (frames) => {
        const keyState = { down: false };
        const zoneDesc = makeZone();
        const scene = createMockScene(keyState, zoneDesc.zone);
        const eventBus = createMockEventBus();

        const mgr = new InteractionManager(scene, eventBus);
        mgr.addZones([zoneDesc]);
        mgr.setLocked(true);

        for (const down of frames) {
          keyState.down = down;
          mgr.checkInteraction(player);
        }

        expect(eventBus.emit).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * A press that BEGINS during a lock must not fire the instant the manager unlocks:
   * the key has to be released and pressed again (a fresh rising edge after unlock).
   * This prevents a buffered press from leaking an activation. **Validates: Requirements 9.5**
   */
  it('a press held across unlock does not fire until a fresh edge after unlock', () => {
    const keyState = { down: false };
    const zoneDesc = makeZone();
    const scene = createMockScene(keyState, zoneDesc.zone);
    const eventBus = createMockEventBus();

    const mgr = new InteractionManager(scene, eventBus);
    mgr.addZones([zoneDesc]);

    // Lock, then press-and-hold E for several frames while locked.
    mgr.setLocked(true);
    keyState.down = true;
    mgr.checkInteraction(player);
    mgr.checkInteraction(player);
    expect(eventBus.emit).not.toHaveBeenCalled();

    // Unlock while E is STILL held — no fresh rising edge, so no emit.
    mgr.setLocked(false);
    mgr.checkInteraction(player);
    expect(eventBus.emit).not.toHaveBeenCalled();

    // Release, then press again => fresh rising edge => exactly one emit.
    keyState.down = false;
    mgr.checkInteraction(player);
    keyState.down = true;
    mgr.checkInteraction(player);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', expect.any(Object));
  });
});
