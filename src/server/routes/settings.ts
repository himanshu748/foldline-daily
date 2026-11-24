import { Hono } from 'hono';
import type { SettingsValidationRequest, SettingsValidationResponse } from '@devvit/web/shared';
import { isDateKey, isValidTimeZone } from '../../shared/dates';

export const settingsRoutes = new Hono();

const read = async (request: { json: () => Promise<unknown> }): Promise<string> => {
  const body = (await request.json().catch(() => null)) as SettingsValidationRequest<string> | null;
  return typeof body?.value === 'string' ? body.value.trim() : '';
};

settingsRoutes.post('/validate-start-date', async (c) => {
  const value = await read(c.req);
  if (value === '' || isDateKey(value)) return c.json<SettingsValidationResponse>({ success: true });
  return c.json<SettingsValidationResponse>({
    success: false,
    error: 'Use a real date in YYYY-MM-DD format, or leave it empty to use the install date.',
  });
});

settingsRoutes.post('/validate-timezone', async (c) => {
  const value = await read(c.req);
  if (value === '' || isValidTimeZone(value)) return c.json<SettingsValidationResponse>({ success: true });
  return c.json<SettingsValidationResponse>({
    success: false,
    error: 'Use an IANA timezone name such as UTC, Europe/London or America/Los_Angeles.',
  });
});
