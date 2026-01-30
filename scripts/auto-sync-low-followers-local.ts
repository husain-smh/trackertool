#!/usr/bin/env node

import 'dotenv/config';
import rankerDbPromise from '../src/lib/mongodb-ranker';
import type { ImportantPerson } from '../src/lib/models/ranker';
import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';

/**
 * Auto Sync Low-Following Important People (Local, no N8N)
 *
 * - Finds important_people entries:
 *     is_active: true
 *     last_synced: null (never synced)
 * - For each:
 *     - Get live following_count from twitterapi.io
 *     - If following_count === 0 -> mark synced without fetching pages
 *     - If following_count > FOLLOWING_THRESHOLD (default 6000) -> skip
 *     - Else: page through followings via twitterapi.io, clean/dedupe, POST to
 *       /api/ranker/sync/following
 *
 * Usage:
 *   npx tsx scripts/auto-sync-low-followers-local.ts
 *
 * Env:
 *   - TWITTER_API_KEY (required)
 *   - TWITTER_API_URL (optional)
 *   - AUTO_SYNC_BASE_URL (optional, default: http://localhost:3000)
 *   - REQUEST_INTERVAL_MS (optional, default: 500)
 *   - MAX_REQUESTS (optional, default: 500)
 */

const FOLLOWING_THRESHOLD = 10000;
const BASE_URL = process.env.AUTO_SYNC_BASE_URL || 'http://localhost:3000';
// Loosen defaults to better handle large followings (e.g., 28k)
const REQUEST_INTERVAL_MS = Number(process.env.REQUEST_INTERVAL_MS ?? 750);
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS ?? 3000);
const MAX_RETRIES = 5;
const args = process.argv.slice(2);
let argUsername: string | undefined;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--username' && typeof args[i + 1] === 'string') {
    argUsername = args[i + 1];
    break;
  }
  if (arg.startsWith('--username=')) {
    argUsername = arg.split('=')[1];
    break;
  }
}
if (!argUsername && args.length > 0) {
  argUsername = args[0];
}
const FORCED_USERNAME = argUsername ? argUsername.replace(/^@/, '').trim() : undefined;

function ts(): string {
  return new Date().toISOString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FollowingsResponse = {
  followings?: any[];
  has_next_page?: boolean;
  next_cursor?: string | null;
};

type CleanedFollowing = {
  user_id: string;
  username: string;
  name: string;
  screen_name?: string | null;
  followers_count?: number | null;
  description?: string | null;
  verified?: boolean | null;
};

type ProcessOptions = {
  threshold: number;
  allowHighFollowingOverride?: boolean;
  onThresholdSkip?: (username: string, followingCount: number) => void;
};

async function fetchJsonWithRetry(url: string, headers: Record<string, string>): Promise<any> {
  let attempt = 0;
  let delay = 1000;

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        return res.json();
      }

      if (res.status === 429 || res.status >= 500) {
        console.warn(
          `[${ts()}] ⚠️  Request failed (status ${res.status}). Attempt ${attempt}/${MAX_RETRIES}. Retrying in ${delay}ms...`,
        );
        await sleep(delay);
        delay = Math.min(delay * 2, 16000);
        continue;
      }

      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${body || ''}`);
    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        throw err;
      }
      console.warn(
        `[${ts()}] ⚠️  Error on attempt ${attempt}/${MAX_RETRIES}: ${String(err)}. Retrying in ${delay}ms...`,
      );
      await sleep(delay);
      delay = Math.min(delay * 2, 16000);
    }
  }

  throw new Error('Retries exhausted');
}

async function fetchFollowingCount(username: string): Promise<number | null> {
  const config = getTwitterApiConfig();

  if (!config.apiKey) {
    console.error(`[${ts()}] ❌ TWITTER_API_KEY not configured in environment.`);
    return null;
  }

  try {
    const url = new URL(`${config.apiUrl}/twitter/user/info`);
    url.searchParams.set('userName', username);

    console.log(
      `[${ts()}]   🌐 Fetching twitterapi.io user info for @${username} → ${url.toString()}`,
    );

    const data = await fetchJsonWithRetry(url.toString(), {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    });

    const following = data?.data?.following;

    if (typeof following === 'number') {
      return following;
    }

    const parsed = parseInt(String(following ?? '0'), 10);
    if (Number.isNaN(parsed)) {
      console.error(
        `[${ts()}] ❌ Could not parse following for @${username}. Raw value:`,
        following,
      );
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(
      `[${ts()}] ❌ Error fetching following count for @${username}:`,
      error,
    );
    return null;
  }
}

async function fetchUserInfo(username: string): Promise<{ user_id: string; name: string; username: string }> {
  const config = getTwitterApiConfig();
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY not configured');
  }

  const url = new URL(`${config.apiUrl}/twitter/user/info`);
  url.searchParams.set('userName', username);

  const data = await fetchJsonWithRetry(url.toString(), {
    'X-API-Key': config.apiKey,
    'Content-Type': 'application/json',
  });

  const userId = data?.data?.userId || data?.data?.id || data?.data?.user_id;
  const name = data?.data?.name || username;

  if (!userId) {
    throw new Error('User info did not contain userId');
  }

  return { user_id: String(userId), name: String(name), username };
}

async function fetchFollowings(username: string): Promise<any[]> {
  const config = getTwitterApiConfig();
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY not configured');
  }

  let cursor: string | null | undefined = undefined;
  let page = 0;
  let requests = 0;
  const all: any[] = [];

  while (true) {
    if (requests >= MAX_REQUESTS) {
      console.warn(`[${ts()}] ⚠️  Reached MAX_REQUESTS (${MAX_REQUESTS}), stopping pagination.`);
      break;
    }
    requests += 1;
    page += 1;

    const url = new URL(`${config.apiUrl}/twitter/user/followings`);
    url.searchParams.set('userName', username);
    if (cursor) url.searchParams.set('cursor', cursor);

    console.log(`[${ts()}] 🌐 Fetching followings page ${page} (cursor=${cursor ?? 'start'})`);

    const data = (await fetchJsonWithRetry(url.toString(), {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    })) as FollowingsResponse;

    const followings = Array.isArray(data?.followings) ? data.followings : [];
    console.log(`[${ts()}] ✅ Page ${page}: ${followings.length} followings`);
    all.push(...followings);

    const hasNext = data?.has_next_page ?? false;
    cursor = data?.next_cursor;

    if (!hasNext || !cursor) {
      console.log(`[${ts()}] 🏁 Pagination complete (page ${page}).`);
      break;
    }

    await sleep(REQUEST_INTERVAL_MS);
  }

  return all;
}

function cleanFollowings(raw: any[]): CleanedFollowing[] {
  const map = new Map<string, CleanedFollowing>();

  for (const user of raw) {
    const userId = String(user?.id ?? user?.userId ?? user?.user_id ?? '');
    if (!userId) continue;

    const username = String(user?.userName ?? user?.username ?? user?.screen_name ?? '').trim();
    const name = String(user?.name ?? username ?? userId).trim();

    const cleaned: CleanedFollowing = {
      user_id: userId,
      username,
      name,
      screen_name: user?.screen_name ?? null,
      followers_count:
        user?.followers_count !== undefined
          ? Number(user.followers_count)
          : user?.followers !== undefined
          ? Number(user.followers)
          : null,
      description: user?.description ?? null,
      verified:
        user?.verified !== undefined
          ? Boolean(user.verified)
          : user?.isBlueVerified !== undefined
          ? Boolean(user.isBlueVerified)
          : null,
    };

    if (!map.has(userId)) {
      map.set(userId, cleaned);
    }
  }

  return Array.from(map.values());
}

async function postToBackend(payload: {
  username: string;
  user_id: string;
  following_list: CleanedFollowing[];
}): Promise<void> {
  const endpoint = `${BASE_URL}/api/ranker/sync/following`;
  console.log(`[${ts()}] 📡 Posting ${payload.following_list.length} followings to ${endpoint}`);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sync endpoint failed: ${res.status} ${res.statusText} ${body}`);
  }

  const data = await res.json().catch(() => null);
  console.log(`[${ts()}] ✅ Sync complete`, data);
}

async function processUser(
  username: string,
  options: ProcessOptions,
): Promise<'synced' | 'skipped' | 'zero' | 'failed'> {
  // 1) Get following count
  const followingCount = await fetchFollowingCount(username);
  if (followingCount === null) {
    console.log(
      `   ⚠️  [${ts()}] Skipping @${username} because following count lookup failed.`,
    );
    return 'skipped';
  }

  console.log(
    `   ℹ️  [${ts()}] @${username} following_count=${followingCount}`,
  );

  // 2) Zero-following shortcut
  if (followingCount === 0) {
    console.log(
      `   ✅ [${ts()}] @${username} has 0 following. Marking as synced without fetching pages.`,
    );

    const db = await rankerDbPromise;
    const collection = db.collection<ImportantPerson>('important_people');
    await collection.updateOne(
      { username },
      {
        $set: {
          last_synced: new Date(),
          following_count: 0,
          updated_at: new Date(),
        },
      },
    );

    return 'zero';
  }

  // 3) Threshold check
  const exceedsThreshold = followingCount > options.threshold;

  if (exceedsThreshold && !options.allowHighFollowingOverride) {
    options.onThresholdSkip?.(username, followingCount);
    console.log(
      `   ⏭️  [${ts()}] Skipping @${username} (following_count ${followingCount} > ${options.threshold}).`,
    );
    return 'skipped';
  }

  if (exceedsThreshold && options.allowHighFollowingOverride) {
    console.log(
      `   ✅ [${ts()}] Following count ${followingCount} exceeds threshold ${options.threshold}, but override is enabled. Continuing...`,
    );
  }

  // 4) Fetch followings pages
  const userInfo = await fetchUserInfo(username);
  const rawFollowings = await fetchFollowings(username);
  const cleanedFollowings = cleanFollowings(rawFollowings);

  console.log(
    `   🔄 [${ts()}] Posting cleaned followings for @${username}: raw=${rawFollowings.length}, deduped=${cleanedFollowings.length}`,
  );

  await postToBackend({
    username: userInfo.username,
    user_id: userInfo.user_id,
    following_list: cleanedFollowings,
  });

  return 'synced';
}

async function main() {
  console.log(`[${ts()}] 🚀 Auto Sync Low-Following Important People (Local)`);
  console.log('-------------------------------------------');
  console.log(`[${ts()}] Base URL: ${BASE_URL}`);
  console.log(`[${ts()}] Following threshold: ${FOLLOWING_THRESHOLD}`);
  console.log(`[${ts()}] Request interval: ${REQUEST_INTERVAL_MS}ms, Max requests: ${MAX_REQUESTS}`);
  console.log(`[${ts()}] Criteria: is_active=true AND last_synced=null (never synced)`);
  console.log('');

  try {
    if (FORCED_USERNAME) {
      console.log(`[${ts()}] 🎯 Forced single-user mode for @${FORCED_USERNAME}. Threshold override enabled.`);

      const result = await processUser(FORCED_USERNAME, {
        threshold: FOLLOWING_THRESHOLD,
        allowHighFollowingOverride: true,
      });

      console.log(`[${ts()}] Result for @${FORCED_USERNAME}: ${result}`);
      process.exit(0);
    }

    const db = await rankerDbPromise;
    const collection = db.collection<ImportantPerson>('important_people');

    const cursor = collection
      .find({
        is_active: true,
        last_synced: null,
      })
      .sort({ created_at: 1 });

    const totalToCheck = await cursor.count();
    if (totalToCheck === 0) {
      console.log(
        `[${ts()}] ✅ No unsynced important people found (last_synced is null).`,
      );
      process.exit(0);
    }

    console.log(
      `[${ts()}] Found ${totalToCheck} unsynced important people (is_active: true, last_synced: null).`,
    );
    console.log(
      `[${ts()}] Approximate minimum run time (very rough): at least ${Math.ceil(
        totalToCheck * 0.5,
      )} seconds + sync times`,
    );
    console.log('');

    let processed = 0;
    let skippedHighFollowing = 0;
    const skippedHighFollowingList: { username: string; followingCount: number }[] = [];
    let synced = 0;
    let failed = 0;
    let followingLookupFailed = 0;
    let zeroFollowingMarkedSynced = 0;

    while (await cursor.hasNext()) {
      const person = await cursor.next();
      if (!person) break;

      processed += 1;
      const username = person.username;

      console.log(
        `\n[${processed}/${totalToCheck}] [${ts()}] 👤 Checking @${username} (created_at: ${person.created_at}, last_synced: ${person.last_synced ?? 'null'})`,
      );

      try {
        const result = await processUser(username, {
          threshold: FOLLOWING_THRESHOLD,
          onThresholdSkip: (skippedUsername, followingCount) => {
            skippedHighFollowingList.push({ username: skippedUsername, followingCount });
          },
        });
        if (result === 'synced') synced += 1;
        else if (result === 'zero') zeroFollowingMarkedSynced += 1;
        else if (result === 'skipped') skippedHighFollowing += 1;
      } catch (err) {
        console.error(
          `   ❌ [${ts()}] Error processing @${username}:`,
          err,
        );
        failed += 1;
        // If following count lookup failed specifically
        if (String(err).includes('following count')) {
          followingLookupFailed += 1;
        }
      }

      await sleep(500);
    }

    console.log('\n-------------------------------------------');
    console.log(`[${ts()}] 🏁 Auto sync complete.`);
    console.log(`   Processed:             ${processed}`);
    console.log(`   Synced successfully:   ${synced}`);
    console.log(`   Skipped (> threshold): ${skippedHighFollowing}`);
    console.log(`   Zero-following synced: ${zeroFollowingMarkedSynced}`);
    console.log(`   Following lookup fail: ${followingLookupFailed}`);
    console.log(`   Sync failures:         ${failed}`);
    if (skippedHighFollowingList.length > 0) {
      console.log('\nSkipped users over threshold:');
      for (const entry of skippedHighFollowingList) {
        console.log(`   - @${entry.username} (following_count=${entry.followingCount})`);
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(
      `[${ts()}] ❌ Fatal error in auto-sync script:`,
      error,
    );
    process.exit(1);
  }
}

main();

