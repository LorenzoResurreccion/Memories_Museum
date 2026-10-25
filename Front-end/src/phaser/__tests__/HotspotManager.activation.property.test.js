// Feature: core-gameplay-mvp, Property 8: Hotspot activation payload correctness
// For any Memory_Hotspot with associated data, when the Player_Sprite overlaps that
// hotspot's zone and the interaction key is pressed, the emitted event payload SHALL
// contain the exact id, text, and imageUrl from the hotspot's source data.

// **Validates: Requirements 6.2**

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
 * The overlap mock is configurable to simulate player overlapping specific zones.
 */
function createMockScene({ overlapZone = null, interactionKeyDown = true } = {}) {
  const scene = {
    add: {
      zone: vi.fn((x, y, w, h) => ({ x, y, width: w, height: h, type: 'zone' }))
    },
    physics: {
      add: {
        existing: vi.fn()
      },
      overlap: vi.fn((player, zone) => {
        // Return true only when the zone matches the target overlap zone
        if (overlapZone === null) return false;
        return zone === overlapZone;
      })
    },
    input: {
      keyboard: {
        addKey: vi.fn(() => ({ isDown: interactionKeyDown }))
      }
    }
  };
  return scene;
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
function buildHotspotObject({ id, text, imageUrl, x, y, width, height, name }) {
  const properties = [];
  if (id !== undefined) {
    properties.push({ name: 'id', type: 'string', value: id });
  }
  if (text !== undefined) {
    properties.push({ name: 'text', type: 'string', value: text });
  }
  if (imageUrl !== undefined && imageUrl !== null) {
    properties.push({ name: 'imageUrl', type: 'string', value: imageUrl });
  }
  return {
    name: name || `hotspot_${id}`,
    type: 'memory_hotspot',
    x, y, width, height,
    properties
  };
}

// --- Arbitraries ---

/**
 * Arbitrary: a valid hotspot ID (non-empty alphanumeric + underscore string).
 */
const hotspotIdArb = fc.stringMatching(/^[a-z0-9_]{1,20}$/);

/**
 * Arbitrary: a valid text array (1–5 non-empty strings) — the parsed form.
 */
const hotspotTextArrayArb = fc.array(
  fc.string({ minLength: 1, maxLength: 50 }),
  { minLength: 1, maxLength: 5 }
);

/**
 * Arbitrary: a valid text array serialized as JSON string.
 */
const hotspotTextArb = hotspotTextArrayArb.map((arr) => JSON.stringify(arr));

/**
 * Arbitrary: optional imageUrl (either null or a path-like string).
 */
const imageUrlArb = fc.oneof(
  fc.constant(null),
  fc.stringMatching(/^[a-z0-9/_\-.]{5,30}$/).map((s) => `/assets/photos/${s}.png`)
);

/**
 * Arbitrary: position and size values (positive integers for pixel coordinates).
 */
const positionArb = fc.record({
  x: fc.integer({ min: 0, max: 4000 }),
  y: fc.integer({ min: 0, max: 4000 }),
  width: fc.integer({ min: 16, max: 256 }),
  height: fc.integer({ min: 16, max: 256 })
});

/**
 * Arbitrary: a single valid hotspot definition with both raw text (JSON string) and parsed text array.
 */
const validHotspotWithParsedTextArb = fc.record({
  id: hotspotIdArb,
  textArray: hotspotTextArrayArb,
  imageUrl: imageUrlArb,
  position: positionArb
}).map((h) => ({
  ...h,
  textJson: JSON.stringify(h.textArray)
}));

describe('Property 8: Hotspot activation payload correctness', () => {
  /** **Validates: Requirements 6.2** */

  let mockPlayer;

  beforeEach(() => {
    mockPlayer = { x: 100, y: 100, body: { width: 32, height: 32 } };
  });

  it('emitted payload contains exact id, text, and imageUrl from the hotspot source data', () => {
    fc.assert(
      fc.property(validHotspotWithParsedTextArb, (hotspotDef) => {
        const eventBus = createMockEventBus();

        // Create the scene with interaction key down but overlap not yet configured
        const scene = createMockScene({ interactionKeyDown: true });

        // Build the Tiled object
        const tiledObject = buildHotspotObject({
          id: hotspotDef.id,
          text: hotspotDef.textJson,
          imageUrl: hotspotDef.imageUrl,
          x: hotspotDef.position.x,
          y: hotspotDef.position.y,
          width: hotspotDef.position.width,
          height: hotspotDef.position.height
        });

        const objectLayer = { objects: [tiledObject] };
        const manager = new HotspotManager(scene, objectLayer, eventBus);

        // The manager should have loaded one hotspot
        expect(manager.hotspots).toHaveLength(1);

        // Configure physics.overlap to return true for the loaded hotspot's zone
        const targetZone = manager.hotspots[0].zone;
        scene.physics.overlap.mockImplementation((player, zone) => zone === targetZone);

        // Call checkInteraction to simulate player overlap + key press
        manager.checkInteraction(mockPlayer);

        // Verify the event was emitted
        expect(eventBus.emit).toHaveBeenCalledTimes(1);
        expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', expect.any(Object));

        // Extract the emitted payload
        const [eventName, payload] = eventBus.emit.mock.calls[0];

        // Property: event name is correct
        expect(eventName).toBe('hotspot-activated');

        // Property: payload.id matches source id exactly
        expect(payload.id).toBe(hotspotDef.id);

        // Property: payload.text deep equals the parsed text array
        expect(payload.text).toEqual(hotspotDef.textArray);

        // Property: payload.imageUrl matches source imageUrl exactly (including null)
        expect(payload.imageUrl).toBe(hotspotDef.imageUrl);
      }),
      { numRuns: 100 }
    );
  });

  it('payload imageUrl is null when hotspot has no imageUrl property', () => {
    fc.assert(
      fc.property(
        hotspotIdArb,
        hotspotTextArrayArb,
        positionArb,
        (id, textArray, position) => {
          const eventBus = createMockEventBus();
          const scene = createMockScene({ interactionKeyDown: true });

          // Build hotspot WITHOUT imageUrl property
          const tiledObject = buildHotspotObject({
            id,
            text: JSON.stringify(textArray),
            imageUrl: undefined, // not included in properties
            x: position.x,
            y: position.y,
            width: position.width,
            height: position.height
          });

          const objectLayer = { objects: [tiledObject] };
          const manager = new HotspotManager(scene, objectLayer, eventBus);

          expect(manager.hotspots).toHaveLength(1);

          // Configure overlap to match
          const targetZone = manager.hotspots[0].zone;
          scene.physics.overlap.mockImplementation((player, zone) => zone === targetZone);

          manager.checkInteraction(mockPlayer);

          expect(eventBus.emit).toHaveBeenCalledTimes(1);
          const [, payload] = eventBus.emit.mock.calls[0];

          // Property: imageUrl is null when not provided
          expect(payload.imageUrl).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('only the overlapping hotspot payload is emitted when multiple hotspots exist', () => {
    fc.assert(
      fc.property(
        fc.array(validHotspotWithParsedTextArb, { minLength: 2, maxLength: 5 })
          .map((hotspots) => hotspots.map((h, i) => ({ ...h, id: `${h.id}_${i}` }))),
        fc.integer({ min: 0, max: 4 }),
        (hotspotDefs, targetIdxRaw) => {
          const targetIdx = targetIdxRaw % hotspotDefs.length;
          const eventBus = createMockEventBus();
          const scene = createMockScene({ interactionKeyDown: true });

          // Build all Tiled objects
          const objects = hotspotDefs.map((h) =>
            buildHotspotObject({
              id: h.id,
              text: h.textJson,
              imageUrl: h.imageUrl,
              x: h.position.x,
              y: h.position.y,
              width: h.position.width,
              height: h.position.height
            })
          );

          const objectLayer = { objects };
          const manager = new HotspotManager(scene, objectLayer, eventBus);

          expect(manager.hotspots).toHaveLength(hotspotDefs.length);

          // Configure overlap to return true only for the target hotspot's zone
          const targetZone = manager.hotspots[targetIdx].zone;
          scene.physics.overlap.mockImplementation((player, zone) => zone === targetZone);

          manager.checkInteraction(mockPlayer);

          // Property: exactly one event emitted
          expect(eventBus.emit).toHaveBeenCalledTimes(1);

          const [, payload] = eventBus.emit.mock.calls[0];

          // Property: emitted payload matches the target hotspot's data
          const targetDef = hotspotDefs[targetIdx];
          expect(payload.id).toBe(targetDef.id);
          expect(payload.text).toEqual(targetDef.textArray);
          expect(payload.imageUrl).toBe(targetDef.imageUrl);
        }
      ),
      { numRuns: 100 }
    );
  });
});
