/**
 * Integration: shipped maps -> CollisionBuilder -> follower settle logic.
 * No Phaser; reads the real Tiled JSON and records world rects via a group stub.
 *
 * Validates: Requirements 13.4, 13.14, 13.16, 12.8
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CollisionBuilder from '../CollisionBuilder.js';
import { chooseSettleTarget, footprintAt, rectsOverlap } from '../followerCollision.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_DIR = path.resolve(__dirname, '../../../public/assets/maps');
const loadMap = (name) => JSON.parse(fs.readFileSync(path.join(MAP_DIR, `${name}.json`), 'utf8'));

const BENCH_GIDS = [27, 28, 29]; // museum_tileset local ids 26, 27, 28
const TILE = 16;

/** Group stub whose create() returns a body recording its world rect. */
function makeGroup() {
  const rects = [];
  return {
    rects,
    create(cx, cy) {
      const rec = { x: cx, y: cy, width: 0, height: 0 };
      rects.push(rec);
      const body = {
        x: cx, y: cy, width: 0, height: 0,
        setSize(w, h) {
          this.width = w; this.height = h;
          this.x = cx - w / 2; this.y = cy - h / 2;
          Object.assign(rec, { x: this.x, y: this.y, width: w, height: h });
        },
        updateFromGameObject() {}
      };
      return {
        setVisible() {}, setSize(w, h) { body.setSize(w, h); }, setDisplaySize() {}, body
      };
    }
  };
}

/** Mirrors GameScene._buildLayerCollision: every tileset per layer. */
function buildBoxes(map, layerName) {
  const group = makeGroup();
  const builder = new CollisionBuilder(null, group);
  const layer = map.layers.find((l) => l.name === layerName);
  for (const ts of map.tilesets) builder.buildForLayer(layer, ts, 0);
  return group.rects;
}

/** Expected AABB (tile-local) from the JSON objectgroup, rectangles or polygons. */
function expectedAABB(map, gid) {
  const ts = map.tilesets.find((t) => t.name === 'museum_tileset');
  const def = ts.tiles.find((t) => t.id === gid - ts.firstgid);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of def.objectgroup.objects) {
    const pts = o.polygon
      ? o.polygon.map((p) => ({ x: o.x + p.x, y: o.y + p.y }))
      : [{ x: o.x, y: o.y }, { x: o.x + o.width, y: o.y + o.height }];
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function benchCells(map) {
  const layer = map.layers.find((l) => l.name === 'Tile Layer 2');
  const cells = [];
  layer.data.forEach((g, i) => {
    const gid = g & 0x1fffffff;
    if (BENCH_GIDS.includes(gid)) {
      cells.push({ gid, col: i % layer.width, row: Math.floor(i / layer.width) });
    }
  });
  return cells;
}

const start = loadMap('museum_start');
const hallway = loadMap('museum_hallway');

describe('shipped maps: bench collision shapes', () => {
  it('hallway contains bench tiles', () => {
    expect(benchCells(hallway).length).toBeGreaterThan(0);
  });

  it('both maps agree on bench tile collision shapes', () => {
    for (const gid of BENCH_GIDS) {
      const a = expectedAABB(start, gid);
      const b = expectedAABB(hallway, gid);
      expect(b, `bench GID ${gid} collision shape differs between museum_start and museum_hallway`).toEqual(a);
    }
  });

  it('bench boxes are positive, finite, axis-aligned, integer-ish and bottom-anchored', () => {
    const cells = benchCells(hallway);
    const boxes = buildBoxes(hallway, 'Tile Layer 2');
    for (const { gid, col, row } of cells) {
      const exp = expectedAABB(hallway, gid);
      const want = {
        x: col * TILE + exp.x,
        y: row * TILE + exp.y,
        width: exp.width,
        height: exp.height
      };
      const match = boxes.find(
        (b) => b.x === want.x && b.y === want.y && b.width === want.width && b.height === want.height
      );
      expect(match, `no box for bench GID ${gid} at (${col},${row})`).toBeTruthy();
      for (const v of [match.x, match.y, match.width, match.height]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
      }
      expect(match.width).toBeGreaterThan(0);
      expect(match.height).toBeGreaterThan(0);
      // Bottom-anchored: box bottom is the tile bottom.
      expect(match.y + match.height).toBeCloseTo((row + 1) * TILE, 6);
    }
  });
});

describe('shipped maps: follower settles next to a real bench', () => {
  it('chooseSettleTarget finds a clear spot beside a hallway bench', () => {
    const cells = benchCells(hallway);
    // Rightmost tile (GID 29) of the first bench.
    const right = cells.filter((c) => c.gid === 29).sort((a, b) => a.col - b.col)[0];
    const boxes = [
      ...buildBoxes(hallway, 'Tile Layer 1'),
      ...buildBoxes(hallway, 'Tile Layer 2')
    ].map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));

    const exp = expectedAABB(hallway, 29);
    const benchRight = right.col * TILE + exp.x + exp.width;
    const benchBottom = (right.row + 1) * TILE;
    // Player stands just right of the bench, mid-height of the bench box.
    const player = { x: benchRight + 12, y: benchBottom - 4 };
    const bounds = {
      minX: 0,
      maxX: hallway.width * TILE,
      minY: benchBottom - 3 * TILE,
      maxY: benchBottom + TILE
    };

    const target = chooseSettleTarget(player, 'left', 24, bounds, boxes, { ...player });
    expect(target).not.toBeNull();
    const fp = footprintAt(target);
    for (const box of boxes) {
      expect(rectsOverlap(fp, box)).toBe(false);
    }
  });
});
