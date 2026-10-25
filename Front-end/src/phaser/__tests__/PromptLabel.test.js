import { describe, it, expect, vi, beforeEach } from 'vitest';

// Feature: infinite-hallway — example tests for PromptLabel.
//
// Concrete scenarios pinning the floating [E] prompt's behavior:
//   - Created hidden, at the overhead depth band (>= 10000) so decor never occludes it.
//   - Visibility follows the rule applied by GameScene: overlap + no overlay => visible;
//     overlay open => hidden; no overlap => hidden.
//   - follow(player) keeps a FIXED vertical offset above the player's top edge as the
//     player moves.
//
// Phaser is mocked at module level; the scene's add.text returns a minimal mock Text.
//
// _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import PromptLabel from '../PromptLabel.js';

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
    add: { text: vi.fn(() => label) }
  };
  return { scene, label };
}

describe('PromptLabel — example tests', () => {
  let scene, label, prompt;

  beforeEach(() => {
    ({ scene, label } = createMockScene());
    prompt = new PromptLabel(scene);
  });

  it('creates the [E] label hidden, at overhead depth (>= 10000)', () => {
    expect(scene.add.text).toHaveBeenCalledTimes(1);
    const [, , content] = scene.add.text.mock.calls[0];
    expect(content).toBe('[E]');
    expect(label.visible).toBe(false);
    expect(label.depth).toBeGreaterThanOrEqual(10000);
  });

  it('overlap + no overlay => visible', () => {
    const overlaps = true;
    const overlayOpen = false;
    prompt.setVisible(overlaps && !overlayOpen);
    expect(label.visible).toBe(true);
  });

  it('overlay open => hidden (even when overlapping)', () => {
    const overlaps = true;
    const overlayOpen = true;
    prompt.setVisible(overlaps && !overlayOpen);
    expect(label.visible).toBe(false);
  });

  it('no overlap => hidden', () => {
    const overlaps = false;
    const overlayOpen = false;
    prompt.setVisible(overlaps && !overlayOpen);
    expect(label.visible).toBe(false);
  });

  it('follow keeps a fixed offset above the player top as the player moves', () => {
    const offsetY = prompt.offsetY; // default -8

    // Player A: feet origin (0.5, 1), so top edge = y - displayHeight.
    const playerA = { x: 100, y: 200, displayHeight: 32 };
    prompt.follow(playerA);
    expect(label.x).toBe(100);
    expect(label.y).toBe(200 - 32 + offsetY);

    // Move the player; the label tracks with the SAME offset above the top edge.
    const playerB = { x: 640, y: 128, displayHeight: 32 };
    prompt.follow(playerB);
    expect(label.x).toBe(640);
    expect(label.y).toBe(128 - 32 + offsetY);

    // The vertical gap between the player's top edge and the label is invariant.
    const gapA = 200 - 32 - (200 - 32 + offsetY);
    const gapB = 128 - 32 - (128 - 32 + offsetY);
    expect(gapA).toBe(gapB);
  });

  it('follow falls back to player.y as the anchor when displayHeight is absent', () => {
    const offsetY = prompt.offsetY;
    prompt.follow({ x: 50, y: 300 });
    expect(label.x).toBe(50);
    expect(label.y).toBe(300 + offsetY);
  });
});
