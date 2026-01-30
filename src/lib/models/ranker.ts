import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

// ===== TypeScript Interfaces =====

export interface ImportantPerson {
  _id?: string;
  username: string;
  user_id?: string; // Optional until first sync
  name?: string; // Optional until first sync
  weight?: number;
  networth?: number;
  last_synced?: Date | null;
  tags?: string[];
  following_count: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface FollowingIndexEntry {
  _id?: string;
  followed_username: string;
  followed_user_id: string;
  followed_by: FollowedByEntry[];
  importance_score: number;
  updated_at: Date;
}

export interface FollowedByEntry {
  username: string;
  user_id: string;
  name: string;
  weight?: number;
}

export interface EngagementRanking {
  _id?: string;
  tweet_id: string;
  ranked_engagers: RankedEngager[];
  analyzed_at: Date;
}

export interface RankedEngager {
  username: string;
  userId: string;
  name: string;
  bio?: string;
  location?: string;
  followers?: number;
  verified?: boolean;
  replied?: boolean;
  retweeted?: boolean;
  quoted?: boolean;
  importance_score: number;
  followed_by: FollowedByEntry[];
}

export interface TwitterUser {
  username: string;
  user_id: string;
  name: string;
  weight?: number;
}

export interface ImportantAccountCandidate {
  followed_username: string;
  followed_user_id: string;
  follower_count: number;
  total_weight: number;
  importance_score: number;
  sample_followed_by: FollowedByEntry[];
}

export interface EngagerInput {
  username: string;
  userId: string;
  name: string;
  bio?: string;
  location?: string;
  followers?: number;
  verified?: boolean;
  replied?: boolean;
  retweeted?: boolean;
  quoted?: boolean;
}

// ===== Helper Functions =====

export async function getImportantPeopleCollection(): Promise<Collection<ImportantPerson>> {
  const db = await getDb();
  return db.collection<ImportantPerson>('important_people');
}

export async function getDistinctImportantPersonTags(): Promise<string[]> {
  const collection = await getImportantPeopleCollection();
  const tags = await collection.distinct('tags', { is_active: true });
  const cleaned = (tags as string[])
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  const unique = Array.from(new Map(cleaned.map((tag) => [tag.toLowerCase(), tag])).values());
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

export async function getFollowingIndexCollection(): Promise<Collection<FollowingIndexEntry>> {
  const db = await getDb();
  return db.collection<FollowingIndexEntry>('following_index');
}

export async function getEngagementRankingsCollection(): Promise<Collection<EngagementRanking>> {
  const db = await getDb();
  return db.collection<EngagementRanking>('engagement_rankings');
}

interface CandidateQueryParams {
  limit?: number;
  minFollowers?: number;
  minWeight?: number;
}

export async function getImportantAccountCandidates({
  limit = 30,
  minFollowers = 3,
  minWeight = 0,
}: CandidateQueryParams = {}): Promise<ImportantAccountCandidate[]> {
  const followingIndexCollection = await getFollowingIndexCollection();

  const pipeline = [
    {
      $match: {
        importance_score: { $gte: minWeight },
      },
    },
    {
      $addFields: {
        follower_count: {
          $cond: [{ $isArray: '$followed_by' }, { $size: '$followed_by' }, 0],
        },
        total_weight: {
          $cond: [
            { $isArray: '$followed_by' },
            {
              $sum: {
                $map: {
                  input: '$followed_by',
                  as: 'follower',
                  in: { $ifNull: ['$$follower.weight', 1] },
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $match: {
        follower_count: { $gte: minFollowers },
      },
    },
    {
      $lookup: {
        from: 'important_people',
        let: {
          candidateUserId: '$followed_user_id',
          candidateUsername: '$followed_username',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$is_active', true] },
                  {
                    $or: [
                      {
                        $and: [
                          { $ne: ['$$candidateUserId', null] },
                          { $eq: ['$user_id', '$$candidateUserId'] },
                        ],
                      },
                      { $eq: ['$username', '$$candidateUsername'] },
                    ],
                  },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'existingImportant',
      },
    },
    {
      $match: {
        existingImportant: { $size: 0 },
      },
    },
    {
      $project: {
        _id: 0,
        followed_username: 1,
        followed_user_id: 1,
        importance_score: 1,
        follower_count: 1,
        total_weight: 1,
        sample_followed_by: {
          $slice: [
            {
              $ifNull: ['$followed_by', []],
            },
            5,
          ],
        },
      },
    },
    {
      $sort: {
        follower_count: -1,
        total_weight: -1,
        importance_score: -1,
      },
    },
    { $limit: limit },
  ];

  const candidates = await followingIndexCollection
    .aggregate<ImportantAccountCandidate>(pipeline)
    .toArray();

  return candidates;
}

async function recalculateImportanceScores(
  collection?: Collection<FollowingIndexEntry>
): Promise<void> {
  const followingIndexCollection = collection || (await getFollowingIndexCollection());

  await followingIndexCollection.updateMany(
    {},
    [
      {
        $set: {
          importance_score: {
            $cond: {
              if: { $isArray: '$followed_by' },
              then: {
                $sum: {
                  $map: {
                    input: '$followed_by',
                    as: 'follower',
                    in: { $ifNull: ['$$follower.weight', 1] },
                  },
                },
              },
              else: 0,
            },
          },
        },
      },
    ]
  );
}

// ===== Database Operations =====

export async function addImportantPerson(username: string): Promise<ImportantPerson> {
  const collection = await getImportantPeopleCollection();
  
  const newPerson: ImportantPerson = {
    username: username.trim(),
    weight: 1,
    tags: [],
    following_count: 0,
    is_active: true,
    last_synced: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  await collection.insertOne(newPerson);
  return newPerson;
}

export async function removeImportantPerson(username: string): Promise<boolean> {
  const collection = await getImportantPeopleCollection();
  
  const result = await collection.updateOne(
    { username },
    {
      $set: {
        is_active: false,
        updated_at: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

export async function updateImportantPersonWeight(
  username: string,
  weight: number
): Promise<boolean> {
  const importantPeopleCollection = await getImportantPeopleCollection();
  const followingIndexCollection = await getFollowingIndexCollection();

  const updatedPerson = await importantPeopleCollection.findOneAndUpdate(
    { username, is_active: true },
    {
      $set: {
        weight,
        updated_at: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!updatedPerson) {
    return false;
  }

  await followingIndexCollection.updateMany(
    { 'followed_by.username': username },
    {
      $set: {
        'followed_by.$[follower].weight': weight,
        updated_at: new Date(),
      },
    },
    {
      arrayFilters: [{ 'follower.username': username }],
    }
  );

  await recalculateImportanceScores(followingIndexCollection);
  return true;
}

export async function updateImportantPersonNetworth(
  username: string,
  networth: number | null
): Promise<boolean> {
  const importantPeopleCollection = await getImportantPeopleCollection();

  // If networth is null, unset the field; otherwise, set it
  if (networth === null) {
    const result = await importantPeopleCollection.updateOne(
      { username, is_active: true },
      {
        $unset: { networth: '' },
        $set: {
          updated_at: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  } else {
    const result = await importantPeopleCollection.updateOne(
      { username, is_active: true },
      {
        $set: {
          networth,
          updated_at: new Date(),
        },
      }
    );
    return result.modifiedCount > 0;
  }
}

export async function getImportantPeople(page: number = 1, limit: number = 20): Promise<{ people: ImportantPerson[], total: number }> {
  const collection = await getImportantPeopleCollection();
  
  const skip = (page - 1) * limit;
  const people = await collection.find({ is_active: true })
    .sort({ username: 1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  
  const total = await collection.countDocuments({ is_active: true });
  
  const normalizedPeople = people.map(person => ({
    ...person,
    weight: person.weight ?? 1,
    tags: person.tags ?? [],
  }));

  return { people: normalizedPeople, total };
}

export async function updateImportantPersonTags(
  username: string,
  tags: string[]
): Promise<boolean> {
  const importantPeopleCollection = await getImportantPeopleCollection();

  const normalizedTags = Array.from(
    new Map(
      tags
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag) => tag.length > 0)
        .map((tag) => [tag.toLowerCase(), tag] as const)
    ).values()
  );

  const result = await importantPeopleCollection.updateOne(
    { username, is_active: true },
    {
      $set: {
        tags: normalizedTags,
        updated_at: new Date(),
      },
    }
  );

  return result.modifiedCount > 0;
}

export async function updateFollowingIndex(
  importantPerson: TwitterUser,
  followingList: TwitterUser[]
): Promise<void> {
  const followingIndexCollection = await getFollowingIndexCollection();
  const importantPeopleCollection = await getImportantPeopleCollection();
  const followerWeight = importantPerson.weight ?? 1;
  
  // Step 0: Update important person with user_id and name from N8N
  await importantPeopleCollection.updateOne(
    { username: importantPerson.username },
    {
      $set: {
        user_id: importantPerson.user_id,
        name: importantPerson.name,
        updated_at: new Date(),
      },
    }
  );
  
  // Step 1: Remove this important person from all their previous following relationships
  await followingIndexCollection.updateMany(
    { 'followed_by.user_id': importantPerson.user_id },
    {
      $pull: { followed_by: { user_id: importantPerson.user_id } },
    }
  );
  
  // Step 3: Add/update entries for new following list (using bulk operations for performance)
  console.log(`Building bulk operations for ${followingList.length} following accounts...`);
  if (followingList.length > 0) {
    const bulkOps = followingList.map(followedUser => ({
      updateOne: {
        filter: { followed_user_id: followedUser.user_id },
        update: {
          $addToSet: {
            followed_by: {
              username: importantPerson.username,
              user_id: importantPerson.user_id,
              name: importantPerson.name,
              weight: followerWeight,
            },
          },
          $set: {
            followed_username: followedUser.username,
            followed_user_id: followedUser.user_id,
            updated_at: new Date(),
          },
        },
        upsert: true,
      },
    }));

    // Execute all updates in batches of 1000 for optimal performance
    const batchSize = 1000;
    for (let i = 0; i < bulkOps.length; i += batchSize) {
      const batch = bulkOps.slice(i, i + batchSize);
      await followingIndexCollection.bulkWrite(batch, { ordered: false });
      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(bulkOps.length / batchSize)} (${batch.length} operations)`);
    }
  }
  
  // Step 4: Recalculate importance scores for all users (single operation at the end)
  console.log('Recalculating importance scores...');
  await recalculateImportanceScores(followingIndexCollection);
  console.log('✅ Importance scores updated');
  
  // Step 5: Update last_synced for the important person
  await importantPeopleCollection.updateOne(
    { user_id: importantPerson.user_id },
    {
      $set: {
        last_synced: new Date(),
        following_count: followingList.length,
        updated_at: new Date(),
      },
    }
  );
}

export async function rankEngagers(engagers: EngagerInput[]): Promise<RankedEngager[]> {
  const followingIndexCollection = await getFollowingIndexCollection();
  
  // Lookup each engager in the following index
  const userIds = engagers.map(e => e.userId);
  const indexEntries = await followingIndexCollection
    .find({ followed_user_id: { $in: userIds } })
    .toArray();
  
  // Create a map for quick lookup
  const indexMap = new Map<string, FollowingIndexEntry>();
  indexEntries.forEach(entry => {
    indexMap.set(entry.followed_user_id, entry);
  });
  
  // Build ranked engagers list with all metadata preserved
  const rankedEngagers: RankedEngager[] = engagers.map(engager => {
    const indexEntry = indexMap.get(engager.userId);
    
    return {
      username: engager.username,
      userId: engager.userId,
      name: engager.name,
      bio: engager.bio,
      location: engager.location,
      followers: engager.followers,
      verified: engager.verified,
      replied: engager.replied,
      retweeted: engager.retweeted,
      quoted: engager.quoted,
      importance_score: indexEntry?.importance_score || 0,
      followed_by: indexEntry?.followed_by || [],
    };
  });
  
  // Sort by importance score descending (most important first)
  rankedEngagers.sort((a, b) => b.importance_score - a.importance_score);
  
  return rankedEngagers;
}

export async function saveEngagementRanking(
  tweetId: string,
  rankedEngagers: RankedEngager[]
): Promise<void> {
  const collection = await getEngagementRankingsCollection();
  
  await collection.insertOne({
    tweet_id: tweetId,
    ranked_engagers: rankedEngagers,
    analyzed_at: new Date(),
  });
}

// ===== Index Creation =====
export async function createIndexes(): Promise<void> {
  const importantPeopleCollection = await getImportantPeopleCollection();
  const followingIndexCollection = await getFollowingIndexCollection();
  const engagementRankingsCollection = await getEngagementRankingsCollection();
  
  // Important people indexes
  await importantPeopleCollection.createIndex({ username: 1 }, { unique: true });
  await importantPeopleCollection.createIndex({ user_id: 1 }); // Non-unique, just for lookups
  await importantPeopleCollection.createIndex({ is_active: 1 });
  
  // Following index indexes (critical for performance)
  await followingIndexCollection.createIndex({ followed_user_id: 1 }, { unique: true });
  await followingIndexCollection.createIndex({ followed_username: 1 });
  await followingIndexCollection.createIndex({ importance_score: -1 });
  await followingIndexCollection.createIndex({ 'followed_by.user_id': 1 });
  
  // Engagement rankings indexes
  await engagementRankingsCollection.createIndex({ tweet_id: 1 });
  await engagementRankingsCollection.createIndex({ analyzed_at: -1 });
}

