// Feature: core-gameplay-mvp — Integration tests for the full Phaser–React communication loop
// Tests the end-to-end flow: hotspot activation → overlay display → dismiss → game resumes

// **Validates: Requirements 6.4, 7.1, 8.4, 9.4**

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';

// Mock Phaser and GameCanvas before importing App
const { GameMock, destroyMock } = vi.hoisted(() => {
  const destroyMock = vi.fn();
  const GameMock = vi.fn(function () {
    this.destroy = destroyMock;
  });
  return { GameMock, destroyMock };
});

vi.mock('phaser', () => ({
  default: { Game: GameMock },
  AUTO: 0,
}));

vi.mock('../../phaser/config.js', () => ({
  gameConfig: { type: 0, width: 800, height: 600, scene: [] },
}));

import App from '../../App.jsx';
import EventBus from '../../phaser/EventBus.js';

describe('Integration: Phaser–React communication loop', () => {
  /** **Validates: Requirements 6.4, 7.1, 8.4, 9.4** */

  beforeEach(() => {
    vi.useFakeTimers();
    GameMock.mockClear();
    destroyMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    // Clean up any lingering EventBus listeners
    EventBus._listeners.clear();
    vi.useRealTimers();
  });

  describe('Hotspot activation → DialogueBox appears → dismiss → game resumes', () => {
    it('shows DialogueBox when hotspot-activated is emitted with text', () => {
      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_1',
          text: ['Hello, this is a memory.'],
          imageUrl: null,
        });
      });

      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBox).not.toBeNull();
      expect(dialogueBox.textContent).toContain('Hello, this is a memory.');
    });

    it('dismisses DialogueBox on Enter key and emits dialogue-dismissed', () => {
      const dismissSpy = vi.fn();
      EventBus.on('dialogue-dismissed', dismissSpy);

      render(<App />);

      // Activate hotspot with single page of text
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_1',
          text: ['A single page memory.'],
          imageUrl: null,
        });
      });

      // Verify DialogueBox is visible
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();

      // Advance past 300ms debounce
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Press Enter to dismiss
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });

      // Verify dialogue-dismissed was emitted
      expect(dismissSpy).toHaveBeenCalledTimes(1);

      // Verify DialogueBox is gone
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();

      EventBus.off('dialogue-dismissed', dismissSpy);
    });

    it('advances through multiple pages then dismisses on final page', () => {
      const dismissSpy = vi.fn();
      EventBus.on('dialogue-dismissed', dismissSpy);

      render(<App />);

      // Activate with multi-page dialogue
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_2',
          text: ['Page one.', 'Page two.', 'Page three.'],
          imageUrl: null,
        });
      });

      // Verify first page is shown
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page one.');

      // Advance past debounce
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Press Enter → advance to page 2
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page two.');

      // Press Space → advance to page 3
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page three.');

      // Press Enter → dismiss (final page)
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });

      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();

      EventBus.off('dialogue-dismissed', dismissSpy);
    });

    it('overlay state clears fully after dismissal, allowing re-activation', () => {
      render(<App />);

      // First activation
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_1',
          text: ['First memory.'],
          imageUrl: null,
        });
      });

      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();

      // Advance past debounce and dismiss
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });

      // Overlay should be gone
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();

      // Second activation should work
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_2',
          text: ['Second memory.'],
          imageUrl: null,
        });
      });

      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBox).not.toBeNull();
      expect(dialogueBox.textContent).toContain('Second memory.');
    });
  });

  describe('Hotspot with image → both DialogueBox and ImageViewer appear', () => {
    it('shows both DialogueBox and ImageViewer when hotspot has text and imageUrl (Req 8.4)', () => {
      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'photo_memory_1',
          text: ['Look at this photo from our trip!'],
          imageUrl: 'https://example.com/photo.png',
        });
      });

      // Both should be visible simultaneously
      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      const imageViewer = screen.queryByRole('dialog', { name: 'Image Viewer' });

      expect(dialogueBox).not.toBeNull();
      expect(imageViewer).not.toBeNull();
      expect(dialogueBox.textContent).toContain('Look at this photo from our trip!');
    });

    it('dismissing image via close button keeps dialogue visible', () => {
      const imageDismissSpy = vi.fn();
      EventBus.on('image-dismissed', imageDismissSpy);

      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'photo_memory_2',
          text: ['A memory with photo.'],
          imageUrl: 'https://example.com/photo2.png',
        });
      });

      // Both visible
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();

      // Dismiss image via close button (does not trigger dialogue dismiss)
      const closeButton = screen.queryByRole('button', { name: 'Close' });
      expect(closeButton).not.toBeNull();

      act(() => {
        fireEvent.click(closeButton);
      });

      // Image dismissed, dialogue still visible
      expect(imageDismissSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();

      EventBus.off('image-dismissed', imageDismissSpy);
    });

    it('Enter key dismisses both dialogue and image simultaneously when both are visible', () => {
      const dialogueDismissSpy = vi.fn();
      const imageDismissSpy = vi.fn();
      EventBus.on('dialogue-dismissed', dialogueDismissSpy);
      EventBus.on('image-dismissed', imageDismissSpy);

      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'photo_memory_3',
          text: ['Memory text.'],
          imageUrl: 'https://example.com/photo3.png',
        });
      });

      // Both visible
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();

      // Advance past debounce and press Enter — both share the keydown listener
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });

      // Both are dismissed (single-page dialogue + image both respond to Enter)
      expect(dialogueDismissSpy).toHaveBeenCalledTimes(1);
      expect(imageDismissSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).toBeNull();

      EventBus.off('dialogue-dismissed', dialogueDismissSpy);
      EventBus.off('image-dismissed', imageDismissSpy);
    });
  });

  describe('Overlay lock prevents second activation', () => {
    it('ignores hotspot-activated events while overlay is already active (Req 6.4, 9.4)', () => {
      render(<App />);

      // First activation
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_A',
          text: ['First memory text.'],
          imageUrl: null,
        });
      });

      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBox).not.toBeNull();
      expect(dialogueBox.textContent).toContain('First memory text.');

      // Second activation while overlay is active — should be ignored
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_B',
          text: ['Second memory text — should NOT appear.'],
          imageUrl: 'https://example.com/should-not-show.png',
        });
      });

      // Overlay still shows first activation content
      const dialogueBoxAfter = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBoxAfter).not.toBeNull();
      expect(dialogueBoxAfter.textContent).toContain('First memory text.');
      expect(dialogueBoxAfter.textContent).not.toContain('Second memory text');

      // ImageViewer should NOT have appeared from the second activation
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).toBeNull();
    });

    it('does not throw errors when duplicate activations are received', () => {
      render(<App />);

      // First activation
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory_lock_1',
          text: ['Locked memory.'],
          imageUrl: null,
        });
      });

      // Multiple rapid activations should not throw
      expect(() => {
        act(() => {
          EventBus.emit('hotspot-activated', {
            id: 'memory_lock_2',
            text: ['Should be ignored.'],
            imageUrl: null,
          });
        });
        act(() => {
          EventBus.emit('hotspot-activated', {
            id: 'memory_lock_3',
            text: ['Also ignored.'],
            imageUrl: 'https://example.com/ignored.png',
          });
        });
      }).not.toThrow();

      // Original content still displayed
      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBox.textContent).toContain('Locked memory.');
    });

    it('lock releases after full dismissal cycle, allowing new activation', () => {
      render(<App />);

      // Activate with text + image
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'locked_1',
          text: ['Locked dialogue.'],
          imageUrl: 'https://example.com/locked.png',
        });
      });

      // Attempt to activate another — should be blocked
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'blocked_1',
          text: ['Blocked.'],
          imageUrl: null,
        });
      });

      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Locked dialogue.');

      // Dismiss image first via close button (dialogue stays)
      const closeButton = screen.queryByRole('button', { name: 'Close' });
      expect(closeButton).not.toBeNull();
      act(() => {
        fireEvent.click(closeButton);
      });

      // Now dismiss dialogue via keypress
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });

      // Now overlay is fully cleared — new activation should work
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'new_memory',
          text: ['New memory after unlock.'],
          imageUrl: null,
        });
      });

      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBox).not.toBeNull();
      expect(dialogueBox.textContent).toContain('New memory after unlock.');
    });
  });
});
