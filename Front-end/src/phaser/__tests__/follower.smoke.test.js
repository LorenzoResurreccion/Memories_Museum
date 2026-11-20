import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontEnd = resolve(here, '..', '..', '..');
const read = (rel) => readFileSync(resolve(frontEnd, rel));

describe('follower companion smoke checks', () => {
  it('Kelly_Sprite.png is a valid PNG sized 128x128 (4x4 grid of 32x32 frames)', () => {
    const buf = read('public/assets/sprites/Kelly_Sprite.png');
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    expect(Array.from(buf.subarray(0, 8))).toEqual(signature);
    expect(buf.readUInt32BE(16)).toBe(128);
    expect(buf.readUInt32BE(20)).toBe(128);
  });

  it('config.js still enables pixelArt', () => {
    const src = read('src/phaser/config.js').toString('utf8');
    expect(src).toMatch(/pixelArt:\s*true/);
  });

  it.each(['src/phaser/followerTrail.js', 'src/phaser/followerCollision.js'])(
    '%s has no phaser import',
    (rel) => {
      const src = read(rel).toString('utf8');
      expect(src).not.toMatch(/from\s+['"]phaser/);
      expect(src).not.toMatch(/require\(\s*['"]phaser/);
    }
  );
});
