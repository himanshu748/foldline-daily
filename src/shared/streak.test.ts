import { describe, expect, it } from 'vitest';
import { EMPTY_STREAK, flairTier, liveStreak, nextFlairTier, recordSolve, type StreakState } from './streak';

const play = (dates: string[], skipped: string[] = []): StreakState =>
  dates.reduce((state, date) => recordSolve(state, date, (d) => skipped.includes(d)), EMPTY_STREAK);

describe('streak with grace', () => {
  it('counts consecutive days and keeps the best', () => {
    const state = play(['2026-11-16', '2026-11-17', '2026-11-18']);
    expect(state).toEqual({ cur: 3, best: 3, last: '2026-11-18', grace: '' });
  });

  it('ignores a replay of the same day and older days', () => {
    const state = play(['2026-11-16', '2026-11-17']);
    expect(recordSolve(state, '2026-11-17')).toBe(state);
    expect(recordSolve(state, '2026-11-10')).toBe(state);
  });

  it('forgives one missed day and records which day used the grace', () => {
    const state = play(['2026-11-16', '2026-11-17', '2026-11-19']);
    expect(state).toEqual({ cur: 3, best: 3, last: '2026-11-19', grace: '2026-11-18' });
  });

  it('resets after two missed days in a row', () => {
    const state = play(['2026-11-16', '2026-11-17', '2026-11-20']);
    expect(state).toEqual({ cur: 1, best: 2, last: '2026-11-20', grace: '' });
  });

  it('does not forgive a second miss within six days of the first', () => {
    // Missed the 18th (forgiven), then missed the 24th: only six days later.
    const state = play(['2026-11-17', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-25']);
    expect(state.cur).toBe(1);
    expect(state.best).toBe(6);
  });

  it('forgives again once the grace window has passed', () => {
    // Missed the 18th (forgiven), then missed the 25th: seven days later.
    const state = play(['2026-11-17', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-26']);
    expect(state.cur).toBe(8);
    expect(state.grace).toBe('2026-11-25');
  });

  it('never counts a moderator-skipped day as missed', () => {
    const skipped = ['2026-11-18', '2026-11-19'];
    const state = play(['2026-11-16', '2026-11-17', '2026-11-20'], skipped);
    expect(state).toEqual({ cur: 3, best: 3, last: '2026-11-20', grace: '' });
  });

  it('works across month and year boundaries', () => {
    expect(play(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']).cur).toBe(4);
    expect(play(['2028-02-28', '2028-02-29', '2028-03-01']).cur).toBe(3);
  });

  it('resets after a very long absence', () => {
    expect(play(['2026-01-01', '2026-11-16']).cur).toBe(1);
  });

  it('shows a live streak only while today can still extend it', () => {
    const state = play(['2026-11-16', '2026-11-17']);
    expect(liveStreak(state, '2026-11-17')).toBe(2);
    expect(liveStreak(state, '2026-11-18')).toBe(2);
    expect(liveStreak(state, '2026-11-19')).toBe(2); // one miss, grace available
    expect(liveStreak(state, '2026-11-20')).toBe(0);
    expect(liveStreak(EMPTY_STREAK, '2026-11-20')).toBe(0);
    const graced = play(['2026-11-16', '2026-11-18']);
    expect(liveStreak(graced, '2026-11-20')).toBe(0); // grace already used on the 17th
  });

  it('rejects an invalid date', () => {
    expect(() => recordSolve(EMPTY_STREAK, 'tomorrow')).toThrow(RangeError);
  });
});

describe('flair tiers', () => {
  it('awards Crease at 3, Pleat at 7 and Origami at 30 days', () => {
    expect(flairTier(2)).toBeNull();
    expect(flairTier(3)?.name).toBe('Crease');
    expect(flairTier(6)?.name).toBe('Crease');
    expect(flairTier(7)?.name).toBe('Pleat');
    expect(flairTier(29)?.name).toBe('Pleat');
    expect(flairTier(30)?.name).toBe('Origami');
    expect(nextFlairTier(0)?.name).toBe('Crease');
    expect(nextFlairTier(7)?.name).toBe('Origami');
    expect(nextFlairTier(30)).toBeNull();
  });
});
