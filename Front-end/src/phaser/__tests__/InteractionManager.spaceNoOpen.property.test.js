// Feature: infinite-hallway, Property 13: Advance never opens
// **Validates: Requirements 9.2**
//
// Space (the dialogue ADVANCE / dismiss key) must never open an interaction. The
// InteractionManager's only open key is E; it reads E exclusively via
// `scene.input.keyboard.addKey('E')`. So when E is never pressed — no matter what other
// keys (Space/Enter/Esc) the player mashes while standing on a zone — no
// `hotspot-activated` event is emitted.
//
// We model "other keys" by driving a keyboard whose E key stays UP while arbitrary
// Space/Enter/Esc activity happens; we also assert the manager only ever asks for 'E',
// never Space/Enter/Esc.

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

/**
 * Mock scene: tracks which key codes were requested via addKey. Space/Enter/Esc may be
 * "down" per the provided state, but E is always up.
 */
function createMockScene(otherKeyState, zone) {
  const requestedKeys = [];
  const scene = {
    requestedKeys,
    physics: {
      overlap: vi.fn((_player, z) => z === zone) // always over the zone
    },
    input: {
      keyboard: {
        addKey: vi.fn((code) => {
          requestedKeys.push(code);
          if (code === 'E') {
            return { isDown: false }; // E never pressed
          }
          // Space / Enter / Esc, etc. — reflect the simulated "other key" state.
          return {
            get isDown() {
              return !!otherKeyState.down;
            }
          };
        })
      }
    }
  };
  return scene;
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

describe('InteractionManager — Property 13: advance (Space) never opens', () => {
  /**
   * With E never pressed and arbitrary Space/Enter/Esc activity over a zone, no emit
   * occurs, and the manager never requests any open key other than 'E'.
   * **Validates: Requirements 9.2**
   */
  it('never emits from Space/Enter/Esc; only ever reads the E key', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }), (otherFrames) => {
        const otherKeyState = { down: false };
        const zoneDesc = makeZone();
        const scene = createMockScene(otherKeyState, zoneDesc.zone);
        const eventBus = createMockEventBus();

        const mgr = new InteractionManager(scene, eventBus);
        mgr.addZones([zoneDesc]);

        for (const down of otherFrames) {
          otherKeyState.down = down; // simulate Space/Enter/Esc being mashed
          mgr.checkInteraction(player);
        }

        // No activation ever fired from non-E keys.
        expect(eventBus.emit).not.toHaveBeenCalled();

        // The manager only ever asked the keyboard for the 'E' key.
        for (const code of scene.requestedKeys) {
          expect(code).toBe('E');
        }
      }),
      { numRuns: 100 }
    );
  });
});
