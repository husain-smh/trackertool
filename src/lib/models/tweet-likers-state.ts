/**
 * Per-tweet liker sync state (Social Capital tweet analysis).
 *
 * Stores cursor/backfill/blocked-until so we can be rate-limit friendly and resumable.
 */

import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

export interface TweetLikersState {
  _id?: string;
  tweet_id: string;
  cursor: string | null;
  backfill_complete: boolean;
  blocked_until: Date | null;
  last_success: Date | null;
  last_error: string | null;
  updated_at: Date;
}

export async function getTweetLikersStateCollection(): Promise<Collection<TweetLikersState>> {
  const db = await getDb();
  return db.collection<TweetLikersState>('tweet_likers_state');
}

export async function createTweetLikersStateIndexes(): Promise<void> {
  const col = await getTweetLikersStateCollection();
  await col.createIndex({ tweet_id: 1 }, { unique: true });
  await col.createIndex({ blocked_until: 1 });
}

export async function getOrCreateTweetLikersState(tweetId: string): Promise<TweetLikersState> {
  const col = await getTweetLikersStateCollection();
  const existing = await col.findOne({ tweet_id: tweetId });
  if (existing) return existing;

  const state: TweetLikersState = {
    tweet_id: tweetId,
    cursor: null,
    backfill_complete: false,
    blocked_until: null,
    last_success: null,
    last_error: null,
    updated_at: new Date(),
  };

  await col.insertOne(state);
  return state;
}

export async function updateTweetLikersState(
  tweetId: string,
  updates: Partial<Pick<TweetLikersState, 'cursor' | 'backfill_complete' | 'blocked_until' | 'last_success' | 'last_error'>>
): Promise<void> {
  const col = await getTweetLikersStateCollection();
  await col.updateOne(
    { tweet_id: tweetId },
    { $set: { ...updates, updated_at: new Date() } },
    { upsert: true }
  );
}

