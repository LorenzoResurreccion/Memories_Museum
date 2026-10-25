import { useState, useEffect, useCallback, useRef } from 'react';
import EventBus from './phaser/EventBus.js';
import GameCanvas from './components/GameCanvas.jsx';
import DialogueBox from './components/DialogueBox.jsx';
import ImageViewer from './components/ImageViewer.jsx';
import './App.css';

function App() {
  const [overlayActive, setOverlayActive] = useState(false);
  const [dialoguePages, setDialoguePages] = useState(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState(null);
  const [currentHotspotId, setCurrentHotspotId] = useState(null);

  // Guard ref to prevent duplicate activations during state transitions
  const overlayActiveRef = useRef(false);

  const handleHotspotActivated = useCallback((payload) => {
    // Req 9.5: If overlay already active, safely ignore
    if (overlayActiveRef.current) return;

    const { id, text, imageUrl: payloadImageUrl } = payload;

    // Req 7.5: If no text content and no image, don't show anything and don't pause
    const hasText = Array.isArray(text) && text.length > 0;
    const hasImage = payloadImageUrl != null && payloadImageUrl !== '';

    if (!hasText && !hasImage) return;

    overlayActiveRef.current = true;
    setOverlayActive(true);
    setCurrentHotspotId(id);
    setCurrentPageIndex(0);

    // Only set dialogue pages if there's actual text content
    if (hasText) {
      setDialoguePages(text);
    } else {
      setDialoguePages(null);
    }

    // Only set image URL if provided
    if (hasImage) {
      setImageUrl(payloadImageUrl);
    } else {
      setImageUrl(null);
    }
  }, []);

  // Subscribe to hotspot-activated on mount, clean up on unmount
  useEffect(() => {
    EventBus.on('hotspot-activated', handleHotspotActivated);

    return () => {
      EventBus.off('hotspot-activated', handleHotspotActivated);
    };
  }, [handleHotspotActivated]);

  const handleDialogueAdvance = useCallback(() => {
    setCurrentPageIndex((prev) => prev + 1);
  }, []);

  const handleDialogueDismiss = useCallback(() => {
    EventBus.emit('dialogue-dismissed', {});
    setDialoguePages(null);
    setCurrentPageIndex(0);

    // If no image is showing, fully clear overlay state
    setImageUrl((currentImage) => {
      if (!currentImage) {
        setOverlayActive(false);
        setCurrentHotspotId(null);
        overlayActiveRef.current = false;
      }
      return currentImage;
    });
  }, []);

  const handleImageDismiss = useCallback(() => {
    EventBus.emit('image-dismissed', {});
    setImageUrl(null);

    // If no dialogue is showing, fully clear overlay state
    setDialoguePages((currentPages) => {
      if (!currentPages || currentPages.length === 0) {
        setOverlayActive(false);
        setCurrentHotspotId(null);
        overlayActiveRef.current = false;
      }
      return currentPages;
    });
  }, []);

  const showDialogue = overlayActive && dialoguePages != null && dialoguePages.length > 0;
  const showImage = overlayActive && imageUrl != null;

  return (
    <div className="app-container">
      <GameCanvas />
      <DialogueBox
        pages={dialoguePages}
        currentPage={currentPageIndex}
        visible={showDialogue}
        onAdvance={handleDialogueAdvance}
        onDismiss={handleDialogueDismiss}
      />
      <ImageViewer
        imageUrl={imageUrl}
        visible={showImage}
        onDismiss={handleImageDismiss}
      />
    </div>
  );
}

export default App;
