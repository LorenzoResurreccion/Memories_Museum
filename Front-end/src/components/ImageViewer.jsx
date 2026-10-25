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

  // Reset error state when imageUrl changes or viewer becomes visible
  useEffect(() => {
    setHasError(false);
  }, [imageUrl, visible]);

  // Listen for Space/Enter to dismiss
  useEffect(() => {
    if (!visible) return;

    function handleKeyDown(e) {
      if (e.key === 'Enter' || e.key === ' ') {
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
