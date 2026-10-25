// Feature: infinite-hallway, Property 9: Prompt visibility iff zone overlap and no overlay
// **Validates: Requirements 8.1, 8.3, 8.4**
//
// The floating [E] prompt is visible if and only if the player overlaps an interaction
// zone AND no overlay is open. PromptLabel is pure presentation: GameScene computes the
// predicate `overlaps && !overlayOpen` and passes it to `promptLabel.setVisible(...)`
// each frame. This property drives PromptLabel with every (overlaps, overlayOpen)
// combination and asserts the label's resulting visibility equals the predicate.
//
// Phaser is mocked at module level; the scene's `add.text` returns a minimal mock Text
// recording its visible flag, so no live Phaser/Canvas is needed.

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import PromptLabel from '../PromptLabel.js';

/** A mock scene whose add.text returns a chainable mock Text tracking visibility. */
function createMockScene() {
  const label = {
    visible: true,
    depth: 0,
    x: 0,
    y: 0,
    setOrigin: vi.fn(function () {
      return this;
    }),
    setDepth: vi.fn(function (d) {
      this.depth = d;
      return this;
    }),
    setVisible: vi.fn(function (v) {
      this.visible = v;
      return this;
    }),
    setPosition: vi.fn(function (x, y) {
      this.x = x;
      this.y = y;
      return this;
    })
  };
  const scene = {
    add: {
      text: vi.fn(() => label)
    }
  };
  return { scene, label };
}

/** The visibility rule GameScene applies each frame (Req 8.1, 8.3, 8.4). */
function shouldShow(overlaps, overlayOpen) {
  return overlaps && !overlayOpen;
}

describe('PromptLabel — Property 9: prompt visibility iff overlap and no overlay', () => {
  /**
   * For every (overlaps, overlayOpen) pair across an arbitrary frame sequence, after
   * applying the rule the label is visible exactly when overlaps && !overlayOpen.
   * **Validates: Requirements 8.1, 8.3, 8.4**
   */
  it('is visible exactly when overlapping a zone and no overlay is open', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ overlaps: fc.boolean(), overlayOpen: fc.boolean() }), {
          minLength: 1,
          maxLength: 50
        }),
        (frames) => {
          const { scene, label } = createMockScene();
          const prompt = new PromptLabel(scene);

          for (const { overlaps, overlayOpen } of frames) {
            const expected = shouldShow(overlaps, overlayOpen);
            prompt.setVisible(expected);
            expect(label.visible).toBe(expected);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Exhaustive truth table for the four combinations: only (overlaps=true,
   * overlayOpen=false) shows the prompt. **Validates: Requirements 8.1, 8.3, 8.4**
   */
  it('matches the full truth table of (overlaps, overlayOpen)', () => {
    const cases = [
      { overlaps: false, overlayOpen: false, expected: false },
      { overlaps: false, overlayOpen: true, expected: false },
      { overlaps: true, overlayOpen: false, expected: true },
      { overlaps: true, overlayOpen: true, expected: false }
    ];

    for (const { overlaps, overlayOpen, expected } of cases) {
      const { scene, label } = createMockScene();
      const prompt = new PromptLabel(scene);
      prompt.setVisible(shouldShow(overlaps, overlayOpen));
      expect(label.visible).toBe(expected);
    }
  });
});
