import { context, reddit, redis } from '@devvit/web/server';
import type { FlairStatus } from '../../shared/api';
import { flairTier } from '../../shared/streak';
import { FLAIR_COLORS } from '../../shared/theme';
import type { AppConfig } from './config';
import { K } from './keys';
import { loadUser, type Player } from './users';

/**
 * Sets the player's streak flair when they have opted in and their tier is new.
 * Flair can be disabled by moderators or the app can lack the permission, so a
 * failure is reported as 'unavailable' and never fails the caller.
 */
export async function applyFlair(
  player: Player,
  best: number,
  config: AppConfig,
  force = false
): Promise<FlairStatus> {
  if (!config.flairEnabled) return 'off';
  const user = await loadUser(player.id);
  if (!user.flairOptIn) return 'off';
  const tier = flairTier(best);
  if (!tier) return 'unchanged';
  if (user.flairTier === tier.id && !force) return 'unchanged';
  const colors = FLAIR_COLORS[tier.id];
  try {
    await reddit.setUserFlair({
      subredditName: context.subredditName,
      username: player.name,
      text: tier.name,
      ...(colors ? { backgroundColor: colors.background, textColor: colors.text } : {}),
    });
    await redis.hSet(K.user(player.id), { flairTier: tier.id });
    return 'set';
  } catch (error) {
    console.warn('Streak flair could not be set:', error);
    return 'unavailable';
  }
}

export async function setFlairOptIn(
  player: Player,
  optIn: boolean,
  config: AppConfig
): Promise<{ optedIn: boolean; status: FlairStatus }> {
  if (!config.flairEnabled) return { optedIn: false, status: 'off' };
  const user = await loadUser(player.id);
  if (optIn) {
    await redis.hSet(K.user(player.id), { flairOptIn: '1', name: player.name });
    const status = await applyFlair(player, user.streak.best, config, true);
    return { optedIn: true, status };
  }
  await redis.hSet(K.user(player.id), { flairOptIn: '0' });
  // Only remove a flair this app set; anything else belongs to the player or the moderators.
  if (user.flairTier) {
    try {
      await reddit.removeUserFlair(context.subredditName, player.name);
    } catch (error) {
      console.warn('Streak flair could not be removed:', error);
      return { optedIn: false, status: 'unavailable' };
    }
    await redis.hDel(K.user(player.id), ['flairTier']);
  }
  return { optedIn: false, status: 'off' };
}
