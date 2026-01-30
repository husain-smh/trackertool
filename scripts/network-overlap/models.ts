/**
 * Database operations for the Network Overlap Tool
 */

import { getDb } from './db';
import type { SeedUser, FollowingIndex, UserReference, OverlapResult } from './types';

const SEED_USERS_COLLECTION = 'seed_users';
const FOLLOWING_INDEX_COLLECTION = 'following_index';

/**
 * Save or update a seed user and their following list
 */
export async function saveSeedUser(
  username: string,
  userId: string,
  name: string,
  followingList: UserReference[]
): Promise<void> {
  const db = await getDb();
  const collection = db.collection<SeedUser>(SEED_USERS_COLLECTION);

  await collection.updateOne(
    { username: username.toLowerCase() },
    {
      $set: {
        username: username.toLowerCase(),
        user_id: userId,
        name,
        following_count: followingList.length,
        following_list: followingList,
        synced_count: 0,
        updated_at: new Date(),
      },
      $setOnInsert: {
        created_at: new Date(),
      },
    },
    { upsert: true }
  );
}

/**
 * Get a seed user by username
 */
export async function getSeedUser(username: string): Promise<SeedUser | null> {
  const db = await getDb();
  const collection = db.collection<SeedUser>(SEED_USERS_COLLECTION);

  return collection.findOne({ username: username.toLowerCase() });
}

/**
 * Update the synced count for a seed user
 */
export async function updateSyncedCount(username: string, syncedCount: number): Promise<void> {
  const db = await getDb();
  const collection = db.collection<SeedUser>(SEED_USERS_COLLECTION);

  await collection.updateOne(
    { username: username.toLowerCase() },
    {
      $set: {
        synced_count: syncedCount,
        updated_at: new Date(),
      },
    }
  );
}

/**
 * Update the following index for an important person's followings
 * This builds the reverse lookup: "who follows X?"
 */
export async function updateFollowingIndex(
  importantPerson: UserReference,
  theirFollowingList: UserReference[]
): Promise<void> {
  if (theirFollowingList.length === 0) return;

  const db = await getDb();
  const collection = db.collection<FollowingIndex>(FOLLOWING_INDEX_COLLECTION);

  // For each account the important person follows, add them to the index
  const bulkOps = theirFollowingList.map((followedUser) => ({
    updateOne: {
      filter: { followed_user_id: followedUser.user_id },
      update: {
        $set: {
          followed_user_id: followedUser.user_id,
          followed_username: followedUser.username.toLowerCase(),
          updated_at: new Date(),
        },
        $addToSet: {
          followed_by: importantPerson,
        },
      },
      upsert: true,
    },
  }));

  // Process in chunks to avoid MongoDB limits
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < bulkOps.length; i += CHUNK_SIZE) {
    const chunk = bulkOps.slice(i, i + CHUNK_SIZE);
    await collection.bulkWrite(chunk, { ordered: false });
  }
}

/**
 * Bulk update the following index for multiple important people at once
 * More efficient than calling updateFollowingIndex repeatedly
 */
export async function bulkUpdateFollowingIndex(
  updates: Array<{ importantPerson: UserReference; theirFollowingList: UserReference[] }>
): Promise<void> {
  const db = await getDb();
  const collection = db.collection<FollowingIndex>(FOLLOWING_INDEX_COLLECTION);

  // Collect all bulk operations
  const allBulkOps: any[] = [];

  for (const { importantPerson, theirFollowingList } of updates) {
    for (const followedUser of theirFollowingList) {
      allBulkOps.push({
        updateOne: {
          filter: { followed_user_id: followedUser.user_id },
          update: {
            $set: {
              followed_user_id: followedUser.user_id,
              followed_username: followedUser.username.toLowerCase(),
              updated_at: new Date(),
            },
            $addToSet: {
              followed_by: importantPerson,
            },
          },
          upsert: true,
        },
      });
    }
  }

  if (allBulkOps.length === 0) return;

  // Process in chunks to avoid MongoDB limits
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < allBulkOps.length; i += CHUNK_SIZE) {
    const chunk = allBulkOps.slice(i, i + CHUNK_SIZE);
    await collection.bulkWrite(chunk, { ordered: false });
  }
}

/**
 * Query the overlap for a given username
 */
export async function queryOverlap(username: string): Promise<OverlapResult | null> {
  const db = await getDb();
  const collection = db.collection<FollowingIndex>(FOLLOWING_INDEX_COLLECTION);

  const result = await collection.findOne({
    followed_username: username.toLowerCase(),
  });

  if (!result) {
    return null;
  }

  return {
    username: result.followed_username,
    user_id: result.followed_user_id,
    overlap_score: result.overlap_score || result.followed_by.length,
    followed_by: result.followed_by,
  };
}

/**
 * Query overlap by user ID (alternative lookup)
 */
export async function queryOverlapById(userId: string): Promise<OverlapResult | null> {
  const db = await getDb();
  const collection = db.collection<FollowingIndex>(FOLLOWING_INDEX_COLLECTION);

  const result = await collection.findOne({
    followed_user_id: userId,
  });

  if (!result) {
    return null;
  }

  return {
    username: result.followed_username,
    user_id: result.followed_user_id,
    overlap_score: result.overlap_score || result.followed_by.length,
    followed_by: result.followed_by,
  };
}

/**
 * List all seed users
 */
export async function listSeedUsers(): Promise<SeedUser[]> {
  const db = await getDb();
  const collection = db.collection<SeedUser>(SEED_USERS_COLLECTION);

  return collection.find({}).sort({ created_at: -1 }).toArray();
}

/**
 * Get top accounts by overlap score
 */
export async function getTopOverlap(limit: number = 100): Promise<OverlapResult[]> {
  const db = await getDb();
  const collection = db.collection<FollowingIndex>(FOLLOWING_INDEX_COLLECTION);

  const results = await collection
    .find({})
    .sort({ overlap_score: -1 })
    .limit(limit)
    .toArray();

  return results.map((r) => ({
    username: r.followed_username,
    user_id: r.followed_user_id,
    overlap_score: r.overlap_score || r.followed_by.length,
    followed_by: r.followed_by,
  }));
}

/**
 * Create indexes for efficient queries
 */
export async function createIndexes(): Promise<void> {
  const db = await getDb();

  // Seed users indexes
  const seedCollection = db.collection(SEED_USERS_COLLECTION);
  await seedCollection.createIndex({ username: 1 }, { unique: true });
  await seedCollection.createIndex({ user_id: 1 });

  // Following index indexes
  const indexCollection = db.collection(FOLLOWING_INDEX_COLLECTION);
  await indexCollection.createIndex({ followed_user_id: 1 }, { unique: true });
  await indexCollection.createIndex({ followed_username: 1 });
  await indexCollection.createIndex({ overlap_score: -1 });

  console.log('✅ Database indexes created');
}

/**
 * Get stats about the index
 */
export async function getIndexStats(): Promise<{
  totalIndexedAccounts: number;
  totalSeedUsers: number;
}> {
  const db = await getDb();

  const [indexCount, seedCount] = await Promise.all([
    db.collection(FOLLOWING_INDEX_COLLECTION).countDocuments(),
    db.collection(SEED_USERS_COLLECTION).countDocuments(),
  ]);

  return {
    totalIndexedAccounts: indexCount,
    totalSeedUsers: seedCount,
  };
}
