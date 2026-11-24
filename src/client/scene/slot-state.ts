import { calculateFrames, type Frame, type Turn } from '../../shared/engine';

export function matchingSlots(turns: Turn[], angles: readonly number[], goalFrames: readonly Frame[]): boolean[] {
  return calculateFrames({ turns }, angles).frames.map((frame, index) => {
    const goal = goalFrames[index];
    return index > 0 && !!goal &&
      Math.hypot(...frame.center.map((value, i) => value - goal.center[i]!)) <= 1e-3 &&
      Math.hypot(...frame.normal.map((value, i) => value - goal.normal[i]!)) <= 1e-3;
  });
}
