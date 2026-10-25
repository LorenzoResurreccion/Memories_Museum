import { AUTO, Scale } from 'phaser';
import GameScene from './GameScene.js';

/**
 * Phaser game configuration for the core gameplay MVP.
 *
 * - 1120×480 canvas with arcade physics (no gravity). The height is the map height
 *   (15 tiles × 16px = 240px) times the camera's integer zoom (2, set in
 *   GameScene.create()) so the viewport's world height (height / zoom = 240) matches
 *   the map exactly. This removes any strip of empty black world beneath the bottom
 *   floor row: the camera cannot scroll past the 240px-tall map, so the viewport's
 *   world height must not exceed 240px. Width is unconstrained — the map is 928px+ wide
 *   and grows with segments — so the canvas can be as wide as we like.
 * - Pixel-art rendering: pixelArt + roundPixels, no antialiasing.
 * - Scale mode NONE at native resolution with CENTER_BOTH auto-centering so the canvas
 *   sits in the middle of its parent instead of hugging the top-left corner.
 * - Camera zoom is configured separately in GameScene.create().
 */
export const gameConfig = {
  type: AUTO,
  width: 1120,
  height: 480,
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scene: [GameScene],
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Scale.NONE,
    autoCenter: Scale.CENTER_BOTH
  }
};
