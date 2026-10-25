// Feature: core-gameplay-mvp, Property 7: Hotspot loading correctness
// For any set of valid Memory_Hotspot objects defined in a Tile_Map's object layer
// (each containing an id, text, and optional imageUrl), the HotspotManager SHALL load
// all of them with positions and data matching the source, and all loaded hotspot
// identifiers SHALL be unique.

// **Validates: Requirements 6.1, 6.3**

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
 */
function createMockScene() {
  const scene = {
    add: {
      zone: vi.fn((x, y, w, h) => ({ x, y, width: w, height: h, type: 'zone' }))
    },
    physics: {
      add: {
        existing: vi.fn()
      }
    },
    input: {
      keyboard: {
        addKey: vi.fn(() => ({ isDown: false }))
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
 * Arbitrary: a valid text array serialized as JSON string (1–5 non-empty strings).
 */
const hotspotTextArb = fc.array(
  fc.string({ minLength: 1, maxLength: 50 }),
  { minLength: 1, maxLength: 5 }
).map((arr) => JSON.stringify(arr));

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
 * Arbitrary: a single valid hotspot definition.
 */
const validHotspotArb = fc.record({
  id: hotspotIdArb,
  text: hotspotTextArb,
  imageUrl: imageUrlArb,
  position: positionArb
});

/**
 * Arbitrary: a set of 1–10 valid hotspots with unique IDs.
 */
const validHotspotSetArb = fc.array(validHotspotArb, { minLength: 1, maxLength: 10 })
  .map((hotspots) => {
    // Ensure unique IDs by appending index
    return hotspots.map((h, i) => ({ ...h, id: `${h.id}_${i}` }));
  });

/**
 * Arbitrary: an invalid hotspot (missing id, missing text, non-JSON text, or non-array text).
 */
const invalidHotspotArb = fc.oneof(
  // Missing id
  fc.record({ text: hotspotTextArb, imageUrl: imageUrlArb, position: positionArb })
    .map((h) => ({ ...h, id: undefined })),
  // Missing text
  fc.record({ id: hotspotIdArb, imageUrl: imageUrlArb, position: positionArb })
    .map((h) => ({ ...h, text: undefined })),
  // Non-JSON text
  fc.record({ id: hotspotIdArb, imageUrl: imageUrlArb, position: positionArb })
    .map((h) => ({ ...h, text: 'not valid json {[' })),
  // Non-array text (valid JSON but not an array)
  fc.record({ id: hotspotIdArb, imageUrl: imageUrlArb, position: positionArb })
    .map((h) => ({ ...h, text: JSON.stringify({ key: 'value' }) }))
);

describe('Property 7: Hotspot loading correctness', () => {
  /** **Validates: Requirements 6.1, 6.3** */

  let scene, eventBus;

  beforeEach(() => {
    scene = createMockScene();
    eventBus = createMockEventBus();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('all valid hotspots are loaded with matching data and count equals input count', () => {
    fc.assert(
      fc.property(validHotspotSetArb, (hotspotDefs) => {
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

        // Property: number of loaded hotspots equals the number of valid input hotspots
        expect(manager.hotspots).toHaveLength(hotspotDefs.length);

        // Property: each loaded hotspot has matching id, text, and imageUrl
        for (let i = 0; i < hotspotDefs.length; i++) {
          const def = hotspotDefs[i];
          const loaded = manager.hotspots[i];

          expect(loaded.id).toBe(def.id);
          expect(loaded.text).toEqual(JSON.parse(def.text));
          expect(loaded.imageUrl).toBe(def.imageUrl);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('each hotspot zone center matches the calculated center from source x/y/width/height', () => {
    fc.assert(
      fc.property(validHotspotSetArb, (hotspotDefs) => {
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

        // Property: zone center is computed as x + width/2, y + height/2
        for (let i = 0; i < hotspotDefs.length; i++) {
          const def = hotspotDefs[i];
          const loaded = manager.hotspots[i];

          const expectedCenterX = def.position.x + def.position.width / 2;
          const expectedCenterY = def.position.y + def.position.height / 2;

          expect(loaded.zone.x).toBe(expectedCenterX);
          expect(loaded.zone.y).toBe(expectedCenterY);
          expect(loaded.zone.width).toBe(def.position.width);
          expect(loaded.zone.height).toBe(def.position.height);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('all loaded hotspot IDs are unique', () => {
    fc.assert(
      fc.property(validHotspotSetArb, (hotspotDefs) => {
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

        // Property: all IDs in the loaded hotspots array are unique
        const ids = manager.hotspots.map((h) => h.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid hotspots (missing id, missing text, non-JSON text, non-array text) are skipped', () => {
    fc.assert(
      fc.property(
        fc.array(invalidHotspotArb, { minLength: 1, maxLength: 5 }),
        (invalidDefs) => {
          const objects = invalidDefs.map((h, i) =>
            buildHotspotObject({
              id: h.id,
              text: h.text,
              imageUrl: h.imageUrl,
              x: h.position.x,
              y: h.position.y,
              width: h.position.width,
              height: h.position.height,
              name: `invalid_${i}`
            })
          );

          const objectLayer = { objects };
          const manager = new HotspotManager(scene, objectLayer, eventBus);

          // Property: no invalid hotspots should be loaded
          expect(manager.hotspots).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mixed valid/invalid hotspots — only valid ones are loaded', () => {
    fc.assert(
      fc.property(
        validHotspotSetArb,
        fc.array(invalidHotspotArb, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        (validDefs, invalidDefs, validFirst) => {
          const validObjects = validDefs.map((h) =>
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

          const invalidObjects = invalidDefs.map((h, i) =>
            buildHotspotObject({
              id: h.id,
              text: h.text,
              imageUrl: h.imageUrl,
              x: h.position.x,
              y: h.position.y,
              width: h.position.width,
              height: h.position.height,
              name: `invalid_${i}`
            })
          );

          // Interleave valid and invalid based on random boolean
          const objects = validFirst
            ? [...validObjects, ...invalidObjects]
            : [...invalidObjects, ...validObjects];

          const objectLayer = { objects };
          const manager = new HotspotManager(scene, objectLayer, eventBus);

          // Property: only valid hotspots are loaded
          expect(manager.hotspots).toHaveLength(validDefs.length);

          // Property: each loaded hotspot ID comes from the valid set
          const validIds = new Set(validDefs.map((h) => h.id));
          for (const loaded of manager.hotspots) {
            expect(validIds.has(loaded.id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
