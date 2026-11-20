/**
 * followerCollision.js
 *
 * Pure, Phaser-free rectangle arithmetic for the Follower companion (Kelly).
 * The Follower has no physics body, so settling asks these functions whether a
 * footprint or a straight walk would hit the static Collision_Boxes that
 * CollisionBuilder built for the Player. Rectangles are axis-aligned with a
 * top-left origin in world pixels. Nothing here mutates its arguments.
 */

import { restSpotCandidates } from './followerTrail.js';

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ minX?: number, maxX?: number, minY?: number, maxY?: number }} Bounds */
/** @typedef {'up'|'down'|'left'|'right'} Facing */

/** Follower footprint edge length; equals the Player's 16x16 physics body. */
export const FOLLOWER_FOOTPRINT_PX = 16;

function isPoint(p) {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isFiniteRect(r) {
  return (
    r != null &&
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.width) && Number.isFinite(r.height)
  );
}

/**
 * Footprint rectangle for a Follower standing at `feet` (origin 0.5, 1):
 * centered horizontally on feet X, bottom edge at feet Y.
 * @param {Point} feet
 * @param {number} [size=FOLLOWER_FOOTPRINT_PX]
 * @returns {Rect}
 */
export function footprintAt(feet, size = FOLLOWER_FOOTPRINT_PX) {
  return { x: feet.x - size / 2, y: feet.y - size, width: size, height: size };
}

/**
 * True iff the intersection of two rectangles has positive area. Touching
 * edges or corners do not overlap. Non-finite fields give false.
 * @param {Rect} a
 * @param {Rect} b
 * @returns {boolean}
 */
export function rectsOverlap(a, b) {
  if (!isFiniteRect(a) || !isFiniteRect(b)) return false;
  return (
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * Valid_Position: finite feet inside the bounds (inclusive on both axes,
 * missing bounds are unbounded) whose footprint overlaps no box.
 * @param {Point} feet
 * @param {Rect[]} boxes
 * @param {Bounds} [bounds]
 * @returns {boolean}
 */
export function isValidPosition(feet, boxes, bounds) {
  if (!isPoint(feet)) return false;
  const { minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity } = bounds || {};
  if (feet.x < minX || feet.x > maxX || feet.y < minY || feet.y > maxY) return false;
  const fp = footprintAt(feet);
  const list = Array.isArray(boxes) ? boxes : [];
  for (const box of list) {
    if (rectsOverlap(fp, box)) return false;
  }
  return true;
}

/**
 * Open interval of t where `c + t*d` lies strictly inside (lo, hi).
 * Returns null when empty, [-Infinity, Infinity] when it is always inside.
 * @returns {[number, number] | null}
 */
function slabInterval(c, d, lo, hi) {
  if (d === 0) return c > lo && c < hi ? [-Infinity, Infinity] : null;
  const t1 = (lo - c) / d;
  const t2 = (hi - c) / d;
  return t1 < t2 ? [t1, t2] : [t2, t1];
}

/**
 * True iff the footprint swept from `from` to `to` overlaps no box with
 * positive area at any point. Uses the Minkowski-expanded open rectangle per
 * box, so grazing an edge or corner is clear. Exact for axis-aligned boxes.
 * @param {Point} from
 * @param {Point} to
 * @param {Rect[]} boxes
 * @param {number} [size=FOLLOWER_FOOTPRINT_PX]
 * @returns {boolean}
 */
export function segmentClear(from, to, boxes, size = FOLLOWER_FOOTPRINT_PX) {
  if (!isPoint(from) || !isPoint(to)) return false;
  const list = Array.isArray(boxes) ? boxes : [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const half = size / 2;

  for (const box of list) {
    if (!isFiniteRect(box)) continue;
    const ix = slabInterval(from.x, dx, box.x - half, box.x + box.width + half);
    if (!ix) continue;
    const iy = slabInterval(from.y, dy, box.y, box.y + box.height + size);
    if (!iy) continue;
    const a = Math.max(ix[0], iy[0]);
    const b = Math.min(ix[1], iy[1]);
    // Open interval (a, b) must meet the closed range [0, 1].
    if (a < b && b > 0 && a < 1) return false;
  }
  return true;
}

/**
 * Keep only well-formed boxes: non-null objects with finite x, y and positive
 * finite width and height. Never throws; a non-array gives [].
 * @param {unknown} boxes
 * @returns {Rect[]}
 */
export function sanitizeBoxes(boxes) {
  if (!Array.isArray(boxes)) return [];
  const out = [];
  for (const b of boxes) {
    if (
      b != null && typeof b === 'object' &&
      Number.isFinite(b.x) && Number.isFinite(b.y) &&
      Number.isFinite(b.width) && Number.isFinite(b.height) &&
      b.width > 0 && b.height > 0
    ) {
      out.push({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
  }
  return out;
}

/**
 * Pick the settle target: the first rest-spot candidate (behind, front, above,
 * below) that is a Valid_Position and whose straight route from `followerPos`
 * is clear. Returns a copy of that candidate, or null. Never clamps.
 * @param {Point} playerPos
 * @param {Facing} facing
 * @param {number} followDistance
 * @param {Bounds} bounds
 * @param {Rect[]} boxes
 * @param {Point} followerPos
 * @returns {Point | null}
 */
export function chooseSettleTarget(playerPos, facing, followDistance, bounds, boxes, followerPos) {
  if (!isPoint(playerPos) || !isPoint(followerPos) || !Number.isFinite(followDistance)) {
    return null;
  }
  for (const c of restSpotCandidates(playerPos, facing, followDistance)) {
    if (isValidPosition(c, boxes, bounds) && segmentClear(followerPos, c, boxes)) {
      return { x: c.x, y: c.y };
    }
  }
  return null;
}
