import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DialogueBox from '../DialogueBox.jsx';

describe('DialogueBox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not render when visible is false', () => {
    const { container } = render(
      <DialogueBox
        pages={['Hello']}
        currentPage={0}
        visible={false}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when pages is null', () => {
    const { container } = render(
      <DialogueBox
        pages={null}
        currentPage={0}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when pages is empty', () => {
    const { container } = render(
      <DialogueBox
        pages={[]}
        currentPage={0}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the current page text', () => {
    const pages = ['First page', 'Second page'];
    const { container } = render(
      <DialogueBox
        pages={pages}
        currentPage={0}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.textContent).toContain('First page');
  });

  it('renders with the dialogue-box CSS class for pixel-art styling', () => {
    const { container } = render(
      <DialogueBox
        pages={['Hello']}
        currentPage={0}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const box = container.firstChild;
    expect(box.classList.contains('dialogue-box')).toBe(true);
  });

  it('has the dialogue-box class which provides bottom-anchored layout', () => {
    const { container } = render(
      <DialogueBox
        pages={['Hello']}
        currentPage={0}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const box = container.querySelector('.dialogue-box');
    expect(box).not.toBeNull();
  });

  it('shows "▼" indicator when more pages remain', () => {
    const pages = ['Page 1', 'Page 2'];
    const { container } = render(
      <DialogueBox
        pages={pages}
        currentPage={0}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.textContent).toContain('▼');
  });

  it('does not show "▼" indicator on the final page', () => {
    const pages = ['Page 1', 'Page 2'];
    const { container } = render(
      <DialogueBox
        pages={pages}
        currentPage={1}
        visible={true}
        onAdvance={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container.textContent).not.toContain('▼');
  });

  it('calls onAdvance on Space when more pages remain (after debounce)', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Page 1', 'Page 2']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    // Advance past the 300ms debounce
    vi.advanceTimersByTime(301);

    fireEvent.keyDown(window, { key: ' ' });

    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls onDismiss on Esc at any page (after debounce)', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Page 1', 'Page 2', 'Page 3']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    vi.advanceTimersByTime(301);

    // Esc dismisses even though pages remain.
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('Enter no longer advances or dismisses', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Page 1', 'Page 2']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    vi.advanceTimersByTime(301);

    fireEvent.keyDown(window, { key: 'Enter' });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls onDismiss on Space when on the final page (after debounce)', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Only page']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    vi.advanceTimersByTime(301);

    fireEvent.keyDown(window, { key: ' ' });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('ignores confirmation input within the first 300ms (debounce)', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Page 1', 'Page 2']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    // Fire immediately — within debounce window (Space is the advance key)
    fireEvent.keyDown(window, { key: ' ' });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Esc is also debounced within the first 300ms', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Page 1', 'Page 2']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    // Within debounce window — Esc ignored.
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores non-interaction keys (not Space/Esc)', () => {
    const onAdvance = vi.fn();
    const onDismiss = vi.fn();
    render(
      <DialogueBox
        pages={['Page 1', 'Page 2']}
        currentPage={0}
        visible={true}
        onAdvance={onAdvance}
        onDismiss={onDismiss}
      />
    );

    vi.advanceTimersByTime(301);

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(onAdvance).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
