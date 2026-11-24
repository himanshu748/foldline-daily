// Ported from Foldline (WebXR), `src/game/fold-gesture.test.ts`. Distances are
// now panel lengths of drag travel instead of metres of hand travel.
import { describe, expect, it } from 'vitest';
import { foldIntent, foldPreview, releasedFold } from './gesture';

describe('drag fold gesture', () => {
  it('previews smoothly and clamps before leaving the legal range', () => {
    expect(foldPreview(0, 0.45)).toBe(45);
    expect(foldPreview(90, 2)).toBe(90);
    expect(foldPreview(-90, -2)).toBe(-90);
  });
  it('does not commit tiny movement, interrupted movement or a stop past the edge', () => {
    expect(releasedFold(0, 0.2)).toBe(0);
    expect(releasedFold(0, NaN)).toBe(0);
    expect(releasedFold(90, 0.6)).toBe(0);
    expect(releasedFold(-90, -0.6)).toBe(0);
  });
  it('commits one stop per release in either direction', () => {
    expect(releasedFold(0, 0.31)).toBe(1);
    expect(releasedFold(90, -1.2)).toBe(-1);
    expect(releasedFold(0, -0.31)).toBe(-1);
  });
  it('never previews a two-stop move when release can only commit one', () => {
    expect(foldPreview(-90, 4)).toBe(0);
    expect(foldPreview(90, -4)).toBe(0);
    expect(foldPreview(0, NaN)).toBe(0);
  });
  it('resists threshold jitter, supports cancellation and direction reversal', () => {
    expect(foldIntent(0, 0.33)).toBe(0);
    expect(foldIntent(0, 0.35)).toBe(1);
    expect(foldIntent(0, 0.25, 1)).toBe(1);
    expect(foldIntent(0, 0.2, 1)).toBe(0);
    expect(foldIntent(0, -0.4, 1)).toBe(-1);
    expect(foldIntent(90, 0.4)).toBe(0);
    expect(foldIntent(0, NaN, 1)).toBe(0);
  });
});
