/**
 * User Processing Module - Extract, deduplicate, and merge user data
 * from different engagement types (replies, retweets, quotes)
 */

import { FilteredUser } from './twitter-api-client';
import { EngagerInput } from './models/tweets';

/**
 * Extract users from replies data structure (tweets[].author)
 */
export function extractUsersFromReplies(
  replies: FilteredUser[]
): EngagerInput[] {
  return replies.map(user => ({
    userId: user.userId,
    username: user.username || '',
    name: user.name || user.username || '',
    bio: user.bio ?? undefined,
    location: user.location ?? undefined,
    followers: user.followers,
    verified: user.verified,
    replied: true,
    retweeted: false,
    quoted: false,
    replied_at: user.engagementCreatedAt,
  }));
}

/**
 * Extract users from retweets data structure (users[])
 */
export function extractUsersFromRetweets(
  retweets: FilteredUser[]
): EngagerInput[] {
  return retweets.map(user => ({
    userId: user.userId,
    username: user.username || '',
    name: user.name || user.username || '',
    bio: user.bio ?? undefined,
    location: user.location ?? undefined,
    followers: user.followers,
    verified: user.verified,
    replied: false,
    retweeted: true,
    quoted: false,
    retweeted_at: user.engagementCreatedAt,
  }));
}

/**
 * Extract users from quotes data structure (tweets[].author)
 */
export function extractUsersFromQuotes(
  quotes: FilteredUser[]
): EngagerInput[] {
  return quotes.map(user => ({
    userId: user.userId,
    username: user.username || '',
    name: user.name || user.username || '',
    bio: user.bio ?? undefined,
    location: user.location ?? undefined,
    followers: user.followers,
    verified: user.verified,
    replied: false,
    retweeted: false,
    quoted: true,
    quoted_at: user.engagementCreatedAt,
  }));
}

/**
 * Deduplicate users by userId, keeping the first occurrence
 */
export function deduplicateUsers(users: EngagerInput[]): EngagerInput[] {
  const seen = new Map<string, EngagerInput>();
  
  for (const user of users) {
    if (!seen.has(user.userId)) {
      seen.set(user.userId, user);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Merge engagement data from replies, retweets, and quotes
 * Similar to SQL FULL OUTER JOIN - combines all users and sets engagement flags
 */
export function mergeEngagementData(
  replies: EngagerInput[],
  retweets: EngagerInput[],
  quotes: EngagerInput[]
): EngagerInput[] {
  const userMap = new Map<string, EngagerInput>();

  // Process replies
  for (const user of replies) {
    if (!userMap.has(user.userId)) {
      userMap.set(user.userId, { ...user });
    } else {
      const existing = userMap.get(user.userId)!;
      existing.replied = true;
      // Merge timestamp if not already set (keep earliest)
      if (!existing.replied_at || (user.replied_at && user.replied_at < existing.replied_at)) {
        existing.replied_at = user.replied_at;
      }
      // Merge other fields if missing
      if (!existing.bio && user.bio) existing.bio = user.bio;
      if (!existing.location && user.location) existing.location = user.location;
      if (!existing.name && user.name) existing.name = user.name;
      if (!existing.username && user.username) existing.username = user.username;
    }
  }

  // Process retweets
  for (const user of retweets) {
    if (!userMap.has(user.userId)) {
      userMap.set(user.userId, { ...user });
    } else {
      const existing = userMap.get(user.userId)!;
      existing.retweeted = true;
      // Merge timestamp if not already set (keep earliest)
      if (!existing.retweeted_at || (user.retweeted_at && user.retweeted_at < existing.retweeted_at)) {
        existing.retweeted_at = user.retweeted_at;
      }
      // Merge other fields if missing
      if (!existing.bio && user.bio) existing.bio = user.bio;
      if (!existing.location && user.location) existing.location = user.location;
      if (!existing.name && user.name) existing.name = user.name;
      if (!existing.username && user.username) existing.username = user.username;
    }
  }

  // Process quotes
  for (const user of quotes) {
    if (!userMap.has(user.userId)) {
      userMap.set(user.userId, { ...user });
    } else {
      const existing = userMap.get(user.userId)!;
      existing.quoted = true;
      // Merge timestamp if not already set (keep earliest)
      if (!existing.quoted_at || (user.quoted_at && user.quoted_at < existing.quoted_at)) {
        existing.quoted_at = user.quoted_at;
      }
      // Merge other fields if missing
      if (!existing.bio && user.bio) existing.bio = user.bio;
      if (!existing.location && user.location) existing.location = user.location;
      if (!existing.name && user.name) existing.name = user.name;
      if (!existing.username && user.username) existing.username = user.username;
    }
  }

  return Array.from(userMap.values());
}

/**
 * Process and merge all engagement types into a single unified list
 */
export function processAllEngagements(
  replies: FilteredUser[],
  retweets: FilteredUser[],
  quotes: FilteredUser[]
): EngagerInput[] {
  // Extract users from each engagement type
  const replyUsers = extractUsersFromReplies(replies);
  const retweetUsers = extractUsersFromRetweets(retweets);
  const quoteUsers = extractUsersFromQuotes(quotes);

  // Merge all engagement data
  const merged = mergeEngagementData(replyUsers, retweetUsers, quoteUsers);

  // Final deduplication (shouldn't be needed after merge, but safety check)
  return deduplicateUsers(merged);
}

