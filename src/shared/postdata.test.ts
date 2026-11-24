import { describe, expect, it } from 'vitest';
import { parsePostWire, toPostWire, type PostInfo } from './postdata';

const daily: PostInfo = {
  kind: 'daily',
  date: '2026-03-04',
  day: 12,
  rev: 0,
  tier: 2,
  puzzle: {
    turns: ['straight', 'left', 'straight', 'right'],
    start: [0, 0, 0, 0],
    goal: [0, 90, -90, 0],
    par: 4,
  },
  source: 'generated',
};

const route: PostInfo = {
  kind: 'route',
  date: '2026-03-08',
  day: 0,
  rev: 0,
  tier: 6,
  puzzle: {
    turns: ['left', 'straight', 'right', 'straight', 'left', 'straight'],
    start: [0, 0, 0, 0, 0, 0],
    goal: [0, 90, 90, -90, 0, 90],
    par: 8,
  },
  source: 'community',
  author: 'paperfan',
  routePostId: 't3_abc123',
};

describe('post wire format', () => {
  it('round-trips a daily puzzle', () => {
    expect(parsePostWire(toPostWire(daily))).toEqual(daily);
  });

  it('round-trips a community route with its author and source post', () => {
    expect(parsePostWire(toPostWire(route))).toEqual(route);
  });

  it.each([
    ['a newer version', { v: 2 }],
    ['an unknown kind', { k: 'weekly' }],
    ['a bad date', { d: 'March 4' }],
    ['an unknown source', { src: 'ai' }],
    ['a moved root hinge', { s: '+000' }],
    ['mismatched angle lists', { s: '000' }],
    ['an impossible par', { p: 99 }],
  ])('rejects %s', (_name, patch) => {
    const wire = { ...toPostWire(daily), ...(patch as object) };
    expect(parsePostWire(wire)).toBeNull();
  });

  it.each([
    ['garbage', 'hello'],
    ['nothing', undefined],
    ['a number', 4],
  ])('rejects %s', (_name, raw) => {
    expect(parsePostWire(raw)).toBeNull();
  });

  it('drops an author name that is not a Reddit username', () => {
    const wire = { ...toPostWire(route), a: 'not a name!' };
    expect(parsePostWire(wire)?.author).toBeUndefined();
  });
});
