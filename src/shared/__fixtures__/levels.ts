import { countMoves, poseFromAngles, type FoldAngle, type Level, type Turn } from '../engine';

/**
 * The nine authored puzzles from the original Foldline campaign. They are test
 * fixtures here (they keep the ported engine tests meaningful) and are never
 * shipped as daily content.
 */
export interface AuthoredLevel extends Level {
  id: string;
}

function author(id: string, turns: Turn[], initial: FoldAngle[], solution: FoldAngle[]): AuthoredLevel {
  const level: AuthoredLevel = { id, turns, initial, target: poseFromAngles({ turns }, solution), par: 0 };
  level.par = countMoves(level);
  if (level.par < 1) throw new Error(`Level ${id} must be reachable and start unsolved.`);
  return level;
}

const line = (...turns: Turn[]) => turns;

/** Targets are authored in geometric space; solutions are not retained in game data. */
export const LEVELS: AuthoredLevel[] = [
  author('first-rise', line('straight', 'straight'), [0, 0], [0, 90]),
  author('round-the-corner', line('left', 'right'), [0, -90], [0, 90]),
  author('little-stair', line('straight', 'straight', 'straight'), [0, 0, 0], [0, 90, -90]),
  author('side-street', line('straight', 'left', 'straight'), [0, -90, 90], [0, 90, 0]),
  author('switchback', line('right', 'left', 'straight'), [0, 0, -90], [0, 90, 0]),
  author('overpass', line('straight', 'straight', 'right', 'straight'), [0, 0, 90, -90], [0, 90, -90, 0]),
  author('lantern-walk', line('left', 'straight', 'right', 'straight'), [0, -90, 0, 0], [0, 90, -90, 90]),
  author(
    'high-garden',
    line('straight', 'left', 'straight', 'right', 'straight'),
    [0, 0, -90, 90, -90],
    [0, 90, 0, -90, 0]
  ),
  author(
    'homeward',
    line('right', 'straight', 'left', 'straight', 'left'),
    [0, -90, 90, -90, 0],
    [0, 90, -90, 0, 90]
  ),
];
