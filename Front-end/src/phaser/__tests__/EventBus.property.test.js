// Feature: core-gameplay-mvp, Property 11: Event bus ordering guarantee
// For any random sequence of 1–50 events emitted through the EventBus, all subscribers
// SHALL receive those events in the exact order they were emitted.

// **Validates: Requirements 9.1, 9.2**

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import eventBus from '../EventBus.js';

// Arbitrary: event name (alphanumeric, simulating Phaser→React and React→Phaser channels)
const eventNameArb = fc.oneof(
  fc.constantFrom(
    'hotspot-activated',
    'dialogue-dismissed',
    'image-dismissed',
    'player-moved',
    'scene-ready'
  ),
  fc.stringMatching(/^[a-z]{1,15}$/)
);

// Arbitrary: event payload (simple JSON-safe values)
const payloadArb = fc.oneof(
  fc.integer(),
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.record({
    id: fc.stringMatching(/^[a-zA-Z0-9_]{1,10}$/),
    value: fc.integer(),
  })
);

// Arbitrary: a single event entry (name + payload)
const eventEntryArb = fc.record({
  name: eventNameArb,
  payload: payloadArb,
});

// Arbitrary: sequence of 1–50 events
const eventSequenceArb = fc.array(eventEntryArb, { minLength: 1, maxLength: 50 });

describe('Property 11: Event bus ordering guarantee', () => {
  /** **Validates: Requirements 9.1, 9.2** */

  beforeEach(() => {
    eventBus._listeners.clear();
  });

  it('a single subscriber receives all events in exact emission order', () => {
    fc.assert(
      fc.property(eventSequenceArb, (events) => {
        eventBus._listeners.clear();
        const received = [];

        // Register a subscriber for each unique event name in the sequence
        const uniqueNames = [...new Set(events.map((e) => e.name))];
        for (const name of uniqueNames) {
          eventBus.on(name, (payload) => {
            received.push({ name, payload });
          });
        }

        // Emit all events in order
        for (const event of events) {
          eventBus.emit(event.name, event.payload);
        }

        // Verify the subscriber received events in exact emission order
        expect(received).toEqual(
          events.map((e) => ({ name: e.name, payload: e.payload }))
        );
      }),
      { numRuns: 100 }
    );
  });

  it('multiple subscribers each independently receive all events in the same emission order', () => {
    fc.assert(
      fc.property(
        eventSequenceArb,
        fc.integer({ min: 2, max: 5 }),
        (events, subscriberCount) => {
          eventBus._listeners.clear();

          // Create N independent subscriber logs
          const logs = Array.from({ length: subscriberCount }, () => []);

          // Register each subscriber for all unique event names
          const uniqueNames = [...new Set(events.map((e) => e.name))];
          for (let i = 0; i < subscriberCount; i++) {
            for (const name of uniqueNames) {
              eventBus.on(name, (payload) => {
                logs[i].push({ name, payload });
              });
            }
          }

          // Emit all events
          for (const event of events) {
            eventBus.emit(event.name, event.payload);
          }

          // All subscribers should have received the same sequence
          const expected = events.map((e) => ({ name: e.name, payload: e.payload }));
          for (let i = 0; i < subscriberCount; i++) {
            expect(logs[i]).toEqual(expected);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ordering holds regardless of event name variety (single name or mixed)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Case 1: all events share a single name
          fc.record({
            name: eventNameArb,
            payloads: fc.array(payloadArb, { minLength: 1, maxLength: 50 }),
          }).map(({ name, payloads }) =>
            payloads.map((payload) => ({ name, payload }))
          ),
          // Case 2: mixed event names (general case)
          eventSequenceArb
        ),
        (events) => {
          eventBus._listeners.clear();
          const received = [];

          const uniqueNames = [...new Set(events.map((e) => e.name))];
          for (const name of uniqueNames) {
            eventBus.on(name, (payload) => {
              received.push({ name, payload });
            });
          }

          for (const event of events) {
            eventBus.emit(event.name, event.payload);
          }

          expect(received).toEqual(
            events.map((e) => ({ name: e.name, payload: e.payload }))
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
