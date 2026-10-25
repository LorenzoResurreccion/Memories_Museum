import { describe, it, expect, vi, beforeEach } from 'vitest';
import eventBus from '../EventBus.js';

describe('EventBus', () => {
  beforeEach(() => {
    // Clear all listeners between tests by re-initialising internal state
    eventBus._listeners.clear();
  });

  it('delivers events to subscribers in registration order (Req 9.1, 9.2)', () => {
    const order = [];
    eventBus.on('test', () => order.push('first'));
    eventBus.on('test', () => order.push('second'));
    eventBus.on('test', () => order.push('third'));

    eventBus.emit('test');

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('passes arguments to listeners', () => {
    const listener = vi.fn();
    eventBus.on('hotspot-activated', listener);

    const payload = { id: 'h1', text: ['Hello'], imageUrl: '/photo.png' };
    eventBus.emit('hotspot-activated', payload);

    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('silently discards events with no subscribers (Req 9.6)', () => {
    // Should not throw
    expect(() => eventBus.emit('no-one-listening', { data: 42 })).not.toThrow();
  });

  it('removes a specific listener with off()', () => {
    const listener = vi.fn();
    eventBus.on('evt', listener);
    eventBus.off('evt', listener);

    eventBus.emit('evt');

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not affect other listeners when removing one', () => {
    const kept = vi.fn();
    const removed = vi.fn();
    eventBus.on('evt', kept);
    eventBus.on('evt', removed);
    eventBus.off('evt', removed);

    eventBus.emit('evt');

    expect(kept).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
  });

  it('handles off() for non-existent event gracefully', () => {
    const listener = vi.fn();
    expect(() => eventBus.off('nonexistent', listener)).not.toThrow();
  });

  it('handles off() for non-registered listener gracefully', () => {
    const a = vi.fn();
    const b = vi.fn();
    eventBus.on('evt', a);
    expect(() => eventBus.off('evt', b)).not.toThrow();
    eventBus.emit('evt');
    expect(a).toHaveBeenCalledOnce();
  });

  it('supports multiple different event types independently', () => {
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    eventBus.on('event-a', listenerA);
    eventBus.on('event-b', listenerB);

    eventBus.emit('event-a', 'hello');

    expect(listenerA).toHaveBeenCalledWith('hello');
    expect(listenerB).not.toHaveBeenCalled();
  });

  it('is a singleton (same reference on re-import)', async () => {
    const { default: sameInstance } = await import('../EventBus.js');
    expect(sameInstance).toBe(eventBus);
  });

  it('safely emits when a listener removes itself during emit', () => {
    const results = [];
    const selfRemover = () => {
      results.push('selfRemover');
      eventBus.off('evt', selfRemover);
    };
    const after = () => results.push('after');

    eventBus.on('evt', selfRemover);
    eventBus.on('evt', after);
    eventBus.emit('evt');

    expect(results).toEqual(['selfRemover', 'after']);
  });
});
