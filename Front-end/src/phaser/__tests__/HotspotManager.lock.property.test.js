// Feature: core-gameplay-mvp, Property 9: Overlay lock prevents activation
// For any state where a Dialogue_Box or Image_Viewer is currently displayed,
// and for any number of interaction key presses regardless of player position
// relative to hotspot zones, the system SHALL emit zero additional hotspot
// activation events until the overlay is dismissed.

// **Validates: Requirements 6.4**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import HotspotManager from '../HotspotManager.js';

/**
 * Helper: create a mock Phaser scene with zone creation and physics.
 * @param {object} options
 * @param {boolean} options.interactionKeyDown - Whether interaction key reports as pressed
 * @param {boolean} options.overlapAll - Whether physics.overlap returns true for all zones
 */
function createMockScene({ interactionKeyDown = true, overlapAll = true } = {}) {
  return {
    add: {
      zone: vi.fn((x, y, w, h) => ({ x, y, width: w, height: h, type: 'zone' }))
    },
    physics: {
      add: {
        existing: vi.fn()
      },
      overlap: vi.fn(() => overlapAll)
    },
    input: {
      keyboard: {
        addKey: vi.fn(() => ({ isDown: interactionKeyDown }))
      }
    }
  };
}

/**
 * Helper: create a mock EventBus.
 */
function createMockEventBus() {
  return { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
}

/**
 * Helper: build a Tiled-format hotspot object from structured data.
 */
function buildHotspotObject({ id, text, imageUrl, x, y, width, height }) {
  const properties = [
    { name: 'id', type: 'string', value: id },
    { name: 'text', type: 'string', value: text }
  ];
  if (imageUrl !== null && imageUrl !== undefined) {
    properties.push({ name: 'imageUrl', type: 'string', value: imageUrl });
  }
  return {
    name: `hotspot_${id}`,
    type: 'memory_hotspot',
    x, y, width, height,
    properties
  };
}

// --- Arbitraries ---

/** Arbitrary: a valid hotspot ID */
const hotspotIdArb = fc.stringMatching(/^[a-z0-9_]{1,20}$/);

/** Arbitrary: a valid text array serialized as JSON string */
const hotspotTextArb = fc.array(
  fc.string({ minLength: 1, maxLength: 30 }),
  { minLength: 1, maxLength: 5 }
).map((arr) => JSON.stringify(arr));

/** Arbitrary: optional imageUrl */
const imageUrlArb = fc.oneof(
  fc.constant(null),
  fc.constant('/assets/photos/placeholder.png')
);

/** Arbitrary: position and size */
const positionArb = fc.record({
  x: fc.integer({ min: 0, max: 2000 }),
  y: fc.integer({ min: 0, max: 2000 }),
  width: fc.integer({ min: 16, max: 128 }),
  height: fc.integer({ min: 16, max: 128 })
});

/** Arbitrary: number of hotspots to load (1–10) */
const hotspotCountArb = fc.integer({ min: 1, max: 10 });

/** Arbitrary: number of interaction attempts while locked (1–20) */
const attemptCountArb = fc.integer({ min: 1, max: 20 });

/** Arbitrary: a complete valid hotspot definition */
const validHotspotArb = fc.record({
  id: hotspotIdArb,
  text: hotspotTextArb,
  imageUrl: imageUrlArb,
  position: positionArb
});

/** Arbitrary: array of 1–10 valid hotspot definitions with unique IDs */
const hotspotArrayArb = fc.array(validHotspotArb, { minLength: 1, maxLength: 10 })
  .map((hotspots) => hotspots.map((h, i) => ({ ...h, id: `${h.id}_${i}` })));

describe('Property 9: Overlay lock prevents activation', () => {
  /** **Validates: Requirements 6.4** */

  let mockPlayer;

  beforeEach(() => {
    mockPlayer = { x: 100, y: 100, body: { width: 32, height: 32 } };
  });

  it('emits zero events when locked, regardless of interaction attempts count', () => {
    fc.assert(
      fc.property(hotspotArrayArb, attemptCountArb, (hotspotDefs, attempts) => {
        const eventBus = createMockEventBus();
        // Scene where interaction key is down and overlap returns true for all zones
        const scene = createMockScene({ interactionKeyDown: true, overlapAll: true });

        // Build Tiled objects
        const objects = hotspotDefs.map((h) =>
          buildHotspotObject({
            id: h.id,
            text: h.text,
            imageUrl: h.imageUrl,
            x: h.position.x,
            y: h.position.y,
            width: h.position.width,
            height: h.position.height
          })
        );

        const objectLayer = { objects };
        const manager = new HotspotManager(scene, objectLayer, eventBus);

        // Lock the manager (simulates overlay is active)
        manager.setLocked(true);

        // Perform N random interaction attempts while locked
        for (let i = 0; i < attempts; i++) {
          manager.checkInteraction(mockPlayer);
        }

        // Property: zero events emitted while locked
        expect(eventBus.emit).toHaveBeenCalledTimes(0);
      }),
      { numRuns: 100 }
    );
  });

  it('lock/unlock cycle: locked blocks events, unlocking allows exactly one, re-locking blocks again', () => {
    fc.assert(
      fc.property(
        hotspotArrayArb,
        attemptCountArb,
        attemptCountArb,
        (hotspotDefs, lockedAttempts, reLockedAttempts) => {
          const eventBus = createMockEventBus();
          const scene = createMockScene({ interactionKeyDown: true, overlapAll: true });

          const objects = hotspotDefs.map((h) =>
            buildHotspotObject({
              id: h.id,
              text: h.text,
              imageUrl: h.imageUrl,
              x: h.position.x,
              y: h.position.y,
              width: h.position.width,
              height: h.position.height
            })
          );

          const objectLayer = { objects };
          const manager = new HotspotManager(scene, objectLayer, eventBus);

          // Phase 1: Lock → N attempts → 0 emits
          manager.setLocked(true);
          for (let i = 0; i < lockedAttempts; i++) {
            manager.checkInteraction(mockPlayer);
          }
          expect(eventBus.emit).toHaveBeenCalledTimes(0);

          // Phase 2: Unlock → 1 attempt → 1 emit
          manager.setLocked(false);
          manager.checkInteraction(mockPlayer);
          expect(eventBus.emit).toHaveBeenCalledTimes(1);

          // Phase 3: Lock again → N attempts → still only 1 total emit
          manager.setLocked(true);
          for (let i = 0; i < reLockedAttempts; i++) {
            manager.checkInteraction(mockPlayer);
          }
          expect(eventBus.emit).toHaveBeenCalledTimes(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('locked state is unaffected by the number of hotspots loaded', () => {
    fc.assert(
      fc.property(hotspotCountArb, attemptCountArb, (count, attempts) => {
        const eventBus = createMockEventBus();
        const scene = createMockScene({ interactionKeyDown: true, overlapAll: true });

        // Generate `count` hotspot objects
        const objects = Array.from({ length: count }, (_, i) =>
          buildHotspotObject({
            id: `hotspot_${i}`,
            text: JSON.stringify([`Memory ${i}`]),
            imageUrl: null,
            x: i * 100,
            y: i * 100,
            width: 32,
            height: 32
          })
        );

        const objectLayer = { objects };
        const manager = new HotspotManager(scene, objectLayer, eventBus);

        expect(manager.hotspots).toHaveLength(count);

        // Lock and attempt interactions
        manager.setLocked(true);
        for (let i = 0; i < attempts; i++) {
          manager.checkInteraction(mockPlayer);
        }

        // Property: zero events regardless of hotspot count
        expect(eventBus.emit).toHaveBeenCalledTimes(0);
      }),
      { numRuns: 100 }
    );
  });
});
