import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so mock refs are available inside vi.mock factories
const { destroyMock, GameMock } = vi.hoisted(() => {
  const destroyMock = vi.fn();
  // Must use function (not arrow) so it can be called with `new`
  const GameMock = vi.fn(function () {
    this.destroy = destroyMock;
  });
  return { destroyMock, GameMock };
});

vi.mock('phaser', () => ({
  default: { Game: GameMock },
  AUTO: 0,
}));

vi.mock('../../phaser/config.js', () => ({
  gameConfig: { type: 0, width: 800, height: 600, scene: [] },
}));

import GameCanvas from '../GameCanvas.jsx';

describe('GameCanvas', () => {
  beforeEach(() => {
    GameMock.mockClear();
    destroyMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a container div sized to fill the viewport', () => {
    const { container } = render(<GameCanvas />);
    const div = container.firstChild;

    expect(div).toBeDefined();
    expect(div.style.width).toBe('100%');
    expect(div.style.height).toBe('100%');
  });

  it('creates a Phaser.Game on mount with the container as parent', () => {
    const { container } = render(<GameCanvas />);
    const div = container.firstChild;

    expect(GameMock).toHaveBeenCalledTimes(1);
    const callArgs = GameMock.mock.calls[0][0];
    expect(callArgs.parent).toBe(div);
    expect(callArgs.width).toBe(800);
    expect(callArgs.height).toBe(600);
  });

  it('destroys the Phaser.Game on unmount', () => {
    const { unmount } = render(<GameCanvas />);

    expect(destroyMock).not.toHaveBeenCalled();
    unmount();
    expect(destroyMock).toHaveBeenCalledWith(true);
  });
});
