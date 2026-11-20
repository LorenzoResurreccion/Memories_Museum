import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  parseDialogue,
  fetchDialogue,
  fetchMemoryEntries,
  loadMemories,
} from '../loadMemories.js';
import { MEMORIES, setMemories } from '../memories.js';
import { PAINTINGS, syncPaintings } from '../paintings.js';
import { dialogueUrl, photoUrl } from '../mediaBase.js';

/** A fetch stub serving `files` (index -> markdown); everything else is a 403. */
function fakeFetch(files, { contentType = 'text/markdown' } = {}) {
  return vi.fn(async (url) => {
    const match = /\/dialogue\/(\d+)\.md$/.exec(url);
    const index = match ? Number(match[1]) : -1;
    if (!Object.prototype.hasOwnProperty.call(files, index)) {
      return { ok: false, status: 403, headers: new Map(), text: async () => 'denied' };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', contentType]]),
      text: async () => files[index],
    };
  });
}

afterEach(() => {
  setMemories({});
  syncPaintings();
});

describe('parseDialogue', () => {
  it('splits on lines containing only ---, trimming each page', () => {
    expect(parseDialogue('First page.\n---\n  Second page.  \n---\nThird')).toEqual([
      'First page.',
      'Second page.',
      'Third',
    ]);
  });

  it('keeps line breaks inside a page and accepts spaces around ---', () => {
    expect(parseDialogue('line one\nline two\n  ---  \nnext')).toEqual(['line one\nline two', 'next']);
  });

  it('does not split on --- inside a line', () => {
    expect(parseDialogue('wait --- what\n---\nok')).toEqual(['wait --- what', 'ok']);
  });

  it('handles CRLF, a BOM, and drops empty pages', () => {
    expect(parseDialogue('\uFEFFa\r\n---\r\n\r\n---\r\nb\r\n')).toEqual(['a', 'b']);
  });

  it('returns [] for empty or non-string input', () => {
    expect(parseDialogue('')).toEqual([]);
    expect(parseDialogue('   \n---\n ')).toEqual([]);
    expect(parseDialogue(undefined)).toEqual([]);
  });
});

describe('fetchDialogue', () => {
  it('requests the dialogue URL and returns the body', async () => {
    const fetchImpl = fakeFetch({ 3: 'hello' });
    await expect(fetchDialogue(3, fetchImpl)).resolves.toBe('hello');
    expect(fetchImpl).toHaveBeenCalledWith(dialogueUrl(3), { cache: 'no-cache' });
  });

  it('treats non-2xx, network errors and HTML fallbacks as missing', async () => {
    await expect(fetchDialogue(0, fakeFetch({}))).resolves.toBeNull();
    await expect(fetchDialogue(0, vi.fn().mockRejectedValue(new Error('offline')))).resolves.toBeNull();
    await expect(
      fetchDialogue(0, fakeFetch({ 0: 'x' }, { contentType: 'text/html; charset=utf-8' })),
    ).resolves.toBeNull();
    await expect(
      fetchDialogue(0, fakeFetch({ 0: '<!doctype html>\n<html></html>' }, { contentType: '' })),
    ).resolves.toBeNull();
  });
});

describe('fetchMemoryEntries', () => {
  it('loads the contiguous run from 0 and stops at the first gap', async () => {
    const files = { 0: 'a\n---\nb', 1: 'c', 2: 'd', 4: 'after the gap' };
    const entries = await fetchMemoryEntries({ fetchImpl: fakeFetch(files), batchSize: 2 });
    expect(entries).toEqual({
      0: { text: ['a', 'b'], imageUrl: photoUrl(0) },
      1: { text: ['c'], imageUrl: photoUrl(1) },
      2: { text: ['d'], imageUrl: photoUrl(2) },
    });
  });

  it('crosses batch boundaries and stops fetching after the gap batch', async () => {
    const files = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i, `m${i}`]));
    const fetchImpl = fakeFetch(files);
    const entries = await fetchMemoryEntries({ fetchImpl, batchSize: 4 });
    expect(Object.keys(entries)).toHaveLength(10);
    // Batches 0-3, 4-7, 8-11: the gap at 10 is in the third batch, so 12 calls.
    expect(fetchImpl).toHaveBeenCalledTimes(12);
  });

  it('respects maxCount', async () => {
    const files = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i, 'x']));
    const entries = await fetchMemoryEntries({ fetchImpl: fakeFetch(files), maxCount: 5 });
    expect(Object.keys(entries)).toHaveLength(5);
  });

  it('keeps an empty letter as a photo-only memory', async () => {
    const entries = await fetchMemoryEntries({ fetchImpl: fakeFetch({ 0: '' }) });
    expect(entries).toEqual({ 0: { text: [], imageUrl: photoUrl(0) } });
  });

  it('returns {} when no fetch is available', async () => {
    await expect(fetchMemoryEntries({ fetchImpl: undefined })).resolves.toEqual({});
  });
});

describe('loadMemories', () => {
  it('installs the letters in MEMORIES and derives PAINTINGS, returning N', async () => {
    const n = await loadMemories({ fetchImpl: fakeFetch({ 0: 'hi', 1: 'there' }) });
    expect(n).toBe(2);
    expect(MEMORIES[1]).toEqual({ text: ['there'], imageUrl: photoUrl(1) });
    expect(Object.keys(PAINTINGS)).toEqual(['0', '1']);
    expect(PAINTINGS[0].key).toBe('painting_00');
  });

  it('never rejects: a total failure yields N = 0', async () => {
    const n = await loadMemories({ fetchImpl: vi.fn().mockRejectedValue(new Error('down')) });
    expect(n).toBe(0);
    expect(Object.keys(MEMORIES)).toHaveLength(0);
    expect(Object.keys(PAINTINGS)).toHaveLength(0);
  });
});
