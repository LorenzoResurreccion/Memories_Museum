import { describe, it, expect } from 'vitest';
import {
  footprintAt,
  isValidPosition,
  segmentClear,
  sanitizeBoxes,
  chooseSettleTarget,
} from '../followerCollision.js';

// Player at (200,100) facing left, follow distance 24:
// behind (224,100), front (176,100), above (200,76), below (200,124).
const PLAYER = { x: 200, y: 100 };
const D = 24;
const WIDE = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
const BEHIND_BOX = { x: 220, y: 90, width: 10, height: 5 };
const FRONT_BOX = { x: 170, y: 90, width: 10, height: 5 };
const ABOVE_BOX = { x: 195, y: 65, width: 5, height: 5 };
const BELOW_BOX = { x: 195, y: 115, width: 5, height: 5 };

const choose = (boxes, bounds = WIDE) =>
  chooseSettleTarget(PLAYER, 'left', D, bounds, boxes, { ...PLAYER });

describe('footprintAt', () => {
  it('is a 16x16 rect centered on feet X with bottom edge at feet Y', () => {
    expect(footprintAt({ x: 100, y: 80 })).toEqual({ x: 92, y: 64, width: 16, height: 16 });
  });
});

describe('isValidPosition', () => {
  const feet = { x: 100, y: 80 }; // footprint x[92,108], y[64,80]

  it('stays valid when a box exactly touches the footprint edge', () => {
    expect(isValidPosition(feet, [{ x: 108, y: 64, width: 10, height: 16 }])).toBe(true);
  });

  it('becomes invalid with a 1px overlap', () => {
    expect(isValidPosition(feet, [{ x: 107, y: 64, width: 10, height: 16 }])).toBe(false);
  });

  it('a bench flush against the stop point does not block the other candidates', () => {
    const bench = [{ x: 208, y: 84, width: 20, height: 16 }];
    expect(isValidPosition(PLAYER, bench)).toBe(true);
    expect(isValidPosition({ x: 224, y: 100 }, bench)).toBe(false); // behind blocked
    expect(isValidPosition({ x: 176, y: 100 }, bench)).toBe(true); // front
    expect(isValidPosition({ x: 200, y: 76 }, bench)).toBe(true); // above
    expect(isValidPosition({ x: 200, y: 124 }, bench)).toBe(true); // below
  });
});

describe('chooseSettleTarget', () => {
  it('picks behind when nothing blocks', () => {
    expect(choose([])).toEqual({ x: 224, y: 100 });
  });

  it('picks front when behind is blocked', () => {
    expect(choose([BEHIND_BOX])).toEqual({ x: 176, y: 100 });
  });

  it('picks above when behind and front are blocked', () => {
    expect(choose([BEHIND_BOX, FRONT_BOX])).toEqual({ x: 200, y: 76 });
  });

  it('falls through to front when only the route to behind is blocked', () => {
    const routeOnly = { x: 209, y: 90, width: 6, height: 5 };
    expect(isValidPosition({ x: 224, y: 100 }, [routeOnly], WIDE)).toBe(true);
    expect(choose([routeOnly])).toEqual({ x: 176, y: 100 });
  });

  it('returns null when all four candidates are blocked', () => {
    expect(choose([BEHIND_BOX, FRONT_BOX, ABOVE_BOX, BELOW_BOX])).toBeNull();
  });

  it('skips a candidate that is out of bounds', () => {
    expect(choose([], { ...WIDE, maxX: 220 })).toEqual({ x: 176, y: 100 });
  });
});

describe('sanitizeBoxes', () => {
  it('drops null, NaN and non-positive size entries, keeping good ones', () => {
    const good = { x: 1, y: 2, width: 3, height: 4 };
    const out = sanitizeBoxes([
      null,
      good,
      { x: NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: -2 },
    ]);
    expect(out).toEqual([good]);
  });

  it('returns [] for a non-array', () => {
    expect(sanitizeBoxes(undefined)).toEqual([]);
    expect(sanitizeBoxes({})).toEqual([]);
  });
});

describe('segmentClear', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 0 };

  it('is clear with no boxes', () => {
    expect(segmentClear(from, to, [])).toBe(true);
  });

  it('is blocked by a box straight across the segment', () => {
    expect(segmentClear(from, to, [{ x: 40, y: -10, width: 10, height: 20 }])).toBe(false);
  });
});
