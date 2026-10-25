import { useEffect, useState } from 'react';
import './ImageViewer.css';

/**
 * ImageViewer — displays a memory image in a centered overlay with a pixel-art border.
 *
 * Props:
 *   imageUrl  — URL of the image to display
 *   visible   — whether the viewer is shown
 *   onDismiss — callback when the player closes the viewer
 */
export default function ImageViewer({ imageUrl, visible, onDismiss }) {
  const [hasError, setHasError] = useState(false);

  // Reset the error state when imageUrl changes or the viewer becomes visible, using
  // the "adjust state during render" pattern rather than an effect. Resetting inside an
  // effect would trigger a cascading re-render (and is flagged by react-hooks); doing it
  // during render while a key (imageUrl + visible) changes is the idiomatic React
  // approach for deriving/resetting state from props.
  // See: https://react.dev/learn/you-might-not-need-an-effect
  const [prevKey, setPrevKey] = useState(`${visible}:${imageUrl}`);
  const key = `${visible}:${imageUrl}`;
  if (key !== prevKey) {
    setPrevKey(key);
    setHasError(false);
  }

  // Listen for Space/Esc to dismiss.
  //
  // Key semantics (Infinite Hallway redesign, Req 9.9, 9.11):
  //   - Space dismisses the single-page image overlay.
  //   - Esc   dismisses the image overlay.
  //   - Enter is no longer handled (removed) — it does nothing here.
  useEffect(() => {
    if (!visible) return;

    function handleKeyDown(e) {
      if (e.key === ' ' || e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        onDismiss();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, onDismiss]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="image-viewer-overlay"
      role="dialog"
      aria-label="Image Viewer"
    >
      <div className="image-viewer-frame">
        <button
          className="image-viewer-close"
          onClick={onDismiss}
          aria-label="Close"
        >
          ✕
        </button>

        {hasError ? (
          <div className="image-viewer-fallback">
            No image available
          </div>
        ) : (
          <img
            src={imageUrl}
            alt="Memory"
            onError={() => setHasError(true)}
          />
        )}
      </div>
    </div>
  );
}
