import { AUTO } from 'phaser';
import GameScene from './GameScene.js';

/**
 * Phaser game configuration for the core gameplay MVP.
 *
 * - 800×600 canvas with arcade physics (no gravity)
 * - Pixel-art rendering: pixelArt + roundPixels, no antialiasing
 * - Camera zoom is configured separately in GameScene.create()
 */
export const gameConfig = {
  type: AUTO,
  width: 800,
  height: 600,
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scene: [GameScene],
  pixelArt: true,
  roundPixels: true,
  antialias: false
};
