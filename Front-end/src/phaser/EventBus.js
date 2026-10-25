/**
 * EventBus — a minimal pub/sub singleton shared between Phaser and React.
 *
 * Supports named events with ordered delivery to all subscribers.
 * Events emitted with no subscribers are silently discarded (Requirement 9.6).
 */
class EventBus {
  constructor() {
    /** @type {Map<string, Array<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to a named event.
   * @param {string} event
   * @param {Function} listener
   * @returns {this}
   */
  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(listener);
    return this;
  }

  /**
   * Unsubscribe a specific listener from a named event.
   * @param {string} event
   * @param {Function} listener
   * @returns {this}
   */
  off(event, listener) {
    const listeners = this._listeners.get(event);
    if (!listeners) return this;
    const idx = listeners.indexOf(listener);
    if (idx !== -1) {
      listeners.splice(idx, 1);
    }
    if (listeners.length === 0) {
      this._listeners.delete(event);
    }
    return this;
  }

  /**
   * Emit a named event, delivering to all subscribers in registration order.
   * If no subscribers exist, the event is silently discarded.
   * @param {string} event
   * @param  {...any} args
   * @returns {this}
   */
  emit(event, ...args) {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.length === 0) return this;
    // Iterate over a shallow copy so removals during emit don't skip listeners
    const snapshot = [...listeners];
    for (const listener of snapshot) {
      listener(...args);
    }
    return this;
  }
}

const eventBus = new EventBus();
export default eventBus;
