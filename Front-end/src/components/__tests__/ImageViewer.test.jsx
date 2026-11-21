import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import ImageViewer from '../ImageViewer.jsx';

describe('ImageViewer', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render when visible is false', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={false}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the overlay when visible is true', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).not.toBeNull();
    expect(container.querySelector('.image-viewer-overlay')).not.toBeNull();
  });

  it('renders the image with the provided imageUrl', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/test.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/assets/photos/test.png');
  });

  it('renders with image-viewer-overlay class for centered viewport layout', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );
    const overlay = container.querySelector('.image-viewer-overlay');
    expect(overlay).not.toBeNull();
  });

  it('renders with image-viewer-frame class for pixel-art border styling', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );
    const frame = container.querySelector('.image-viewer-frame');
    expect(frame).not.toBeNull();
  });

  it('shows fallback placeholder when image fails to load', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/missing.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );

    const img = container.querySelector('img');
    fireEvent.error(img);

    const fallback = container.querySelector('.image-viewer-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback.textContent).toBe("This photo couldn't load. Refreshing the page should fix it.");
    // Image should no longer be rendered
    expect(container.querySelector('img')).toBeNull();
  });

  it('announces the refresh hint and keeps the close button when a photo fails (Req 7.6)', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <ImageViewer imageUrl="/Memories/photos/05.jpg" visible={true} onDismiss={onDismiss} />
    );
    fireEvent.error(container.querySelector('img'));

    const fallback = container.querySelector('.image-viewer-fallback');
    expect(fallback.getAttribute('role')).toBe('status');
    expect(fallback.textContent).toMatch(/refresh/i);

    fireEvent.click(container.querySelector('.image-viewer-close'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('tries the next photo again after an earlier one failed', () => {
    const { container, rerender } = render(
      <ImageViewer imageUrl="/Memories/photos/05.jpg" visible={true} onDismiss={vi.fn()} />
    );
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();

    rerender(<ImageViewer imageUrl="/Memories/photos/06.jpg" visible={true} onDismiss={vi.fn()} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toBe('/Memories/photos/06.jpg');
    expect(container.querySelector('.image-viewer-fallback')).toBeNull();
  });

  it('calls onDismiss when the close button is clicked', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={onDismiss}
      />
    );

    const closeButton = container.querySelector('.image-viewer-close');
    fireEvent.click(closeButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Space is pressed', () => {
    const onDismiss = vi.fn();
    render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={onDismiss}
      />
    );

    fireEvent.keyDown(window, { key: ' ' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Esc is pressed', () => {
    const onDismiss = vi.fn();
    render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={onDismiss}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does nothing when Enter is pressed (Enter removed)', () => {
    const onDismiss = vi.fn();
    render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={onDismiss}
      />
    );

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does not call onDismiss for non-interaction keys (not Space/Esc)', () => {
    const onDismiss = vi.fn();
    render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={onDismiss}
      />
    );

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('has a close button with accessible label', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );

    const closeButton = container.querySelector('.image-viewer-close');
    expect(closeButton.getAttribute('aria-label')).toBe('Close');
  });

  it('has role="dialog" with an accessible label', () => {
    const { container } = render(
      <ImageViewer
        imageUrl="/assets/photos/placeholder.png"
        visible={true}
        onDismiss={vi.fn()}
      />
    );

    const overlay = container.querySelector('[role="dialog"]');
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute('aria-label')).toBe('Image Viewer');
  });
});
