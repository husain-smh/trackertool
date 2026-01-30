#!/usr/bin/env node

import 'dotenv/config';

/**
 * Auto Sync Low-Following Important People
 *
 * - Finds important_people entries that are:
 *   - is_active: true
 *   - last_synced: null (never synced)
 * - For each person:
 *   - Checks their following_count from Mongo
 *   - If following_count > FOLLOWING_THRESHOLD (default: 6000) -> skip
 *   - If following_count <= FOLLOWING_THRESHOLD -> calls existing Next.js API
 *     POST /api/ranker/admin/sync-person with { username }
 *   - Waits for that sync to complete before continuing
 *
 * Usage:
 *   npx tsx scripts/auto-sync-low-followers.ts
 *
 * Requirements:
 *   - NEXT server running (so /api/ranker/admin/sync-person is reachable)
 *   - Env vars:
 *       MONGODB_URI
 *       AUTO_SYNC_BASE_URL (optional, defaults to http://localhost:3000)
 */

import rankerDbPromise from '../src/lib/mongodb-ranker';
import type { ImportantPerson } from '../src/lib/models/ranker';
import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';

const FOLLOWING_THRESHOLD = 6000;
const BASE_URL = process.env.AUTO_SYNC_BASE_URL || 'http://localhost:3000';

interface SyncPersonApiResult {
  username: string;
  success: boolean;
  message: string;
  following_count?: number;
  synced_at?: string | Date;
  error?: string;
}

interface SyncPersonApiResponse {
  success: boolean;
  message: string;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  results: SyncPersonApiResult[];
}

function ts(): string {
  return new Date().toISOString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch live following count for a username from twitterapi.io
 * using the /twitter/user/info endpoint.
 *
 * This lets us:
 * - Distinguish true 0-following accounts (no need to call N8N)
 * - Apply the 6000 following threshold based on real data
 */
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

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(
        `[${ts()}] ❌ Failed to fetch user info for @${username}. Status: ${response.status}`,
      );
      const text = await response.text().catch(() => '');
      if (text) {
        console.error(`[${ts()}]     Response body:`, text);
      }
      return null;
    }

    const data = (await response.json()) as any;
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

async function triggerSync(username: string): Promise<SyncPersonApiResult | null> {
  const endpoint = `${BASE_URL}/api/ranker/admin/sync-person`;

  try {
    console.log(
      `[${ts()}]   📡 Calling sync API for @${username} → ${endpoint}`,
    );

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username }),
    });

    if (!response.ok) {
      console.error(
        `[${ts()}] ❌ Sync API returned non-OK status for @${username}: ${response.status}`,
      );
      const text = await response.text().catch(() => '');
      if (text) {
          console.error(`[${ts()}]     Response body:`, text);
      }
      return null;
    }

    const data = (await response.json()) as SyncPersonApiResponse;
    const result = data.results?.[0];

    if (!result) {
      console.error(
        `[${ts()}] ❌ Sync API response did not contain results for @${username}. Full response:`,
        data,
      );
      return null;
    }

    return result;
  } catch (error) {
    console.error(
      `[${ts()}] ❌ Error calling sync API for @${username}:`,
      error,
    );
    return null;
  }
}

async function main() {
  console.log(`[${ts()}] 🚀 Auto Sync Low-Following Important People`);
  console.log('-------------------------------------------');
  console.log(`[${ts()}] Base URL: ${BASE_URL}`);
  console.log(`[${ts()}] Following threshold: ${FOLLOWING_THRESHOLD}`);
  console.log(
    `[${ts()}] Criteria: is_active=true AND last_synced=null (never synced)`,
  );
  console.log('');

  try {
    const db = await rankerDbPromise;
    const collection = db.collection<ImportantPerson>('important_people');

    // Find unsynced important people (last_synced: null)
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
    let synced = 0;
    let failed = 0;
    let followingLookupFailed = 0;
    let zeroFollowingMarkedSynced = 0;

    while (await cursor.hasNext()) {
      const person = await cursor.next();
      if (!person) break;

      processed += 1;
      const username = person.username;

      // 1) Get live following count from twitterapi.io
      const followingCount = await fetchFollowingCount(username);
      if (followingCount === null) {
        console.log(
          `   ⚠️  [${ts()}] Skipping @${username} because following count lookup failed (see error above).`,
        );
        followingLookupFailed += 1;
        continue;
      }

      console.log(
        `\n[${processed}/${totalToCheck}] [${ts()}] 👤 Checking @${username} (created_at: ${person.created_at}, last_synced: ${person.last_synced ?? 'null'}, following_count: ${followingCount})`,
      );

      // 2) Handle special case: true zero-following accounts
      if (followingCount === 0) {
        console.log(
          `   ✅ [${ts()}] @${username} has 0 following (from twitterapi.io). Marking as synced without calling N8N.`,
        );

        // Directly mark as synced in important_people so it no longer shows as pending
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

        zeroFollowingMarkedSynced += 1;
        synced += 1;
        // No need to call sync API or N8N – there is nothing to index.
        continue;
      }

      // 3) Use following_count from twitterapi.io for threshold + decision
      console.log(`   ℹ️  Following count: ${followingCount}`);

      // 4) Apply threshold
      if (followingCount > FOLLOWING_THRESHOLD) {
        console.log(
          `   ⏭️  [${ts()}] Skipping @${username} (following_count ${followingCount} > ${FOLLOWING_THRESHOLD}).`,
        );
        skippedHighFollowing += 1;
        continue;
      }

      // 5) Trigger sync via existing API (N8N will handle pagination / errors)
      console.log(
        `   🔄 [${ts()}] Triggering sync for @${username} (following_count ${followingCount} <= ${FOLLOWING_THRESHOLD})...`,
      );
      const result = await triggerSync(username);

      if (!result) {
        console.log(
          `   ❌ [${ts()}] Sync failed for @${username} (no result from API).`,
        );
        failed += 1;
      } else if (!result.success) {
        console.log(
          `   ❌ [${ts()}] Sync failed for @${username}: ${result.message} (${result.error || 'no error detail'})`,
        );
        failed += 1;
      } else {
        console.log(
          `   ✅ [${ts()}] Synced @${username}. Following count: ${
            result.following_count ?? 'unknown'
          }`,
        );
        synced += 1;
      }

      // Small delay between users to avoid hammering the Next.js API / N8N
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


