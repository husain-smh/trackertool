import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

/**
 * Generic, Mongo-backed rate-limit gate.
 *
 * We use this for cross-instance throttling on serverless (Vercel) where
 * in-memory throttles don't work.
 *
 * Model: store a single "next_allowed_at" timestamp per key.
 * If now >= next_allowed_at, you acquire the slot and move next_allowed_at forward.
 */
export interface RateLimitState {
  _id: string; // key
  next_allowed_at: Date;
  updated_at: Date;
}

export async function getRateLimitStateCollection(): Promise<Collection<RateLimitState>> {
  const db = await getDb();
  return db.collection<RateLimitState>('rate_limit_state');
}

export async function createRateLimitStateIndexes(): Promise<void> {
  const col = await getRateLimitStateCollection();
  await col.createIndex({ next_allowed_at: 1 });
  console.log('✅ Rate limit state indexes created');
}

export async function tryAcquireRateLimitSlot(input: {
  key: string;
  /** Minimum delay between successful acquisitions for this key. */
  minIntervalMs: number;
  /**
   * If true, create the key on first use (default true).
   * You almost always want this.
   */
  createIfMissing?: boolean;
}): Promise<{ acquired: boolean; waitMs: number; nextAllowedAt: Date }> {
  const col = await getRateLimitStateCollection();
  const now = new Date();
  const minIntervalMs = Math.max(0, input.minIntervalMs);
  const nextAllowedAt = new Date(now.getTime() + minIntervalMs);
  const createIfMissing = input.createIfMissing ?? true;
  const key = String(input.key || '').trim();
  if (!key) {
    // If the caller gives us an empty key, don't accidentally create a shared bucket.
    return { acquired: false, waitMs: minIntervalMs, nextAllowedAt };
  }

  // Acquire by moving next_allowed_at forward, only if we're allowed now.
  // Atomic across instances.
  const res = await col.findOneAndUpdate(
    {
      _id: key,
      next_allowed_at: { $lte: now },
    },
    {
      $set: {
        next_allowed_at: nextAllowedAt,
        updated_at: now,
      },
    },
    {
      returnDocument: 'after',
    },
  );

  const acquiredDoc = (res as any)?.value ?? res;
  if (acquiredDoc && typeof (acquiredDoc as any)._id === 'string') {
    return { acquired: true, waitMs: 0, nextAllowedAt: (acquiredDoc as any).next_allowed_at ?? nextAllowedAt };
  }

  // If missing, optionally create with "allowed now" semantics (first caller wins).
  if (createIfMissing) {
    const insertRes = await col.updateOne(
      { _id: key, next_allowed_at: { $exists: false } as any },
      {
        $setOnInsert: {
          _id: key,
          next_allowed_at: nextAllowedAt,
          updated_at: now,
        },
      },
      { upsert: true },
    );

    if (insertRes.upsertedCount > 0) {
      return { acquired: true, waitMs: 0, nextAllowedAt };
    }
  }

  // Not acquired: return how long to wait (best effort).
  const existing = await col.findOne({ _id: key });
  const existingNext = existing?.next_allowed_at ?? nextAllowedAt;
  const waitMs = Math.max(0, existingNext.getTime() - Date.now());
  return { acquired: false, waitMs, nextAllowedAt: existingNext };
}

