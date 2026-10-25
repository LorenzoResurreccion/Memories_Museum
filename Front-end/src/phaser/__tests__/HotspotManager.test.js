import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  Scene: class MockScene {
    constructor(config) {
      this.sceneKey = config?.key;
    }
  }
}));

import HotspotManager from '../HotspotManager.js';

/**
 * Test helpers
 */

function createMockScene() {
  const zones = [];
  const overlapResults = new Map();

  const scene = {
    add: {
      zone: vi.fn((x, y, w, h) => {
        const zone = { x, y, width: w, height: h, type: 'zone' };
        zones.push(zone);
        return zone;
      })
    },
    physics: {
      add: {
        existing: vi.fn()
      },
      overlap: vi.fn((player, zone) => {
        return overlapResults.get(zone) || false;
      })
    },
    input: {
      keyboard: {
        addKey: vi.fn((key) => ({
          isDown: false,
          key
        }))
      }
    }
  };

  return { scene, zones, overlapResults };
}

function createMockEventBus() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  };
}

function createHotspotObject({ id, text, imageUrl, x = 100, y = 100, width = 64, height = 64, name = 'hotspot' } = {}) {
  const properties = [];
  if (id !== undefined) {
    properties.push({ name: 'id', type: 'string', value: id });
  }
  if (text !== undefined) {
    properties.push({ name: 'text', type: 'string', value: text });
  }
  if (imageUrl !== undefined) {
    properties.push({ name: 'imageUrl', type: 'string', value: imageUrl });
  }
  return {
    name,
    type: 'memory_hotspot',
    x, y, width, height,
    properties
  };
}

describe('HotspotManager', () => {
  let scene, zones, overlapResults, eventBus;

  beforeEach(() => {
    ({ scene, zones, overlapResults } = createMockScene());
    eventBus = createMockEventBus();
  });

  describe('loadHotspots()', () => {
    it('loads valid hotspots and creates physics zones', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({
            id: 'kitchen_memory',
            text: '["Remember this?","Good times."]',
            imageUrl: '/assets/photos/placeholder.png',
            x: 320, y: 256, width: 64, height: 64
          })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);

      expect(manager.hotspots).toHaveLength(1);
      expect(manager.hotspots[0].id).toBe('kitchen_memory');
      expect(manager.hotspots[0].text).toEqual(['Remember this?', 'Good times.']);
      expect(manager.hotspots[0].imageUrl).toBe('/assets/photos/placeholder.png');

      // Zone created at center of the object
      expect(scene.add.zone).toHaveBeenCalledWith(352, 288, 64, 64);
      expect(scene.physics.add.existing).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'zone' }),
        true
      );
    });

    it('loads multiple hotspots', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'memory_1', text: '["Page 1"]' }),
          createHotspotObject({ id: 'memory_2', text: '["Page 2"]', x: 200, y: 200 }),
          createHotspotObject({ id: 'memory_3', text: '["Page 3"]', x: 300, y: 300 })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      expect(manager.hotspots).toHaveLength(3);
    });

    it('skips hotspots missing id property with console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const objectLayer = {
        objects: [
          createHotspotObject({ text: '["Some text"]' }) // no id
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);

      expect(manager.hotspots).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing required "id" property')
      );

      warnSpy.mockRestore();
    });

    it('skips hotspots missing text property with console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test_id' }) // no text
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);

      expect(manager.hotspots).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing required "text" property')
      );

      warnSpy.mockRestore();
    });

    it('skips hotspots with invalid JSON in text property', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test_id', text: 'not valid json' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);

      expect(manager.hotspots).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not valid JSON')
      );

      warnSpy.mockRestore();
    });

    it('skips hotspots where text is not an array', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test_id', text: '"just a string"' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);

      expect(manager.hotspots).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not a JSON array')
      );

      warnSpy.mockRestore();
    });

    it('handles null imageUrl gracefully', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test_id', text: '["Hello"]' })
          // no imageUrl property
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);

      expect(manager.hotspots).toHaveLength(1);
      expect(manager.hotspots[0].imageUrl).toBeNull();
    });

    it('ignores non-memory_hotspot objects', () => {
      const objectLayer = {
        objects: [
          { name: 'player_spawn', type: 'player_spawn', x: 100, y: 100, width: 0, height: 0, properties: [] },
          createHotspotObject({ id: 'real_hotspot', text: '["Hello"]' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      expect(manager.hotspots).toHaveLength(1);
      expect(manager.hotspots[0].id).toBe('real_hotspot');
    });

    it('handles null or missing objectLayer', () => {
      const manager = new HotspotManager(scene, null, eventBus);
      expect(manager.hotspots).toHaveLength(0);
    });
  });

  describe('checkInteraction()', () => {
    it('emits hotspot-activated when player overlaps zone and interaction key is pressed', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({
            id: 'kitchen_memory',
            text: '["Remember this?"]',
            imageUrl: '/assets/photos/test.png'
          })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      // Simulate Space key pressed
      scene.input.keyboard.addKey = vi.fn((key) => ({
        isDown: key === 'SPACE',
        key
      }));

      // Simulate overlap with the hotspot zone
      overlapResults.set(manager.hotspots[0].zone, true);
      scene.physics.overlap = vi.fn((p, zone) => overlapResults.get(zone) || false);

      manager.checkInteraction(player);

      expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', {
        id: 'kitchen_memory',
        text: ['Remember this?'],
        imageUrl: '/assets/photos/test.png'
      });
    });

    it('emits hotspot-activated when Enter key is pressed', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test', text: '["Hi"]' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      // Simulate Enter key pressed
      scene.input.keyboard.addKey = vi.fn((key) => ({
        isDown: key === 'ENTER',
        key
      }));

      overlapResults.set(manager.hotspots[0].zone, true);
      scene.physics.overlap = vi.fn((p, zone) => overlapResults.get(zone) || false);

      manager.checkInteraction(player);

      expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', {
        id: 'test',
        text: ['Hi'],
        imageUrl: null
      });
    });

    it('does nothing when no interaction key is pressed', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test', text: '["Hi"]' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      // No keys pressed (default mock returns isDown: false)
      manager.checkInteraction(player);

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('does nothing when interaction key pressed but no overlap', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test', text: '["Hi"]' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      // Space pressed but no overlap
      scene.input.keyboard.addKey = vi.fn((key) => ({
        isDown: key === 'SPACE',
        key
      }));

      // overlap returns false (default)
      manager.checkInteraction(player);

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('only activates one hotspot per interaction (first overlapping)', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'first', text: '["First"]', x: 100, y: 100 }),
          createHotspotObject({ id: 'second', text: '["Second"]', x: 100, y: 100 })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      scene.input.keyboard.addKey = vi.fn((key) => ({
        isDown: key === 'SPACE',
        key
      }));

      // Both zones overlap
      overlapResults.set(manager.hotspots[0].zone, true);
      overlapResults.set(manager.hotspots[1].zone, true);
      scene.physics.overlap = vi.fn((p, zone) => overlapResults.get(zone) || false);

      manager.checkInteraction(player);

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', {
        id: 'first',
        text: ['First'],
        imageUrl: null
      });
    });
  });

  describe('setLocked()', () => {
    it('prevents hotspot activation when locked', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test', text: '["Hi"]' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      // Lock the manager
      manager.setLocked(true);

      // Set up conditions that would normally trigger activation
      scene.input.keyboard.addKey = vi.fn((key) => ({
        isDown: key === 'SPACE',
        key
      }));
      overlapResults.set(manager.hotspots[0].zone, true);
      scene.physics.overlap = vi.fn((p, zone) => overlapResults.get(zone) || false);

      manager.checkInteraction(player);

      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('allows activation after unlocking', () => {
      const objectLayer = {
        objects: [
          createHotspotObject({ id: 'test', text: '["Hi"]' })
        ]
      };

      const manager = new HotspotManager(scene, objectLayer, eventBus);
      const player = { x: 100, y: 100 };

      // Lock then unlock
      manager.setLocked(true);
      manager.setLocked(false);

      scene.input.keyboard.addKey = vi.fn((key) => ({
        isDown: key === 'SPACE',
        key
      }));
      overlapResults.set(manager.hotspots[0].zone, true);
      scene.physics.overlap = vi.fn((p, zone) => overlapResults.get(zone) || false);

      manager.checkInteraction(player);

      expect(eventBus.emit).toHaveBeenCalledWith('hotspot-activated', {
        id: 'test',
        text: ['Hi'],
        imageUrl: null
      });
    });
  });
});
