import { describe, expect, it } from 'vitest';
import { calculateFrames, type Turn } from '../../shared/engine';
import { matchingSlots } from './slot-state';

describe('matchingSlots', () => {
  it('counts movable panels by position and normal rather than angle alone', () => {
    const turns: Turn[] = ['straight', 'right', 'straight'];
    const goal = calculateFrames({ turns }, [0, 90, 0]).frames;
    expect(matchingSlots(turns, [0, 0, 0], goal)).toEqual([false, false, false]);
    expect(matchingSlots(turns, [0, 90, 0], goal)).toEqual([false, true, true]);
  });
});
