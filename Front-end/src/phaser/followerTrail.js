/**
 * followerTrail.js
 *
 * Pure, Phaser-free trail arithmetic for the Follower companion (Kelly).
 * Every function takes and returns plain `{x, y}` objects and numbers and never
 * mutates its arguments.
 *
 * Trail model: `samples` is the recorded polyline of Player feet positions
 * (oldest first) and `gap` is the path length, measured backward from the newest
 * sample, at which the Follower stands. The Follower position is always
 * `pointAtDistanceFromEnd(samples, gap)`, so it lies on the polyline by construction.
 */

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ samples: Point[], gap: number }} TrailState */
/** @typedef {'up'|'down'|'left'|'right'} Facing */
/** @typedef {{ minX?: number, maxX?: number, minY?: number, maxY?: number }} Bounds */

export const FOLLOW_DISTANCE_PX = 24;
export const TRAIL_SLACK_PX = 32;
export const MAX_TRAIL_SAMPLES = 256;
export const TELEPORT_THRESHOLD_PX = 64;
export const MOVE_EPSILON_PX = 0.1;
export const MAX_FRAME_DELTA_MS = 100;
export const DEPTH_TIE_EPSILON = 0.001;
export const FACING_ROW = { down: 0, left: 1, right: 2, up: 3 };
export const FRAMES_PER_ROW = 4;

/**
 * Euclidean distance between two points.
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Total length of the polyline through `samples`.
 * @param {Point[]} samples
 * @returns {number}
 */
export function pathLength(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += distance(samples[i - 1], samples[i]);
  }
  return total;
}

/**
 * Seed a trail with a single sample and zero gap.
 * @param {Point} p
 * @returns {TrailState}
 */
export function createTrail(p) {
  return { samples: [{ x: p.x, y: p.y }], gap: 0 };
}

/**
 * Append a Player position to the trail. A position equal to the newest sample
 * returns the input state unchanged. Otherwise the new sample is added and `gap`
 * grows by the segment length, so the Follower stays where it is. When the sample
 * count would exceed `maxSamples` the oldest sample is evicted and `gap` is
 * clamped to the remaining path length.
 * @param {TrailState} state
 * @param {Point} p
 * @param {number} [maxSamples=MAX_TRAIL_SAMPLES]
 * @returns {TrailState}
 */
export function appendSample(state, p, maxSamples = MAX_TRAIL_SAMPLES) {
  const { samples } = state;
  if (samples.length === 0) return createTrail(p);
  const last = samples[samples.length - 1];
  if (last.x === p.x && last.y === p.y) return state;

  let next = [...samples, { x: p.x, y: p.y }];
  let gap = state.gap + distance(last, p);
  const cap = Math.max(1, Math.floor(maxSamples));
  if (next.length > cap) {
    next = next.slice(next.length - cap);
    gap = Math.min(gap, pathLength(next));
  }
  return { samples: next, gap };
}

/**
 * Point at path distance `d` back from the newest sample. `d` is clamped into
 * `[0, pathLength]`.
 * @param {Point[]} samples
 * @param {number} d
 * @returns {Point}
 */
export function pointAtDistanceFromEnd(samples, d) {
  const last = samples[samples.length - 1];
  let remaining = Number.isFinite(d) ? Math.max(0, d) : 0;
  for (let i = samples.length - 1; i > 0; i--) {
    const a = samples[i - 1];
    const b = samples[i];
    const segLen = distance(a, b);
    if (remaining <= segLen) {
      if (segLen === 0) return { x: b.x, y: b.y };
      const t = remaining / segLen; // 0 at b, 1 at a
      return { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t };
    }
    remaining -= segLen;
  }
  // Single sample, or d beyond the path length: clamp to the oldest sample.
  return samples.length > 1 ? { x: samples[0].x, y: samples[0].y } : { x: last.x, y: last.y };
}

/**
 * Current Follower position for a trail.
 * @param {TrailState} state
 * @returns {Point}
 */
export function followerPosition(state) {
  return pointAtDistanceFromEnd(state.samples, state.gap);
}

/**
 * Reduce `gap` toward `followDistance` by at most `maxStep`. Holds when
 * `gap <= followDistance`.
 * @param {number} gap
 * @param {number} followDistance
 * @param {number} maxStep
 * @returns {number}
 */
export function advanceGap(gap, followDistance, maxStep) {
  return gap - Math.min(maxStep, Math.max(0, gap - followDistance));
}

/**
 * Trim the oldest end of the trail so its length is at most
 * `max(followDistance + slack, gap)`. The oldest segment is cut at the exact
 * limit with an interpolated point. The Follower position is unchanged.
 * @param {TrailState} state
 * @param {number} followDistance
 * @param {number} [slack=TRAIL_SLACK_PX]
 * @returns {TrailState}
 */
export function trimTrail(state, followDistance, slack = TRAIL_SLACK_PX) {
  const { samples } = state;
  const limit = Math.max(followDistance + slack, state.gap);
  const total = pathLength(samples);
  if (!(total > limit) || samples.length < 2) return state;

  let excess = total - limit;
  let i = 0;
  while (i < samples.length - 1) {
    const segLen = distance(samples[i], samples[i + 1]);
    if (excess >= segLen) {
      excess -= segLen;
      i++;
    } else {
      break;
    }
  }

  let kept = samples.slice(i);
  if (i < samples.length - 1 && excess > 0) {
    const a = samples[i];
    const b = samples[i + 1];
    const t = excess / distance(a, b);
    const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (cut.x === b.x && cut.y === b.y) {
      kept = samples.slice(i + 1);
    } else {
      kept = [cut, ...samples.slice(i + 1)];
    }
  }
  return { samples: kept, gap: Math.min(state.gap, pathLength(kept)) };
}

/**
 * Validate the inputs of one trail step.
 * @param {number} followDistance
 * @param {number} deltaMs
 * @param {number} speed
 * @param {Point} playerPos
 * @returns {boolean}
 */
export function isValidStepInput(followDistance, deltaMs, speed, playerPos) {
  return (
    Number.isFinite(followDistance) && followDistance >= 0 &&
    Number.isFinite(deltaMs) && deltaMs >= 0 &&
    Number.isFinite(speed) && speed >= 0 &&
    playerPos != null &&
    Number.isFinite(playerPos.x) && Number.isFinite(playerPos.y)
  );
}

/**
 * Single per-frame entry point: record the Player position, advance the Follower
 * along the trail at no more than `speed`, and trim the oldest end.
 * Invalid inputs return the SAME state object. A jump over the teleport
 * threshold resets the trail.
 * @param {TrailState} state
 * @param {Point} playerPos
 * @param {{ followDistance: number, deltaMs: number, speed: number, slack?: number, teleportThreshold?: number, maxSamples?: number }} params
 * @returns {{ state: TrailState, teleported: boolean }}
 */
export function stepTrail(state, playerPos, params) {
  const {
    followDistance,
    deltaMs,
    speed,
    slack = TRAIL_SLACK_PX,
    teleportThreshold = TELEPORT_THRESHOLD_PX,
    maxSamples = MAX_TRAIL_SAMPLES,
  } = params || {};

  if (!isValidStepInput(followDistance, deltaMs, speed, playerPos)) {
    return { state, teleported: false };
  }
  if (!state || !Array.isArray(state.samples) || state.samples.length === 0) {
    return { state: createTrail(playerPos), teleported: false };
  }

  const newest = state.samples[state.samples.length - 1];
  if (distance(newest, playerPos) > teleportThreshold) {
    return { state: createTrail(playerPos), teleported: true };
  }

  const appended = appendSample(state, playerPos, maxSamples);
  const maxStep = (speed * Math.min(deltaMs, MAX_FRAME_DELTA_MS)) / 1000;
  const advanced = {
    samples: appended.samples,
    gap: advanceGap(appended.gap, followDistance, maxStep),
  };
  return { state: trimTrail(advanced, followDistance, slack), teleported: false };
}

/**
 * Clamp a point into bounds. Missing bounds are treated as unbounded.
 * @param {Point} p
 * @param {Bounds} bounds
 * @returns {Point}
 */
export function clampPoint(p, bounds) {
  const { minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity } = bounds || {};
  return {
    x: Math.min(Math.max(p.x, minX), maxX),
    y: Math.min(Math.max(p.y, minY), maxY),
  };
}

/**
 * Facing from a displacement: dominant axis wins, ties go horizontal, and a
 * displacement under MOVE_EPSILON_PX keeps the previous facing.
 * @param {number} dx
 * @param {number} dy
 * @param {Facing} previousFacing
 * @returns {Facing}
 */
export function facingFromDelta(dx, dy, previousFacing) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (!(Math.max(ax, ay) >= MOVE_EPSILON_PX)) return previousFacing;
  if (ax >= ay) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * Spritesheet frame index for a facing and walk-cycle column.
 * @param {Facing} facing
 * @param {number} column
 * @returns {number}
 */
export function frameIndexFor(facing, column) {
  return FACING_ROW[facing] * FRAMES_PER_ROW + column;
}

/**
 * Follower depth: its feet Y, nudged just behind the Player on an exact tie.
 * @param {number} followerY
 * @param {number} playerY
 * @returns {number}
 */
export function resolveFollowerDepth(followerY, playerY) {
  return followerY === playerY ? followerY - DEPTH_TIE_EPSILON : followerY;
}

// ---------------------------------------------------------------------------
// Settle helpers (pure)
// ---------------------------------------------------------------------------

export const MIN_SEPARATION_PX = 16;
export const SETTLE_ARRIVAL_PX = 1;
export const SETTLE_GAP_TOLERANCE_PX = 1;

const FACING_DIR = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * Candidate rest spots around the Player, in fixed priority order:
 * behind, front, above, below. An unknown facing falls back to 'down'.
 * @param {Point} playerPos
 * @param {Facing} facing
 * @param {number} followDistance
 * @returns {Point[]}
 */
export function restSpotCandidates(playerPos, facing, followDistance) {
  const dir = FACING_DIR[facing] || FACING_DIR.down;
  const d = followDistance;
  return [
    { x: playerPos.x - dir.x * d, y: playerPos.y - dir.y * d },
    { x: playerPos.x + dir.x * d, y: playerPos.y + dir.y * d },
    { x: playerPos.x, y: playerPos.y - d },
    { x: playerPos.x, y: playerPos.y + d },
  ];
}

/**
 * Whether the Follower should start settling to a rest spot: the Player has
 * stopped, the trail gap is at (or within tolerance of) the follow distance,
 * and the two are closer than `minSeparation`. Non-finite input gives false.
 * @param {{ playerStopped: boolean, gap: number, followDistance: number, followerPos: Point, playerPos: Point, minSeparation?: number }} args
 * @returns {boolean}
 */
export function shouldSettle({
  playerStopped,
  gap,
  followDistance,
  followerPos,
  playerPos,
  minSeparation = MIN_SEPARATION_PX,
} = {}) {
  if (
    !followerPos || !playerPos ||
    !Number.isFinite(gap) || !Number.isFinite(followDistance) ||
    !Number.isFinite(minSeparation) ||
    !Number.isFinite(followerPos.x) || !Number.isFinite(followerPos.y) ||
    !Number.isFinite(playerPos.x) || !Number.isFinite(playerPos.y)
  ) {
    return false;
  }
  return (
    playerStopped === true &&
    gap <= followDistance + SETTLE_GAP_TOLERANCE_PX &&
    distance(followerPos, playerPos) < minSeparation
  );
}

/**
 * Move `from` toward `to` by at most `maxStep`, never overshooting. Snaps to
 * `to` when within SETTLE_ARRIVAL_PX or `maxStep`. Invalid input holds at `from`.
 * @param {Point} from
 * @param {Point} to
 * @param {number} maxStep
 * @returns {{ pos: Point, arrived: boolean }}
 */
export function stepToward(from, to, maxStep) {
  if (
    !from || !to ||
    !Number.isFinite(from.x) || !Number.isFinite(from.y) ||
    !Number.isFinite(to.x) || !Number.isFinite(to.y) ||
    !Number.isFinite(maxStep) || maxStep < 0
  ) {
    return { pos: from ? { x: from.x, y: from.y } : from, arrived: false };
  }
  const dist = distance(from, to);
  if (dist <= SETTLE_ARRIVAL_PX || dist <= maxStep) {
    return { pos: { x: to.x, y: to.y }, arrived: true };
  }
  const t = maxStep / dist;
  return {
    pos: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    arrived: false,
  };
}

/**
 * Fresh two-sample trail from the Follower to the Player. Coincident points
 * give a single sample and zero gap. Points are copied.
 * @param {Point} followerPos
 * @param {Point} playerPos
 * @returns {TrailState}
 */
export function reseedTrail(followerPos, playerPos) {
  const gap = distance(followerPos, playerPos);
  if (gap === 0) return { samples: [{ x: playerPos.x, y: playerPos.y }], gap: 0 };
  return {
    samples: [
      { x: followerPos.x, y: followerPos.y },
      { x: playerPos.x, y: playerPos.y },
    ],
    gap,
  };
}
