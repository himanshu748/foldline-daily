import { describe, expect, it } from 'vitest';
import {
  addDays, dateKeyInZone, dayNumber, diffDays, isDateKey, isValidTimeZone,
  msUntilNextDate, weekdayIndex, weekKey,
} from './dates';

describe('date keys', () => {
  it('accepts only real calendar dates', () => {
    expect(isDateKey('2026-11-16')).toBe(true);
    expect(isDateKey('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '26-11-16', '2026-11-16T00:00', '', null, 20261116])
      expect(isDateKey(bad)).toBe(false);
  });

  it('does day arithmetic across month, year and leap boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(diffDays('2026-12-25', '2027-01-04')).toBe(10);
    expect(diffDays('2027-01-04', '2026-12-25')).toBe(-10);
    expect(dayNumber('2026-11-16', '2026-11-16')).toBe(1);
    expect(dayNumber('2026-11-16', '2026-11-27')).toBe(12);
  });

  it('numbers weekdays from Monday and keys weeks by their Monday', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0);
    expect(weekdayIndex('2026-11-22')).toBe(6);
    expect(weekKey('2026-11-22')).toBe('2026-11-16');
    expect(weekKey('2026-11-16')).toBe('2026-11-16');
    expect(weekKey('2027-01-01')).toBe('2026-12-28');
  });
});

describe('release time and timezones', () => {
  const at = (iso: string) => Date.parse(iso);

  it('uses UTC dates by default', () => {
    expect(dateKeyInZone(at('2026-11-16T23:59:59Z'))).toBe('2026-11-16');
    expect(dateKeyInZone(at('2026-11-17T00:00:00Z'))).toBe('2026-11-17');
    expect(msUntilNextDate(at('2026-11-16T23:00:00Z'))).toBe(3_600_000);
    expect(msUntilNextDate(at('2026-11-16T00:00:00Z'))).toBe(86_400_000);
  });

  it('releases at local midnight in whole, half and quarter hour zones', () => {
    // Kolkata is UTC+5:30, Kathmandu UTC+5:45, Los Angeles UTC-8 in November.
    expect(dateKeyInZone(at('2026-11-16T18:29:59Z'), 'Asia/Kolkata')).toBe('2026-11-16');
    expect(dateKeyInZone(at('2026-11-16T18:30:00Z'), 'Asia/Kolkata')).toBe('2026-11-17');
    expect(dateKeyInZone(at('2026-11-16T18:15:00Z'), 'Asia/Kathmandu')).toBe('2026-11-17');
    expect(dateKeyInZone(at('2026-11-17T07:59:59Z'), 'America/Los_Angeles')).toBe('2026-11-16');
    expect(msUntilNextDate(at('2026-11-16T18:00:00Z'), 'Asia/Kolkata')).toBe(30 * 60_000);
    expect(msUntilNextDate(at('2026-11-16T18:00:00Z'), 'Asia/Kathmandu')).toBe(15 * 60_000);
  });

  it('lands exactly on the date change on daylight-saving days', () => {
    for (const iso of ['2027-03-14T12:00:00Z', '2026-11-01T06:30:00Z', '2027-03-13T20:00:00Z']) {
      const now = at(iso);
      const wait = msUntilNextDate(now, 'America/New_York');
      const today = dateKeyInZone(now, 'America/New_York');
      expect(dateKeyInZone(now + wait - 1, 'America/New_York')).toBe(today);
      expect(dateKeyInZone(now + wait, 'America/New_York')).toBe(addDays(today, 1));
    }
  });

  it('validates IANA zone names', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Paris')).toBe(true);
    for (const bad of ['Mars/Olympus', '', 42, null]) expect(isValidTimeZone(bad)).toBe(false);
  });
});
