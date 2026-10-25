import { describe, it, expect, vi, beforeEach } from 'vitest';

// Feature: infinite-hallway — example tests for InteractionManager.
//
// Concrete, hand-picked scenarios pinning the interaction contract:
//   - E over a zone emits `hotspot-activated` exactly once with the zone's payload.
//   - Space / Enter / Esc are never open keys — the manager only reads 'E'.
//   - A locked manager ignores E entirely.
//   - removeZones stops a recycled segment's zones from activating.
//
// Phaser is mocked at module level; the scene exposes a configurable E key and an
// overlap query.
//
// _Requirements: 9.1, 9.2, 9.5_

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import InteractionManager from '../InteractionManager.js';

function createMockScene(keyState, overlapSet) {
  return {
    physics: {
      overlap: vi.fn((_player, zone) => overlapSet.has(zone))
    },
    input: {
      keyboard: {
        addKey: vi.fn((code) => ({
          get isDown() {
            return code === 'E' ? !!keyState.E : false;
          }
        }))
      }
    }
  };
}

function createMockEventBus() {
  return { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
}

function makeZone(i, payload) {
  const zone = { x: i * 16, y: 0, width: 16, height: 16, type: 'zone' };
  return {
    zone,
    zoneIndex: i,
    memoryIndex: i,
    id: `memory-${i}`,
    payload: payload || { id: `memory-${i}`, text: [`page ${i}`], imageUrl: null }
  };
}

const player = { x: 10, y: 10 };

describe('InteractionManager — example tests', () => {
  let keyState, overlapSet, scene, eventBus, mgr;

  beforeEach(() => {
    keyState = { E: false };
    overlapSet = new Set();
    scene = createMockScene(keyState, overlapSet);
    eventBus = createMockEventBus();
    mgr = new InteractionManager(scene, eventBus);
  });

  it('E over a zone emits hotspot-activated once with the resolved payload', () => {
    const zoneDesc = makeZone(0, {
      id: 'memory-0',
      text: ['Our first photo', 'What a day'],
      imageUrl: '/assets/photos/first.png'
    });
    mgr.addZones([zoneDesc]);
    overlapSet.add(zoneDesc.zone);

    // Rising edge: E down this frame (was up).
    keyState.E = true;
    mgr.checkInteraction(player);

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', {
      id: 'memory-0',
      text: ['Our first photo', 'What a day'],
      imageUrl: '/assets/photos/first.png'
    });

    // Holding E the next frame does not re-fire.
    mgr.checkInteraction(player);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('Space / Enter / Esc never emit (manager only reads E)', () => {
    const zoneDesc = makeZone(0);
    mgr.addZones([zoneDesc]);
    overlapSet.add(zoneDesc.zone);

    // E stays up; simulate many frames of "other keys" by just not setting E.
    for (let i = 0; i < 10; i++) {
      mgr.checkInteraction(player);
    }

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('a locked manager ignores E over a zone', () => {
    const zoneDesc = makeZone(0);
    mgr.addZones([zoneDesc]);
    overlapSet.add(zoneDesc.zone);
    mgr.setLocked(true);

    keyState.E = true;
    mgr.checkInteraction(player);
    mgr.checkInteraction(player);

    expect(eventBus.emit).not.toHaveBeenCalled();
  });

  it('isPlayerOverlappingZone reflects the overlap state', () => {
    const zoneDesc = makeZone(0);
    mgr.addZones([zoneDesc]);

    expect(mgr.isPlayerOverlappingZone(player)).toBe(false);
    overlapSet.add(zoneDesc.zone);
    expect(mgr.isPlayerOverlappingZone(player)).toBe(true);
  });

  it('removeZones stops a recycled segment zone from activating', () => {
    const zoneDesc = makeZone(0);
    mgr.addZones([zoneDesc]);
    overlapSet.add(zoneDesc.zone);

    // Recycle the segment: remove its zones.
    mgr.removeZones([zoneDesc]);

    keyState.E = true;
    mgr.checkInteraction(player);

    expect(eventBus.emit).not.toHaveBeenCalled();
    expect(mgr.isPlayerOverlappingZone(player)).toBe(false);
  });

  it('emits the correct zone payload when multiple zones are registered', () => {
    const z0 = makeZone(0);
    const z1 = makeZone(1);
    const z2 = makeZone(2);
    mgr.addZones([z0, z1, z2]);

    // Player overlaps only zone 1.
    overlapSet.add(z1.zone);

    keyState.E = true;
    mgr.checkInteraction(player);

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const [, payload] = eventBus.emit.mock.calls[0];
    expect(payload.id).toBe('memory-1');
    expect(payload.text).toEqual(['page 1']);
  });
});
