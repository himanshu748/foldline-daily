import { reddit, redis } from '@devvit/web/server';
import type { ShareResponse } from '../../shared/api';
import type { PostInfo } from '../../shared/postdata';
import { shareText } from '../../shared/share';
import { ApiError } from './errors';
import { K } from './keys';
import { ensureThread, type PostId } from './postinfo';
import { loadResult, resultView } from './results';
import { countEvent } from './track';
import type { Player } from './users';

/**
 * Posts the player's spoiler-safe grid as a reply to the results thread. Runs
 * only when the player taps Share. Until the app is approved, Reddit posts
 * `runAs: 'USER'` comments from the app account for everyone except the app's
 * owner, so in that case the comment is edited to name the player.
 */
export async function shareResult(
  info: PostInfo,
  postId: PostId,
  board: string,
  player: Player,
  today: string
): Promise<ShareResponse> {
  const stored = await loadResult(board, player.id);
  if (!stored) throw new ApiError(400, 'no-result', 'Finish the puzzle before sharing a result.');
  if ((await redis.hSetNX(K.shared(board), player.id, 'pending')) !== 1)
    return { type: 'share', status: 'already', asUser: true };

  const view = resultView(info, stored);
  const input = {
    label: info.kind === 'daily' ? `Foldline Day ${info.day}` : 'Foldline Community Route',
    folds: view.folds,
    par: view.par,
    ms: view.ms,
    grid: view.grid,
  };
  try {
    const text = shareText(input);
    const thread = await ensureThread(postId);
    let comment;
    try {
      comment = await reddit.submitComment({ id: thread ?? postId, text, runAs: 'USER' });
    } catch (error) {
      if (!thread) throw error;
      // The results thread may have been removed; a top-level comment still works.
      comment = await reddit.submitComment({ id: postId, text, runAs: 'USER' });
    }
    const asUser = comment.authorName === player.name;
    if (!asUser) {
      try {
        await comment.edit({ text: shareText({ ...input, onBehalfOf: player.name }) });
      } catch (error) {
        console.warn('Shared result could not be labelled with the player name:', error);
      }
    }
    await Promise.all([
      redis.hSet(K.shared(board), { [player.id]: comment.id }),
      countEvent(today, 'share_comment'),
    ]);
    return { type: 'share', status: 'posted', asUser };
  } catch (error) {
    await redis.hDel(K.shared(board), [player.id]);
    console.error('Result comment could not be posted:', error);
    throw new ApiError(502, 'share-failed', 'Reddit did not accept the comment. Please try again.');
  }
}
