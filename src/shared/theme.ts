/**
 * The one palette, derived from the Okabe-Ito colour-blind-safe set. The server
 * uses it for post backgrounds and flair; the client uses it everywhere else.
 */
export const INK = '#14201E';
export const CREAM = '#FAF8F2';
export const MAT = '#2A3135';
export const MAT_LINE = '#39434A';
export const MAT_MAJOR = '#4C5960';
export const MAT_TICK = '#9FB0B8';
export const TAPE = '#F2C230';
export const BG_LIGHT = MAT;
export const BG_DARK = MAT;
export const BLUE = '#0072B2';
export const VERMILION = '#D55E00';
export const GOLD = '#E69F00';

/** The paper colour for each weekday's puzzle, Monday first. */
export const PAPER_COLORS = [
  '#009E73',
  '#56B4E9',
  '#E69F00',
  '#0072B2',
  '#CC79A7',
  '#D55E00',
  '#F0E442',
] as const;

export const paperColor = (tier: number): string => PAPER_COLORS[tier] ?? PAPER_COLORS[0];

/** Flair chip colours per streak tier. */
export const FLAIR_COLORS: Record<string, { background: string; text: 'dark' | 'light' }> = {
  crease: { background: '#56B4E9', text: 'dark' },
  pleat: { background: '#E69F00', text: 'dark' },
  origami: { background: '#0072B2', text: 'light' },
};
