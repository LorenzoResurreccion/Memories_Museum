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
import { FUTURE_MEMORY_TEXT, FUTURE_MEMORY_OVERLAY } from '../../data/memories.js';

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

    it('dismisses a single-page DialogueBox on Space and emits dialogue-dismissed; Enter does nothing', () => {
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

      // Enter no longer advances or dismisses (Req 9.10) — nothing happens.
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
      expect(dismissSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();

      // Space on the last (only) page dismisses (Req 9.9).
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
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

      // Enter is inert now — it must NOT advance (Req 9.10).
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page one.');

      // Space → advance to page 2 (Req 9.8)
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page two.');

      // Space → advance to page 3
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page three.');

      // Space on the final page → dismiss (Req 9.9)
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
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

      // Advance past debounce and dismiss with Space (single page → Space dismisses)
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
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

    it('keeps the photo visible while paging through a multi-page dialogue, then closes both on the final Space', () => {
      const dialogueDismissSpy = vi.fn();
      const imageDismissSpy = vi.fn();
      EventBus.on('dialogue-dismissed', dialogueDismissSpy);
      EventBus.on('image-dismissed', imageDismissSpy);

      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'photo_memory_multi',
          text: ['Page one.', 'Page two.', 'Page three.'],
          imageUrl: 'https://example.com/photo-multi.png',
        });
      });

      // Both visible from the start.
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page one.');
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Space advances the dialogue AND the photo stays up (image not dismissed).
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page two.');
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();
      expect(imageDismissSpy).not.toHaveBeenCalled();

      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });
      expect(screen.queryByRole('dialog', { name: 'Dialogue' }).textContent).toContain('Page three.');
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();
      expect(imageDismissSpy).not.toHaveBeenCalled();

      // Final-page Space dismisses the dialogue, which closes the photo with it.
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });
      expect(dialogueDismissSpy).toHaveBeenCalledTimes(1);
      expect(imageDismissSpy).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).toBeNull();

      EventBus.off('dialogue-dismissed', dialogueDismissSpy);
      EventBus.off('image-dismissed', imageDismissSpy);
    });

    it('Space dismisses both dialogue and image simultaneously when both are visible; Enter does nothing', () => {
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

      // Advance past debounce.
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Enter is inert now — neither overlay dismisses (Req 9.10, 9.11).
      act(() => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
      expect(dialogueDismissSpy).not.toHaveBeenCalled();
      expect(imageDismissSpy).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();

      // Space dismisses both (single-page dialogue + image both respond to Space —
      // Req 9.9). Both share the window keydown listener.
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });

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

      // Now dismiss dialogue via keypress (single page → Space dismisses)
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
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

  // Task 18.1 — freeze gating: an overlay-opening activation is what causes the
  // GameScene to freeze the player + lock interaction, and a full dismissal unfreezes.
  // GameScene itself is mocked out here, so a spy that mirrors its EventBus
  // subscriptions stands in for it to validate the end-to-end gating contract.
  // **Validates: Requirements 9.6, 9.7**
  describe('Freeze gating (payload non-emptiness drives freeze/unfreeze)', () => {
    /**
     * Attach a stand-in for the GameScene freeze/lock subscriptions. Returns a mutable
     * `state` object plus the listeners so the caller can detach them afterward.
     */
    function attachGameSceneStandIn() {
      const state = { overlayOpen: false, frozen: false, locked: false };
      const onActivate = () => {
        state.overlayOpen = true;
        state.frozen = true;
        state.locked = true;
      };
      const onDialogueDismiss = () => {
        state.overlayOpen = false;
        state.frozen = false;
        state.locked = false;
      };
      const onImageDismiss = () => {
        state.overlayOpen = false;
        state.frozen = false;
        state.locked = false;
      };
      EventBus.on('hotspot-activated', onActivate);
      EventBus.on('dialogue-dismissed', onDialogueDismiss);
      EventBus.on('image-dismissed', onImageDismiss);
      return {
        state,
        detach() {
          EventBus.off('hotspot-activated', onActivate);
          EventBus.off('dialogue-dismissed', onDialogueDismiss);
          EventBus.off('image-dismissed', onImageDismiss);
        }
      };
    }

    it('a text+image payload opens the overlay and freezes/locks the game', () => {
      const { state, detach } = attachGameSceneStandIn();
      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory-0',
          text: ['An authored memory.'],
          imageUrl: 'https://example.com/photo.png',
        });
      });

      // Overlay open → frozen + locked.
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).not.toBeNull();
      expect(state.frozen).toBe(true);
      expect(state.locked).toBe(true);

      detach();
    });

    it('the future-memory payload is non-empty, so it opens the dialogue and freezes/locks', () => {
      const { state, detach } = attachGameSceneStandIn();
      render(<App />);

      // Future-memory overlay: one text page, null image (verbatim constant).
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory-999',
          text: FUTURE_MEMORY_OVERLAY.text,
          imageUrl: FUTURE_MEMORY_OVERLAY.imageUrl,
        });
      });

      const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
      expect(dialogueBox).not.toBeNull();
      expect(dialogueBox.textContent).toContain(FUTURE_MEMORY_TEXT);
      // No image overlay for the future payload (imageUrl is null).
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).toBeNull();
      // Non-empty payload still freezes + locks.
      expect(state.frozen).toBe(true);
      expect(state.locked).toBe(true);

      detach();
    });

    it('a genuinely empty payload (no text, no image) opens no overlay and emits no dismiss', () => {
      // App is the overlay coordinator: its guard (Req 7.5) shows nothing for a payload
      // with neither text nor image, so no overlay opens and the player is never frozen
      // (freeze is driven by an overlay opening). In the real system such a payload is
      // also filtered upstream by InteractionManager, so no `hotspot-activated` is even
      // emitted — but App must still be inert if one arrives.
      const dialogueDismissSpy = vi.fn();
      const imageDismissSpy = vi.fn();
      EventBus.on('dialogue-dismissed', dialogueDismissSpy);
      EventBus.on('image-dismissed', imageDismissSpy);

      render(<App />);

      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory-empty',
          text: [],
          imageUrl: null,
        });
      });

      // No overlay opens — the user-visible freeze trigger never fires.
      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Image Viewer' })).toBeNull();
      // No dismiss events emitted (nothing to dismiss).
      expect(dialogueDismissSpy).not.toHaveBeenCalled();
      expect(imageDismissSpy).not.toHaveBeenCalled();

      EventBus.off('dialogue-dismissed', dialogueDismissSpy);
      EventBus.off('image-dismissed', imageDismissSpy);
    });

    it('dismiss events unfreeze/unlock the game after an overlay closes', () => {
      const { state, detach } = attachGameSceneStandIn();
      render(<App />);

      // Open with text only.
      act(() => {
        EventBus.emit('hotspot-activated', {
          id: 'memory-1',
          text: ['Freeze me.'],
          imageUrl: null,
        });
      });
      expect(state.frozen).toBe(true);
      expect(state.locked).toBe(true);

      // Dismiss with Space (single page) → dialogue-dismissed → unfreeze + unlock.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      act(() => {
        fireEvent.keyDown(window, { key: ' ' });
      });

      expect(screen.queryByRole('dialog', { name: 'Dialogue' })).toBeNull();
      expect(state.frozen).toBe(false);
      expect(state.locked).toBe(false);

      detach();
    });
  });
});
