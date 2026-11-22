import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Feature: map v2 (third tileset + carpet runner on the floor).
// Covers: tiles from any tileset are keyed to their owning tileset, and the walkable
// floor band ignores rugs/carpet below the first all-floor row.

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config && config.key;
    }
  }
}));
vi.mock('../PlayerController.js', () => ({ default: class { constructor() {} } }));
vi.mock('../SegmentManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../InteractionManager.js', () => ({ default: class { constructor() {} } }));
vi.mock('../PromptLabel.js', () => ({ default: class { constructor() {} } }));

import GameScene from '../GameScene.js';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../public/assets/maps');
const loadMap = (name) => JSON.parse(readFileSync(resolve(MAPS_DIR, `${name}.json`), 'utf8'));

const MAIN = { firstgid: 1, image: { key: 'museum_tileset' } };
const DECOR = { firstgid: 41, image: { key: 'museum_decor' } };
const CARPET = { firstgid: 65, image: { key: 'museum_tileset_greige_16x16_2x5-v2' } };

/** A scene with the three tilesets attached and a recording `add.image`. */
function makeScene({ extras = [CARPET] } = {}) {
  const scene = new GameScene();
  scene.tilesetMain = MAIN;
  scene.tilesetDecor = DECOR;
  scene.tilesetExtras = extras;
  scene.map = { tileWidth: 16, tileHeight: 16 };
  scene.FLOOR_DEPTH = 0;
  const images = [];
  scene.add = {
    image: vi.fn((x, y, key, frame) => {
      const sprite = { x, y, key, frame, setOrigin: vi.fn(), setDepth: vi.fn(), setFlipX: vi.fn(), setFlipY: vi.fn() };
      images.push(sprite);
      return sprite;
    }),
  };
  scene.sortGroup = { add: vi.fn() };
  return { scene, images };
}

/** A scene whose start-map floor layer is `layer`, for _computeFloorBand. */
function floorBandFor(layer) {
  const scene = new GameScene();
  scene.map = { tileHeight: 16 };
  scene._getRawLayer = () => layer;
  return scene._computeFloorBand();
}

describe('_tilesetForFrame', () => {
  it('picks the tileset whose range holds the frame', () => {
    const { scene } = makeScene();
    expect(scene._tilesetForFrame(1)).toBe(MAIN);
    expect(scene._tilesetForFrame(40)).toBe(MAIN);
    expect(scene._tilesetForFrame(41)).toBe(DECOR);
    expect(scene._tilesetForFrame(64)).toBe(DECOR);
    expect(scene._tilesetForFrame(65)).toBe(CARPET);
    expect(scene._tilesetForFrame(74)).toBe(CARPET);
  });

  it('without extras behaves as before (decor for >= 41, else main)', () => {
    const { scene } = makeScene({ extras: [] });
    expect(scene._tilesetForFrame(70)).toBe(DECOR);
    expect(scene._tilesetForFrame(5)).toBe(MAIN);
  });

  it('property: always the tileset with the highest firstgid <= frame', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 2, max: 500 }), { maxLength: 5 }),
        fc.integer({ min: 1, max: 600 }),
        (firstgids, frame) => {
          const extras = firstgids.map((g) => ({ firstgid: g, image: { key: `t${g}` } }));
          const { scene } = makeScene({ extras });
          scene.tilesetDecor = null;
          const owner = scene._tilesetForFrame(frame);
          const expected = Math.max(1, ...firstgids.filter((g) => g <= frame));
          expect(owner.firstgid).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('drawing tiles from mixed tilesets', () => {
  it('segment floor keys carpet tiles to the carpet tileset and floor tiles to the main one', () => {
    const { scene, images } = makeScene();
    const out = [];
    scene._buildSegmentFloor({ width: 3, height: 1, data: [14, 66, 74] }, 928, out);
    expect(images.map((s) => [s.key, s.frame])).toEqual([
      ['museum_tileset', 13],
      ['museum_tileset_greige_16x16_2x5-v2', 1],
      ['museum_tileset_greige_16x16_2x5-v2', 9],
    ]);
    expect(images.map((s) => s.x)).toEqual([928, 944, 960]);
    expect(out).toHaveLength(3);
  });

  it('segment decor keys main, decor and carpet tiles to their own tilesets', () => {
    const { scene, images } = makeScene();
    scene._buildSegmentDecor({ width: 3, height: 1, data: [27, 45, 70] }, 0, []);
    expect(images.map((s) => [s.key, s.frame])).toEqual([
      ['museum_tileset', 26],
      ['museum_decor', 4],
      ['museum_tileset_greige_16x16_2x5-v2', 5],
    ]);
  });

  it('start-map decor (_buildSortableLayer) keys each tile by its owning tileset', () => {
    const { scene, images } = makeScene();
    const tiles = [
      { index: 27, pixelX: 0, pixelY: 0 },
      { index: 45, pixelX: 16, pixelY: 0 },
      { index: 70, pixelX: 32, pixelY: 0 },
    ];
    const layer = { setVisible: vi.fn(), forEachTile: (fn) => tiles.forEach(fn) };
    scene.map = {
      tileWidth: 16,
      tileHeight: 16,
      getLayer: () => ({}),
      createLayer: vi.fn(() => layer),
    };
    const all = [MAIN, DECOR, CARPET];
    scene._buildSortableLayer('Tile Layer 2', DECOR, all);
    expect(scene.map.createLayer).toHaveBeenCalledWith('Tile Layer 2', all);
    expect(images.map((s) => [s.key, s.frame])).toEqual([
      ['museum_tileset', 26],
      ['museum_decor', 4],
      ['museum_tileset_greige_16x16_2x5-v2', 5],
    ]);
  });

  it('property: every drawn tile uses a valid frame of its own tileset', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 74 }), { minLength: 1, maxLength: 40 }), (ids) => {
        const { scene, images } = makeScene();
        scene._buildSegmentFloor({ width: ids.length, height: 1, data: ids }, 0, []);
        const sizes = { museum_tileset: 40, museum_decor: 24, 'museum_tileset_greige_16x16_2x5-v2': 10 };
        expect(images).toHaveLength(ids.length);
        for (const s of images) {
          expect(s.frame).toBeGreaterThanOrEqual(0);
          expect(s.frame).toBeLessThan(sizes[s.key]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('_computeFloorBand', () => {
  /** Rows: `wallRows` of wall (13), then floor (14), with `rugs` overwriting floor cells. */
  function layerOf(width, height, wallRows, rugs = []) {
    const data = [];
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) data.push(r < wallRows ? 13 : 14);
    for (const { row, col, id } of rugs) data[row * width + col] = id;
    return { width, height, data };
  }

  it('the real start map (with its carpet runner) gives row 10 down to the bottom', () => {
    const layer = loadMap('museum_start_v2').layers.find((l) => l.name === 'Tile Layer 1');
    expect(floorBandFor(layer)).toEqual({ topY: 160, bottomY: 240 });
  });

  it('a carpet runner across lower floor rows does not shrink the band', () => {
    const rugs = [];
    for (const row of [11, 12, 13]) for (let col = 1; col < 57; col++) rugs.push({ row, col, id: 66 });
    expect(floorBandFor(layerOf(58, 15, 10, rugs))).toEqual({ topY: 160, bottomY: 240 });
  });

  it('property: the band starts at the first all-floor row, whatever covers the rows below it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 2, max: 15 }),
        fc.integer({ min: 0, max: 14 }),
        fc.array(fc.record({ r: fc.nat(), c: fc.nat(), id: fc.integer({ min: 15, max: 74 }) }), { maxLength: 60 }),
        (width, height, wallRowsRaw, rugSpecs) => {
          const wallRows = wallRowsRaw % height; // at least the bottom row is floor
          const firstFloor = wallRows;
          // Rugs anywhere strictly below the first all-floor row, never on the bottom-left
          // cell (which defines the floor frame).
          const rugs = rugSpecs
            .map(({ r, c, id }) => ({ row: firstFloor + 1 + (r % height), col: c % width, id }))
            .filter(({ row, col }) => row < height && !(row === height - 1 && col === 0));
          const band = floorBandFor(layerOf(width, height, wallRows, rugs));
          expect(band).toEqual({ topY: firstFloor * 16, bottomY: height * 16 });
        },
      ),
      { numRuns: 300 },
    );
  });

  it('returns null without usable layer data', () => {
    expect(floorBandFor(null)).toBeNull();
    expect(floorBandFor({ width: 3, height: 1, data: [0, 0, 0] })).toBeNull();
  });
});
