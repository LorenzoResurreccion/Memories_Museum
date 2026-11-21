import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createLimiter, MAX_FAILURES, WINDOW_SECONDS } from '../src/limiter.js';

const ips = ['10.0.0.1', '10.0.0.2', '2001:db8::1'];

/** One operation at a time step (seconds since the previous op). */
const opArb = fc.record({
  kind: fc.constantFrom('fail', 'fail', 'fail', 'success', 'check'),
  ip: fc.constantFrom(...ips),
  dt: fc.oneof(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 100, max: 1200 })),
});

describe('limiter (property tests)', () => {
  // Feature: museum-login, Property 6: Limiter thresholds
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  it('Property 6: locks an IP exactly at 5 failures inside its 15-minute window, per IP, cleared by success', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 120 }), (ops) => {
        const limiter = createLimiter();
        /** Reference model: per IP, the failure timestamps in its current window. */
        const model = new Map();
        const modelWindow = (ip, now) => {
          const w = model.get(ip);
          if (w && now >= w.start + WINDOW_SECONDS) model.delete(ip);
          return model.get(ip);
        };

        let now = 1_000_000;
        for (const op of ops) {
          now += op.dt;
          if (op.kind === 'fail') {
            const w = modelWindow(op.ip, now);
            if (w) w.count += 1;
            else model.set(op.ip, { start: now, count: 1 });
            limiter.recordFailure(op.ip, now);
          } else if (op.kind === 'success') {
            model.delete(op.ip);
            limiter.clear(op.ip);
          }

          // After every op, every IP's lock state matches the model.
          for (const ip of ips) {
            const w = modelWindow(ip, now);
            const expectedLocked = Boolean(w && w.count >= MAX_FAILURES);
            const got = limiter.isLocked(ip, now);
            expect(got.locked).toBe(expectedLocked);
            if (expectedLocked) {
              expect(got.retryAfterSeconds).toBe(Math.max(1, w.start + WINDOW_SECONDS - now));
              expect(got.retryAfterSeconds).toBeGreaterThan(0);
              expect(got.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
            } else {
              expect(got.retryAfterSeconds).toBe(0);
            }
          }
          // Expired entries are swept: never more tracked IPs than the model has.
          expect(limiter.size).toBe(model.size);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("another IP's failures never lock this IP", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 200 }), fc.integer({ min: 0, max: WINDOW_SECONDS - 1 }), (n, dt) => {
        const limiter = createLimiter();
        for (let i = 0; i < n; i += 1) limiter.recordFailure('attacker', 0);
        expect(limiter.isLocked('attacker', dt).locked).toBe(true);
        expect(limiter.isLocked('her', dt)).toEqual({ locked: false, retryAfterSeconds: 0 });
      }),
    );
  });

  it('examples: thresholds and window edges', () => {
    const limiter = createLimiter();
    for (let i = 0; i < 4; i += 1) limiter.recordFailure('a', 100 + i);
    expect(limiter.isLocked('a', 104).locked).toBe(false);
    limiter.recordFailure('a', 110);
    expect(limiter.isLocked('a', 110)).toEqual({ locked: true, retryAfterSeconds: 890 });
    expect(limiter.isLocked('a', 100 + WINDOW_SECONDS - 1)).toEqual({ locked: true, retryAfterSeconds: 1 });
    expect(limiter.isLocked('a', 100 + WINDOW_SECONDS)).toEqual({ locked: false, retryAfterSeconds: 0 });
    expect(limiter.size).toBe(0);
  });

  it('defaults are 5 failures per 15 minutes', () => {
    expect(MAX_FAILURES).toBe(5);
    expect(WINDOW_SECONDS).toBe(900);
  });
});
