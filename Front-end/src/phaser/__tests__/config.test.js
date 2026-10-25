import { describe, it, expect, vi } from 'vitest';

// Phaser requires a Canvas context at import time — mock it for jsdom
vi.mock('phaser', () => ({
  AUTO: 0,
  Scene: class Scene {
    constructor() {}
  }
}));

import { AUTO } from 'phaser';
import { gameConfig } from '../config.js';
import GameScene from '../GameScene.js';

describe('gameConfig', () => {
  it('uses Phaser AUTO renderer type', () => {
    expect(gameConfig.type).toBe(AUTO);
  });

  it('sets 800×600 resolution', () => {
    expect(gameConfig.width).toBe(800);
    expect(gameConfig.height).toBe(600);
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
});
