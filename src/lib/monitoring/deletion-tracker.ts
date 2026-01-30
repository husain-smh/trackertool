/**
 * Deletion Tracker - Detects deleted engagements by comparing current vs previous engager lists
 * Marks deleted engagements in the database without sending alerts
 */

import { markEngagementsDeleted } from '../models/monitoring-engagements';

export interface DeletionResult {
  deletedUserIds: string[];
  count: number;
}

/**
 * Detect deletions by comparing current engager IDs with previous known IDs
 * Returns the user IDs that are no longer present
 */
export function detectDeletedUserIds(
  currentEngagerIds: string[],
  previousEngagerIds: string[]
): string[] {
  const currentSet = new Set(currentEngagerIds);

  // Find IDs that were in previous but not in current
  const deletedIds = previousEngagerIds.filter((id) => !currentSet.has(id));

  return deletedIds;
}

/**
 * Detect and mark deletions for a specific action type
 * Does NOT send alerts - just marks the engagements as deleted in the database
 */
export async function detectAndMarkDeletions(
  tweetId: string,
  actionType: 'retweet' | 'reply' | 'quote' | 'like',
  currentEngagerIds: string[],
  previousEngagerIds: string[]
): Promise<DeletionResult> {
  const deletedUserIds = detectDeletedUserIds(currentEngagerIds, previousEngagerIds);

  if (deletedUserIds.length === 0) {
    return { deletedUserIds: [], count: 0 };
  }

  // Mark these engagements as deleted in the database
  const markedCount = await markEngagementsDeleted(tweetId, actionType, deletedUserIds);

  console.log(
    `[deletion-tracker] Marked ${markedCount} deleted ${actionType} engagements for tweet ${tweetId}`
  );

  return {
    deletedUserIds,
    count: markedCount,
  };
}

/**
 * Detect deletions for all action types
 */
export async function detectAllDeletions(
  tweetId: string,
  currentEngagers: {
    replies: string[];
    retweets: string[];
    quotes: string[];
    likes: string[];
  },
  previousEngagers: {
    replies: string[];
    retweets: string[];
    quotes: string[];
    likes: string[];
  }
): Promise<{
  reply: DeletionResult;
  retweet: DeletionResult;
  quote: DeletionResult;
  like: DeletionResult;
  totalDeleted: number;
}> {
  const [reply, retweet, quote, like] = await Promise.all([
    detectAndMarkDeletions(tweetId, 'reply', currentEngagers.replies, previousEngagers.replies),
    detectAndMarkDeletions(tweetId, 'retweet', currentEngagers.retweets, previousEngagers.retweets),
    detectAndMarkDeletions(tweetId, 'quote', currentEngagers.quotes, previousEngagers.quotes),
    detectAndMarkDeletions(tweetId, 'like', currentEngagers.likes, previousEngagers.likes),
  ]);

  const totalDeleted = reply.count + retweet.count + quote.count + like.count;

  return { reply, retweet, quote, like, totalDeleted };
}

/**
 * Summarize deletion results for logging
 */
export function summarizeDeletions(results: {
  reply: DeletionResult;
  retweet: DeletionResult;
  quote: DeletionResult;
  like: DeletionResult;
  totalDeleted: number;
}): string {
  if (results.totalDeleted === 0) {
    return 'No deletions detected';
  }

  const parts: string[] = [];

  if (results.reply.count > 0) {
    parts.push(`${results.reply.count} replies`);
  }
  if (results.retweet.count > 0) {
    parts.push(`${results.retweet.count} retweets`);
  }
  if (results.quote.count > 0) {
    parts.push(`${results.quote.count} quotes`);
  }
  if (results.like.count > 0) {
    parts.push(`${results.like.count} likes`);
  }

  return `Deleted: ${parts.join(', ')} (${results.totalDeleted} total)`;
}
