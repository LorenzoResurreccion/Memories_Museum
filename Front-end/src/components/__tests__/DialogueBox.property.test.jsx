import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import fc from 'fast-check';

// Feature: core-gameplay-mvp, Property 10: Dialogue page advancement
// For any array of N pages (1 ≤ N ≤ 20), simulating N sequential confirm key presses
// results in exactly (N-1) calls to onAdvance and exactly 1 call to onDismiss.
// onAdvance is called for presses 1 through N-1, onDismiss is called only on the Nth press.

// **Validates: Requirements 7.6**

import DialogueBox from '../DialogueBox.jsx';

// Arbitrary: arrays of 1–20 non-empty strings representing dialogue pages
const pagesArb = fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 20 });

/**
 * Helper: renders the DialogueBox and simulates the full page advancement sequence.
 * Since the parent manages currentPage, we re-render with incremented currentPage
 * after each confirm press.
 */
function simulateFullDialogue(pages) {
  const onAdvance = vi.fn();
  const onDismiss = vi.fn();

  const { rerender } = render(
    <DialogueBox
      pages={pages}
      currentPage={0}
      visible={true}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
    />
  );

  // Advance past the 300ms debounce
  vi.advanceTimersByTime(301);

  // Simulate N confirm presses, re-rendering with updated currentPage each time
  for (let i = 0; i < pages.length; i++) {
    fireEvent.keyDown(window, { key: 'Enter' });

    // After each press (except the last), re-render with next page index
    if (i < pages.length - 1) {
      rerender(
        <DialogueBox
          pages={pages}
          currentPage={i + 1}
          visible={true}
          onAdvance={onAdvance}
          onDismiss={onDismiss}
        />
      );
    }
  }

  return { onAdvance, onDismiss };
}

describe('Property 10: Dialogue page advancement', () => {
  /** **Validates: Requirements 7.6** */

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('for any N pages, N sequential confirms produce exactly (N-1) onAdvance calls and 1 onDismiss call', { timeout: 30000 }, () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const { onAdvance, onDismiss } = simulateFullDialogue(pages);

        expect(onAdvance).toHaveBeenCalledTimes(pages.length - 1);
        expect(onDismiss).toHaveBeenCalledTimes(1);

        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('single-page arrays (N=1): first confirm fires onDismiss directly, not onAdvance', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (text) => {
          const pages = [text];
          const { onAdvance, onDismiss } = simulateFullDialogue(pages);

          expect(onAdvance).toHaveBeenCalledTimes(0);
          expect(onDismiss).toHaveBeenCalledTimes(1);

          cleanup();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('pages advance one-by-one from index 0 to N-1 before dismissal', () => {
    fc.assert(
      fc.property(pagesArb, (pages) => {
        const onAdvance = vi.fn();
        const onDismiss = vi.fn();

        const { rerender } = render(
          <DialogueBox
            pages={pages}
            currentPage={0}
            visible={true}
            onAdvance={onAdvance}
            onDismiss={onDismiss}
          />
        );

        vi.advanceTimersByTime(301);

        // Track that each press at page i calls the correct callback
        for (let i = 0; i < pages.length; i++) {
          const advanceCountBefore = onAdvance.mock.calls.length;
          const dismissCountBefore = onDismiss.mock.calls.length;

          fireEvent.keyDown(window, { key: 'Enter' });

          if (i < pages.length - 1) {
            // Not final page: onAdvance should increment
            expect(onAdvance).toHaveBeenCalledTimes(advanceCountBefore + 1);
            expect(onDismiss).toHaveBeenCalledTimes(dismissCountBefore);

            rerender(
              <DialogueBox
                pages={pages}
                currentPage={i + 1}
                visible={true}
                onAdvance={onAdvance}
                onDismiss={onDismiss}
              />
            );
          } else {
            // Final page: onDismiss should fire
            expect(onAdvance).toHaveBeenCalledTimes(advanceCountBefore);
            expect(onDismiss).toHaveBeenCalledTimes(dismissCountBefore + 1);
          }
        }

        cleanup();
      }),
      { numRuns: 100 }
    );
  });
});
