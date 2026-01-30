import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

export type LocationCacheStatus = 'done' | 'no_data' | 'error';

export interface UsernameLocationCacheEntry {
  _id?: unknown;
  /**
   * Normalized username key:
   * - lowercase
   * - no leading "@"
   */
  username: string;
  account_based_in: string | null;
  status: LocationCacheStatus;
  updated_at: Date;
  last_error?: string;
}

export async function getUsernameLocationCacheCollection(): Promise<
  Collection<UsernameLocationCacheEntry>
> {
  const db = await getDb();
  return db.collection<UsernameLocationCacheEntry>('username_location_cache');
}

export function normalizeUsernameForCache(username: string): string {
  return (username || '').trim().replace(/^@/, '').toLowerCase();
}

export async function getCachedAccountBasedIn(username: string): Promise<UsernameLocationCacheEntry | null> {
  const collection = await getUsernameLocationCacheCollection();
  const key = normalizeUsernameForCache(username);
  if (!key) return null;
  return collection.findOne({ username: key });
}

export async function upsertAccountBasedInCache(input: {
  username: string;
  account_based_in: string | null;
  status: LocationCacheStatus;
  last_error?: string;
}): Promise<void> {
  const collection = await getUsernameLocationCacheCollection();
  const key = normalizeUsernameForCache(input.username);
  if (!key) return;

  await collection.updateOne(
    { username: key },
    {
      $set: {
        username: key,
        account_based_in: input.account_based_in,
        status: input.status,
        updated_at: new Date(),
        ...(input.last_error ? { last_error: input.last_error } : {}),
      },
    },
    { upsert: true },
  );
}

export async function createLocationCacheIndexes(): Promise<void> {
  const collection = await getUsernameLocationCacheCollection();
  await collection.createIndex({ username: 1 }, { unique: true });
  await collection.createIndex({ status: 1 });
  await collection.createIndex({ updated_at: -1 });
  console.log('✅ Location cache indexes created');
}


