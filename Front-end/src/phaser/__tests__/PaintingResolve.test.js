/**
 * PaintingResolve.test.js — example-based tests for the pure painting-image
 * resolver `resolvePaintingImage` in `../paintingResolve.js`.
 *
 * These are concrete, hand-computed examples that complement the property
 * tests. With Authored_Memory_Count N = 8, authored paintings occupy
 * Memory_Index 0..7 (segment 0 paintings 0..5 = memory 0..5; segment 1
 * paintings 0..1 = memory 6..7), and segment 1 painting 2 (memory 8) is the
 * first Future_Painting.
 *
 * Validates: Requirements 3.2, 3.3, 3.5, 5.2
 */

import { describe, it, expect } from 'vitest';
import { resolvePaintingImage } from '../paintingResolve.js';
import { PAINTING_PLACEHOLDER_KEY } from '../../data/paintings.js';

const N = 8;

describe('resolvePaintingImage (N = 8)', () => {
  it('seg0 painting0 ⇒ memory-0 (authored key present ⇒ that key)', () => {
    const source = { 0: { key: 'painting_real_0', url: null } };
    const { memoryIndex, key, isPlaceholder } = resolvePaintingImage(0, 0, source, N);
    expect(memoryIndex).toBe(0);
    expect(key).toBe('painting_real_0');
    expect(isPlaceholder).toBe(false);
  });

  it('seg0 painting0 ⇒ placeholder key when the entry is the default placeholder', () => {
    const source = { 0: { key: PAINTING_PLACEHOLDER_KEY, url: null } };
    const { memoryIndex, key, isPlaceholder } = resolvePaintingImage(0, 0, source, N);
    expect(memoryIndex).toBe(0);
    expect(key).toBe(PAINTING_PLACEHOLDER_KEY);
    expect(isPlaceholder).toBe(true);
  });

  it('seg1 painting0 ⇒ memory-6', () => {
    const source = { 6: { key: 'painting_real_6', url: null } };
    const { memoryIndex, key } = resolvePaintingImage(1, 0, source, N);
    expect(memoryIndex).toBe(6);
    expect(key).toBe('painting_real_6');
  });

  it('seg1 painting2 ⇒ memory-8, a Future_Painting ⇒ placeholder (Req 3.5)', () => {
    const source = {};
    const { memoryIndex, key, isPlaceholder } = resolvePaintingImage(1, 2, source, N);
    expect(memoryIndex).toBe(8);
    expect(key).toBe(PAINTING_PLACEHOLDER_KEY);
    expect(isPlaceholder).toBe(true);
  });

  it('authored index with a MISSING entry ⇒ placeholder fallback (Req 5.2)', () => {
    const source = {}; // memory 0 is authored (< N) but has no entry
    const { memoryIndex, key, isPlaceholder } = resolvePaintingImage(0, 0, source, N);
    expect(memoryIndex).toBe(0);
    expect(key).toBe(PAINTING_PLACEHOLDER_KEY);
    expect(isPlaceholder).toBe(true);
  });

  it('authored index with an entry MISSING its key ⇒ placeholder fallback (Req 5.2)', () => {
    const source = { 0: { url: null } };
    const { key, isPlaceholder } = resolvePaintingImage(0, 0, source, N);
    expect(key).toBe(PAINTING_PLACEHOLDER_KEY);
    expect(isPlaceholder).toBe(true);
  });
});
