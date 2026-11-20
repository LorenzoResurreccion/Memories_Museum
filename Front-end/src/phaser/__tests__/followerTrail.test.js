import { describe, it, expect } from 'vitest';
import {
  createTrail,
  stepTrail,
  trimTrail,
  followerPosition,
  pathLength,
  shouldSettle,
  restSpotCandidates,
  stepToward,
  reseedTrail,
  FOLLOW_DISTANCE_PX,
  TRAIL_SLACK_PX,
  TELEPORT_THRESHOLD_PX,
} from '../followerTrail.js';

// speed 80 px/s * 25 ms = exactly 2 px of Follower travel per frame
const PARAMS = { followDistance: FOLLOW_DISTANCE_PX, deltaMs: 25, speed: 80 };
const STEP = 2;

describe('followerTrail examples', () => {
  it('createTrail seeds exactly one sample with gap 0 (Req 2.6)', () => {
    const t = createTrail({ x: 5, y: 7 });
    expect(t.samples).toEqual([{ x: 5, y: 7 }]);
    expect(t.gap).toBe(0);
  });

  it('L-shaped walk: Follower passes through the exact corner sample (Req 4.2)', () => {
    let state = createTrail({ x: 0, y: 0 });
    let px = 0;
    let py = 0;
    // Right 48 px
    for (let i = 0; i < 24; i++) {
      px += STEP;
      state = stepTrail(state, { x: px, y: py }, PARAMS).state;
    }
    expect(followerPosition(state)).toEqual({ x: 24, y: 0 });
    // Down 24 px: Follower must land exactly on the corner (48, 0)
    let sawCorner = false;
    for (let i = 0; i < 12; i++) {
      py += STEP;
      state = stepTrail(state, { x: px, y: py }, PARAMS).state;
      const f = followerPosition(state);
      // Never cuts the corner: either still on the horizontal leg or on the vertical leg
      expect(f.y === 0 || f.x === 48).toBe(true);
      if (f.x === 48 && f.y === 0) sawCorner = true;
    }
    expect(py).toBe(24);
    expect(sawCorner).toBe(true);
    expect(followerPosition(state)).toEqual({ x: 48, y: 0 });
  });

  it('out-and-back walk: Follower reaches the reversal point before any later sample (Req 4.1)', () => {
    let state = createTrail({ x: 0, y: 0 });
    let px = 0;
    for (let i = 0; i < 24; i++) {
      px += STEP;
      state = stepTrail(state, { x: px, y: 0 }, PARAMS).state;
    }
    expect(followerPosition(state)).toEqual({ x: 24, y: 0 });
    // Player doubles back 24 px to x = 24
    for (let j = 1; j <= 12; j++) {
      px -= STEP;
      state = stepTrail(state, { x: px, y: 0 }, PARAMS).state;
      const f = followerPosition(state);
      expect(f.x).toBe(24 + STEP * j); // keeps walking right toward the reversal point
      expect(f.x).toBeLessThanOrEqual(48);
    }
    expect(followerPosition(state)).toEqual({ x: 48, y: 0 });
  });

  it('short trail at game start holds the Follower in place (Req 3.7)', () => {
    let state = createTrail({ x: 10, y: 10 });
    let px = 10;
    for (let i = 0; i < 10; i++) {
      px += STEP; // up to x = 30, gap = 20 < 24
      state = stepTrail(state, { x: px, y: 10 }, PARAMS).state;
      expect(followerPosition(state)).toEqual({ x: 10, y: 10 });
    }
    expect(state.gap).toBe(20);
  });

  it('exactly 64 px keeps the trail; 64.01 px resets it (Req 8.6, 8.7)', () => {
    const base = createTrail({ x: 0, y: 0 });
    const kept = stepTrail(base, { x: TELEPORT_THRESHOLD_PX, y: 0 }, PARAMS);
    expect(kept.teleported).toBe(false);
    expect(kept.state.samples.length).toBe(2);

    const reset = stepTrail(base, { x: 64.01, y: 0 }, PARAMS);
    expect(reset.teleported).toBe(true);
    expect(reset.state.samples).toEqual([{ x: 64.01, y: 0 }]);
    expect(reset.state.gap).toBe(0);
  });

  it('trimTrail cuts the oldest segment at the exact limit', () => {
    const state = { samples: [{ x: 0, y: 0 }, { x: 100, y: 0 }], gap: 10 };
    const out = trimTrail(state, FOLLOW_DISTANCE_PX, TRAIL_SLACK_PX);
    expect(out.samples).toEqual([{ x: 44, y: 0 }, { x: 100, y: 0 }]);
    expect(pathLength(out.samples)).toBe(FOLLOW_DISTANCE_PX + TRAIL_SLACK_PX);
    expect(out.gap).toBe(10);
    expect(followerPosition(out)).toEqual(followerPosition(state));

    // Gap larger than fd+slack raises the limit to the gap
    const big = { samples: [{ x: 0, y: 0 }, { x: 100, y: 0 }], gap: 80 };
    const out2 = trimTrail(big, FOLLOW_DISTANCE_PX, TRAIL_SLACK_PX);
    expect(pathLength(out2.samples)).toBe(80);
    expect(out2.samples[0]).toEqual({ x: 20, y: 0 });
  });

  it('motivating case: doubling back 12 px then stopping settles behind the Player (Req 13.1, 13.4)', () => {
    const y = 5;
    const state = {
      samples: [{ x: 16, y }, { x: 40, y }, { x: 28, y }],
      gap: 24,
    };
    const follower = followerPosition(state);
    expect(follower).toEqual({ x: 28, y });
    const player = { x: 28, y };
    expect(
      shouldSettle({
        playerStopped: true,
        gap: state.gap,
        followDistance: FOLLOW_DISTANCE_PX,
        followerPos: follower,
        playerPos: player,
      }),
    ).toBe(true);
    const spot = restSpotCandidates(player, 'left', FOLLOW_DISTANCE_PX)[0];
    expect(spot).toEqual({ x: 52, y });
  });

  it('restSpotCandidates returns behind, front, above, below per facing', () => {
    const p = { x: 100, y: 50 };
    const above = { x: 100, y: 26 };
    const below = { x: 100, y: 74 };
    expect(restSpotCandidates(p, 'left', 24)).toEqual([{ x: 124, y: 50 }, { x: 76, y: 50 }, above, below]);
    expect(restSpotCandidates(p, 'right', 24)).toEqual([{ x: 76, y: 50 }, { x: 124, y: 50 }, above, below]);
    expect(restSpotCandidates(p, 'up', 24)).toEqual([below, above, above, below]);
    expect(restSpotCandidates(p, 'down', 24)).toEqual([above, below, above, below]);
  });

  it('stepToward snaps within 1 px and holds on a negative maxStep', () => {
    const snapped = stepToward({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, 0.1);
    expect(snapped).toEqual({ pos: { x: 0.5, y: 0.5 }, arrived: true });

    const from = { x: 0, y: 0 };
    expect(stepToward(from, { x: 10, y: 0 }, -1)).toEqual({ pos: from, arrived: false });

    const partial = stepToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(partial).toEqual({ pos: { x: 4, y: 0 }, arrived: false });
  });

  it('reseedTrail: coincident gives one sample; otherwise two samples with gap = distance', () => {
    expect(reseedTrail({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({
      samples: [{ x: 3, y: 3 }],
      gap: 0,
    });
    const t = reseedTrail({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(t.samples).toEqual([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
    expect(t.gap).toBe(5);
  });
});
