import { describe, it, expect, vi } from 'vitest';

// Feature: infinite-hallway — example tests for the pure `gidDecode` helper.
//
// These are concrete, hand-picked examples (no fast-check) that pin down the
// Tiled GID bit layout for specific real-world GIDs the converted maps emit:
//   - a horizontally-flipped tile id 25 (`2147483673`)
//   - a horizontally-flipped tile id 36 (`2147483684`)
//   - plain ids with no flip bits
//   - a masked frame <= 0 (caller treats as empty)
//   - a diagonally-flagged GID (flipD reported, never throws)
//
// **Validates: Requirements 7.1, 7.2**

// Mock Phaser at module level since Canvas/WebGL isn't available in jsdom.
// GameScene.js imports (and its scene class extends) Phaser's Scene at module
// load, so the mock must supply a Scene export and precede the import.
vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import { gidDecode } from '../GameScene.js';

// Tiled flip bits (top 3 bits of a 32-bit GID).
const FLIP_D = 0x20000000;

describe('gidDecode — example tests', () => {
  it('decodes 2147483673 => id 25 with horizontal flip only', () => {
    let decoded;
    expect(() => {
      decoded = gidDecode(2147483673);
    }).not.toThrow();

    expect(decoded.frame).toBe(25);
    expect(decoded.flipH).toBe(true);
    expect(decoded.flipV).toBe(false);
    expect(decoded.flipD).toBe(false);
  });

  it('decodes 2147483684 => id 36 with horizontal flip only', () => {
    let decoded;
    expect(() => {
      decoded = gidDecode(2147483684);
    }).not.toThrow();

    expect(decoded.frame).toBe(36);
    expect(decoded.flipH).toBe(true);
    expect(decoded.flipV).toBe(false);
    expect(decoded.flipD).toBe(false);
  });

  it('decodes a plain id (no flip bits) with all flags false', () => {
    let decoded;
    expect(() => {
      decoded = gidDecode(13);
    }).not.toThrow();

    expect(decoded.frame).toBe(13);
    expect(decoded.flipH).toBe(false);
    expect(decoded.flipV).toBe(false);
    expect(decoded.flipD).toBe(false);
  });

  it('decodes 0 => frame 0 without throwing (caller treats frame <= 0 as empty)', () => {
    // A masked frame <= 0 is returned as-is; the caller (layer builder) is
    // responsible for treating it as an empty cell and skipping it.
    let decoded;
    expect(() => {
      decoded = gidDecode(0);
    }).not.toThrow();

    expect(decoded.frame).toBe(0);
    expect(decoded.flipH).toBe(false);
    expect(decoded.flipV).toBe(false);
    expect(decoded.flipD).toBe(false);
  });

  it('reports flipD for a diagonally-flagged GID without throwing', () => {
    const gid = FLIP_D | 13;
    let decoded;
    expect(() => {
      decoded = gidDecode(gid);
    }).not.toThrow();

    expect(decoded.frame).toBe(13);
    expect(decoded.flipD).toBe(true);
    expect(decoded.flipH).toBe(false);
    expect(decoded.flipV).toBe(false);
  });
});
