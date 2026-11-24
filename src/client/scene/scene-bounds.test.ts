import { describe, expect, it } from 'vitest';
import { calculateFrames, PANEL_SIZE, type Turn } from '../../shared/engine';
import { sceneBounds } from './scene-bounds';

describe('sceneBounds', () => {
  it('covers the committed and goal panels without other solution states', () => {
    const turns: Turn[] = ['straight', 'straight'];
    const goal = calculateFrames({ turns }, [0, 0]).frames;
    expect(sceneBounds(turns, [0, -90], goal).min.y).toBeCloseTo(-PANEL_SIZE);
    expect(sceneBounds(turns, [0, 90], goal).min.y).toBeCloseTo(0);
  });

  it('includes the displayed pose when sizing an animated shadow', () => {
    const turns: Turn[] = ['straight', 'straight'];
    const goal = calculateFrames({ turns }, [0, 0]).frames;
    expect(sceneBounds(turns, [0, 90], goal, [0, -45]).min.y).toBeLessThan(0);
  });
});
