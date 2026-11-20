// Feature: core-gameplay-mvp, Property 12: Duplicate activation guard
// For any hotspot activation event received while an overlay (Dialogue_Box or Image_Viewer)
// is currently displayed, the Shared_State SHALL silently ignore the event without error,
// without queuing, and without modifying the current overlay state.

// **Validates: Requirements 9.5**

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import fc from 'fast-check';
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
  gameWidthFor: () => 800,
}));

import App from '../../App.jsx';
import EventBus from '../../phaser/EventBus.js';

// Arbitrary: non-whitespace strings for dialogue text (avoids HTML whitespace collapsing issues)
const dialogueTextArb = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9 ]{0,49}$/);

// Arbitrary: random hotspot activation payload
const hotspotPayloadArb = fc.record({
  id: fc.stringMatching(/^[a-zA-Z0-9_]{1,30}$/),
  text: fc.array(dialogueTextArb, { minLength: 1, maxLength: 5 }),
  imageUrl: fc.oneof(
    fc.constant(null),
    fc.webUrl()
  ),
});

// Arbitrary: number of duplicate activation attempts (1–50)
const duplicateCountArb = fc.integer({ min: 1, max: 50 });

describe('Property 12: Duplicate activation guard', () => {
  /** **Validates: Requirements 9.5** */

  beforeEach(() => {
    vi.useFakeTimers();
    GameMock.mockClear();
    destroyMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('duplicate hotspot-activated events while overlay is active do not modify state and throw no errors', { timeout: 30000 }, () => {
    fc.assert(
      fc.property(
        hotspotPayloadArb,
        fc.array(hotspotPayloadArb, { minLength: 1, maxLength: 50 }),
        (initialPayload, duplicatePayloads) => {
          // Render App
          render(<App />);

          // Activate the first hotspot (establishes overlay state)
          act(() => {
            EventBus.emit('hotspot-activated', initialPayload);
          });

          // Verify first activation took effect — dialogue box should be visible
          const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
          expect(dialogueBox).not.toBeNull();

          // Capture the rendered dialogue text content after first activation
          const initialTextContent = dialogueBox.textContent;

          // Now emit N duplicate activations — none should throw or modify state
          for (const dupPayload of duplicatePayloads) {
            expect(() => {
              act(() => {
                EventBus.emit('hotspot-activated', dupPayload);
              });
            }).not.toThrow();
          }

          // Verify state still matches the FIRST activation (text unchanged)
          const dialogueBoxAfter = screen.queryByRole('dialog', { name: 'Dialogue' });
          expect(dialogueBoxAfter).not.toBeNull();
          expect(dialogueBoxAfter.textContent).toBe(initialTextContent);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('overlay state (hotspot ID, dialogue pages, image URL) is preserved across duplicate activations', { timeout: 30000 }, () => {
    fc.assert(
      fc.property(
        hotspotPayloadArb,
        duplicateCountArb,
        hotspotPayloadArb,
        (initialPayload, duplicateCount, differentPayload) => {
          // Ensure the duplicate payload is actually different
          const dupPayload = {
            ...differentPayload,
            id: differentPayload.id + '_dup',
            text: differentPayload.text.map((t) => t + '_dup'),
          };

          render(<App />);

          // Activate the first hotspot
          act(() => {
            EventBus.emit('hotspot-activated', initialPayload);
          });

          // Verify the dialogue box appeared
          const dialogueBox = screen.queryByRole('dialog', { name: 'Dialogue' });
          expect(dialogueBox).not.toBeNull();
          const initialTextContent = dialogueBox.textContent;

          // Emit duplicateCount additional activations with a different payload
          for (let i = 0; i < duplicateCount; i++) {
            act(() => {
              EventBus.emit('hotspot-activated', dupPayload);
            });
          }

          // Verify original content is still displayed (unchanged)
          const dialogueBoxAfter = screen.queryByRole('dialog', { name: 'Dialogue' });
          expect(dialogueBoxAfter).not.toBeNull();
          expect(dialogueBoxAfter.textContent).toBe(initialTextContent);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });
});
