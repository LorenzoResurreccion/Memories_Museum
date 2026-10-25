import { describe, it, expect, vi } from 'vitest';

// Phaser requires a Canvas context at import time — mock it for jsdom
vi.mock('phaser', () => ({
  AUTO: 0,
  Scale: { NONE: 0, CENTER_BOTH: 3 },
  Scene: class Scene {
    constructor() {}
  }
}));

import { AUTO, Scale } from 'phaser';
import { gameConfig } from '../config.js';
import GameScene from '../GameScene.js';

describe('gameConfig', () => {
  it('uses Phaser AUTO renderer type', () => {
    expect(gameConfig.type).toBe(AUTO);
  });

  it('sets 1120×480 resolution (height = 240px map × 2× zoom so no black shows below the floor)', () => {
    expect(gameConfig.width).toBe(1120);
    expect(gameConfig.height).toBe(480);
  });

  it('configures arcade physics with no gravity', () => {
    expect(gameConfig.physics.default).toBe('arcade');
    expect(gameConfig.physics.arcade.gravity.y).toBe(0);
    expect(gameConfig.physics.arcade.debug).toBe(false);
  });

  it('references GameScene in the scene array', () => {
    expect(gameConfig.scene).toContain(GameScene);
    expect(gameConfig.scene).toHaveLength(1);
  });

  it('enables pixel-art rendering settings', () => {
    expect(gameConfig.pixelArt).toBe(true);
    expect(gameConfig.roundPixels).toBe(true);
    expect(gameConfig.antialias).toBe(false);
  });

  it('centers the canvas at native resolution so it does not hug the top-left', () => {
    expect(gameConfig.scale.mode).toBe(Scale.NONE);
    expect(gameConfig.scale.autoCenter).toBe(Scale.CENTER_BOTH);
  });
});
