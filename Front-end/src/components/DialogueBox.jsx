import { useEffect, useRef } from 'react';
import './DialogueBox.css';

/**
 * DialogueBox — renders dialogue text anchored to the bottom of the game canvas container.
 *
 * Props:
 *   pages        — array of dialogue strings (one per page)
 *   currentPage  — index of the currently displayed page
 *   visible      — whether the box should render
 *   onAdvance    — callback when there are more pages to show
 *   onDismiss    — callback when the final page is confirmed
 */
export default function DialogueBox({ pages, currentPage, visible, onAdvance, onDismiss }) {
  const activatedAtRef = useRef(null);

  // Track when the box becomes visible for the 300ms debounce
  useEffect(() => {
    if (visible && pages && pages.length > 0) {
      activatedAtRef.current = Date.now();
    } else {
      activatedAtRef.current = null;
    }
  }, [visible, pages]);

  // Listen for Enter/Space keydown
  useEffect(() => {
    if (!visible || !pages || pages.length === 0) return;

    function handleKeyDown(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;

      // 300ms debounce: ignore inputs too soon after activation
      if (activatedAtRef.current && Date.now() - activatedAtRef.current < 300) {
        return;
      }

      e.preventDefault();

      if (currentPage < pages.length - 1) {
        onAdvance();
      } else {
        onDismiss();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, pages, currentPage, onAdvance, onDismiss]);

  // Do not render if not visible or pages is null/empty
  if (!visible || !pages || pages.length === 0) {
    return null;
  }

  const hasMorePages = currentPage < pages.length - 1;

  return (
    <div
      className="dialogue-box"
      role="dialog"
      aria-label="Dialogue"
    >
      <p>{pages[currentPage]}</p>
      {hasMorePages && (
        <span
          className="dialogue-indicator"
          aria-hidden="true"
        >
          ▼
        </span>
      )}
    </div>
  );
}
