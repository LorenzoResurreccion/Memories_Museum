import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Schema / validation test for the committed, finite Tiled map JSON.
 *
 * Task 1.2 (infinite-hallway): the maps must be exported from Tiled with
 * "Infinite" OFF (flat `data` arrays) and with EMBEDDED tilesets so the
 * per-tile collision `objectgroup` data travels into the JSON.
 *
 * The maps are loaded from disk with `fs` (they live under `public/assets/`,
 * which is served statically rather than bundled, so reading the committed
 * file off disk is the most robust way to validate the shipped artifact).
 *
 * This is an example-based schema check (no fast-check needed).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(__dirname, '../../public/assets/maps');

/** @param {string} name */
function loadMap(name) {
  const json = readFileSync(resolve(MAPS_DIR, `${name}.json`), 'utf8');
  return JSON.parse(json);
}

/** Expected embedded-tileset collision local ids (tiles carrying an objectgroup). */
const EXPECTED_COLLISION_IDS = {
  museum_tileset: [12, 24, 26, 27, 28, 35, 36, 37],
  museum_decor: [7, 13]
};

const MAP_NAMES = ['museum_start', 'museum_hallway'];

/** @param {object} map @param {string} name */
function findLayer(map, name) {
  return map.layers.find((l) => l.name === name);
}

/** @param {object} map @param {string} tilesetName */
function findTileset(map, tilesetName) {
  return map.tilesets.find((t) => t.name === tilesetName);
}

describe('maps conversion — finite Tiled JSON schema', () => {
  describe.each(MAP_NAMES)('%s.json', (mapName) => {
    const map = loadMap(mapName);

    it('is a finite (non-infinite) map', () => {
      expect(map.infinite).not.toBe(true);
    });

    it('has expected 58x15 dimensions', () => {
      expect(map.width).toBe(58);
      expect(map.height).toBe(15);
    });

    it('has every tile layer backed by a flat data array sized width*height', () => {
      const tileLayers = map.layers.filter((l) => l.type === 'tilelayer');
      expect(tileLayers.length).toBeGreaterThan(0);
      for (const layer of tileLayers) {
        expect(Array.isArray(layer.data)).toBe(true);
        expect(layer.data).toHaveLength(map.width * map.height);
      }
    });

    it('contains Tile Layer 1, Tile Layer 2, and Object Layer 1 (by name)', () => {
      // Assert by NAME, not index: Object Layer 1 sits between the tile layers.
      const tile1 = findLayer(map, 'Tile Layer 1');
      const tile2 = findLayer(map, 'Tile Layer 2');
      const objectLayer = findLayer(map, 'Object Layer 1');

      expect(tile1).toBeDefined();
      expect(tile1.type).toBe('tilelayer');
      expect(tile2).toBeDefined();
      expect(tile2.type).toBe('tilelayer');
      expect(objectLayer).toBeDefined();
      expect(objectLayer.type).toBe('objectgroup');
    });

    it('has embedded tilesets (no external source) for museum_tileset and museum_decor', () => {
      const tileset = findTileset(map, 'museum_tileset');
      const decor = findTileset(map, 'museum_decor');

      expect(tileset).toBeDefined();
      expect('source' in tileset).toBe(false);
      expect(tileset.firstgid).toBe(1);

      expect(decor).toBeDefined();
      expect('source' in decor).toBe(false);
      expect(decor.firstgid).toBe(41);
    });

    it.each(Object.entries(EXPECTED_COLLISION_IDS))(
      'embeds collision objectgroup data for %s known local ids',
      (tilesetName, expectedIds) => {
        const tileset = findTileset(map, tilesetName);
        expect(tileset).toBeDefined();
        expect(Array.isArray(tileset.tiles)).toBe(true);

        // Collect local ids whose tile entry carries a truthy collision objectgroup.
        const collisionIds = new Set(
          tileset.tiles
            .filter((t) => t.objectgroup)
            .map((t) => t.id)
        );

        // The embedded tileset must carry collision for every expected id.
        for (const id of expectedIds) {
          expect(collisionIds.has(id)).toBe(true);
        }
      }
    );
  });

  describe('museum_hallway Object Layer 1', () => {
    const hallway = loadMap('museum_hallway');
    const objectLayer = findLayer(hallway, 'Object Layer 1');

    it('has exactly 6 objects', () => {
      expect(objectLayer).toBeDefined();
      expect(Array.isArray(objectLayer.objects)).toBe(true);
      expect(objectLayer.objects).toHaveLength(6);
    });

    it('all 6 objects are polygon shapes', () => {
      // NOTE: the task wording calls these "rectangle objects", but the committed
      // Tiled source authors them as POLYGON objects (each carries a `polygon`
      // array of points). Assert the shape that matches the committed JSON.
      for (const obj of objectLayer.objects) {
        expect(Array.isArray(obj.polygon)).toBe(true);
      }
    });
  });

  describe('museum_start Object Layer 1', () => {
    const start = loadMap('museum_start');
    const objectLayer = findLayer(start, 'Object Layer 1');

    it('has no objects', () => {
      expect(objectLayer).toBeDefined();
      expect(objectLayer.objects).toHaveLength(0);
    });
  });
});
