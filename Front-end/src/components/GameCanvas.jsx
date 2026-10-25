import { useRef, useEffect } from 'react';
import Phaser from 'phaser';
import { gameConfig } from '../phaser/config.js';

/**
 * GameCanvas — self-contained React wrapper for the Phaser game instance.
 *
 * On mount it creates a Phaser.Game attached to an internal <div>.
 * On unmount it destroys the game to release the WebGL context.
 */
export default function GameCanvas() {
  const containerRef = useRef(null);

  useEffect(() => {
    const game = new Phaser.Game({
      ...gameConfig,
      parent: containerRef.current,
    });

    return () => {
      game.destroy(true);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}
