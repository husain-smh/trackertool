#!/usr/bin/env npx tsx
/**
 * Network Overlap Tool CLI
 *
 * Given a seed user, this tool tells you: "For any Twitter account,
 * how many people that the seed user follows also follow that account?"
 *
 * Commands:
 *   build --seed <username>      Build the index for a seed user
 *   query --username <username>  Query overlap for any account
 *   list-seeds                   List all indexed seed users
 *   top [--limit N]              Show top accounts by overlap score
 *   stats                        Show index statistics
 *
 * Usage:
 *   npx tsx scripts/network-overlap/index.ts build --seed veeraj
 *   npx tsx scripts/network-overlap/index.ts query --username elonmusk
 *   npx tsx scripts/network-overlap/index.ts list-seeds
 *   npx tsx scripts/network-overlap/index.ts top --limit 50
 *   npx tsx scripts/network-overlap/index.ts stats
 */

import 'dotenv/config';
import { fetchUserInfo, fetchFollowings } from './api';
import {
  saveSeedUser,
  getSeedUser,
  updateSyncedCount,
  bulkUpdateFollowingIndex,
  queryOverlap,
  listSeedUsers,
  getTopOverlap,
  createIndexes,
  getIndexStats,
} from './models';
import { disconnect } from './db';
import type { UserReference } from './types';

// Configuration
const CONCURRENCY = 10; // Number of parallel requests
const BULK_SAVE_INTERVAL = 100; // Save to DB every N accounts
const MAX_PAGES_PER_ACCOUNT = 25; // Max 5000 followings per account (25 pages * 200)

// Parse command line arguments
function parseArgs(): {
  command: string;
  seed?: string;
  username?: string;
  limit?: number;
  resume?: boolean;
} {
  const args = process.argv.slice(2);
  const result: ReturnType<typeof parseArgs> = { command: args[0] || 'help' };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--seed' && args[i + 1]) {
      result.seed = args[i + 1].replace('@', '');
      i++;
    } else if (args[i] === '--username' && args[i + 1]) {
      result.username = args[i + 1].replace('@', '');
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      result.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--resume') {
      result.resume = true;
    }
  }

  return result;
}

/**
 * Process a single account - fetch their followings
 * Returns result, or null on skip, or throws on fatal errors (credits exhausted)
 */
async function processAccount(
  importantPerson: UserReference
): Promise<{ importantPerson: UserReference; theirFollowingList: UserReference[] } | null> {
  const { followings } = await fetchFollowings(importantPerson.username, {
    maxPages: MAX_PAGES_PER_ACCOUNT,
  });

  if (followings.length > 0) {
    const theirFollowingRefs: UserReference[] = followings.map((f) => ({
      username: f.userName.toLowerCase(),
      user_id: f.id,
      name: f.name,
    }));

    return { importantPerson, theirFollowingList: theirFollowingRefs };
  }

  return null;
}

/**
 * Build command: Index a seed user's network with parallel processing
 */
async function buildIndex(seedUsername: string, resume: boolean = false): Promise<void> {
  console.log(`\n🔨 Building network overlap index for @${seedUsername}...`);
  console.log(`   Concurrency: ${CONCURRENCY} parallel requests`);
  console.log(`   Bulk save interval: every ${BULK_SAVE_INTERVAL} accounts`);
  console.log(`   Max pages per account: ${MAX_PAGES_PER_ACCOUNT} (${MAX_PAGES_PER_ACCOUNT * 200} followings)\n`);

  // Create indexes first
  await createIndexes();

  // Check if we're resuming an existing build
  let existingSeed = await getSeedUser(seedUsername);
  let followingList: UserReference[] = [];
  let startIndex = 0;

  if (resume && existingSeed && existingSeed.following_list.length > 0) {
    console.log(`📋 Resuming from previous build...`);
    console.log(`   Seed user: @${existingSeed.username} (${existingSeed.name})`);
    console.log(`   Following: ${existingSeed.following_count}`);
    console.log(`   Already synced: ${existingSeed.synced_count}`);
    followingList = existingSeed.following_list;
    startIndex = existingSeed.synced_count;
  } else {
    // Step 1: Get seed user info
    console.log(`📡 Fetching user info for @${seedUsername}...`);
    const userInfo = await fetchUserInfo(seedUsername);
    console.log(`   Found: ${userInfo.name} (@${userInfo.userName})`);
    console.log(`   Following: ${userInfo.following}`);
    console.log(`   Followers: ${userInfo.followers}`);

    // Step 2: Get seed user's following list
    console.log(`\n📡 Fetching following list for @${seedUsername}...`);
    const { followings } = await fetchFollowings(seedUsername, {
      onProgress: (count) => {
        process.stdout.write(`\r   Fetched ${count} followings...`);
      },
    });
    console.log(`\n   ✅ Total followings fetched: ${followings.length}`);

    // Convert to UserReference format
    followingList = followings.map((f) => ({
      username: f.userName.toLowerCase(),
      user_id: f.id,
      name: f.name,
    }));

    // Step 3: Save seed user
    console.log(`\n💾 Saving seed user to database...`);
    await saveSeedUser(seedUsername, userInfo.id, userInfo.name, followingList);
    console.log(`   ✅ Saved @${seedUsername} with ${followingList.length} followings`);
  }

  // Step 4: Process accounts in parallel and build reverse index
  console.log(`\n🔄 Building reverse index from important people's followings...`);
  console.log(`   Processing ${followingList.length - startIndex} accounts (starting from ${startIndex})...\n`);

  const toProcess = followingList.slice(startIndex);
  let processed = 0;
  let errors = 0;
  let totalFollowingsFetched = 0;
  const startTime = Date.now();

  // Buffer for bulk database updates
  let updateBuffer: Array<{ importantPerson: UserReference; theirFollowingList: UserReference[] }> = [];
  let consecutiveCreditsErrors = 0;
  const MAX_CONSECUTIVE_CREDITS_ERRORS = 10; // Stop after 10 consecutive credit errors
  let abortedDueToCredits = false;

  // Process in batches with concurrency
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY);

    // Process batch in parallel, catching errors per-account
    const results = await Promise.allSettled(batch.map(processAccount));

    // Collect results
    let batchCreditsErrors = 0;
    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled' && result.value) {
        updateBuffer.push(result.value);
        totalFollowingsFetched += result.value.theirFollowingList.length;
        consecutiveCreditsErrors = 0; // Reset on success
      } else {
        errors++;
        // Check for credits exhausted (402)
        const errorMsg = result.status === 'rejected'
          ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : '';
        if (errorMsg.includes('402') || errorMsg.includes('Credits') || errorMsg.includes('recharge')) {
          batchCreditsErrors++;
          consecutiveCreditsErrors++;
        } else if (errorMsg && !errorMsg.includes('not found')) {
          console.log(`\n   ⚠️ Error: ${errorMsg}`);
          consecutiveCreditsErrors = 0;
        } else {
          consecutiveCreditsErrors = 0;
        }
      }
    }

    // Abort early if credits are exhausted
    if (consecutiveCreditsErrors >= MAX_CONSECUTIVE_CREDITS_ERRORS) {
      console.log(`\n\n   🛑 API credits exhausted! Stopping build.`);
      console.log(`   Recharge credits and run with --resume to continue.`);
      abortedDueToCredits = true;

      // Save whatever we have in the buffer before exiting
      if (updateBuffer.length > 0) {
        await bulkUpdateFollowingIndex(updateBuffer);
        updateBuffer = [];
      }
      await updateSyncedCount(seedUsername, startIndex + processed);
      break;
    }

    // Progress update
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = processed / elapsed;
    const remaining = toProcess.length - processed;
    const eta = remaining / rate;
    const etaMin = Math.floor(eta / 60);
    const etaSec = Math.floor(eta % 60);

    process.stdout.write(
      `\r   [${startIndex + processed}/${followingList.length}] ` +
      `${rate.toFixed(1)}/sec | ` +
      `${totalFollowingsFetched.toLocaleString()} followings indexed | ` +
      `ETA: ${etaMin}m ${etaSec}s   `
    );

    // Bulk save to database
    if (updateBuffer.length >= BULK_SAVE_INTERVAL || i + CONCURRENCY >= toProcess.length) {
      if (updateBuffer.length > 0) {
        await bulkUpdateFollowingIndex(updateBuffer);
        await updateSyncedCount(seedUsername, startIndex + processed);
        updateBuffer = [];
      }
    }
  }

  console.log(`\n\n✅ Index build complete!`);
  console.log(`   Processed: ${processed} accounts`);
  console.log(`   Errors/Skipped: ${errors}`);
  console.log(`   Followings indexed: ${totalFollowingsFetched.toLocaleString()}`);
  console.log(`   Time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);

  const stats = await getIndexStats();
  console.log(`\n📊 Index Statistics:`);
  console.log(`   Total indexed accounts: ${stats.totalIndexedAccounts.toLocaleString()}`);
  console.log(`   Total seed users: ${stats.totalSeedUsers}`);
}

/**
 * Query command: Look up overlap for a username
 */
async function queryUsername(username: string): Promise<void> {
  console.log(`\n🔍 Querying overlap for @${username}...\n`);

  const result = await queryOverlap(username);

  if (!result) {
    console.log(`   ❌ No data found for @${username}`);
    console.log(`   This account may not be followed by any indexed important people.`);
    return;
  }

  console.log(`   @${result.username}`);
  console.log(`   User ID: ${result.user_id}`);
  console.log(`   Overlap Score: ${result.overlap_score}`);
  console.log(`\n   Followed by:`);

  // Show who follows this account
  const sortedFollowers = result.followed_by
    .slice()
    .sort((a, b) => a.username.localeCompare(b.username));

  for (const follower of sortedFollowers) {
    console.log(`     - @${follower.username} (${follower.name})`);
  }
}

/**
 * List seeds command: Show all indexed seed users
 */
async function listSeeds(): Promise<void> {
  console.log(`\n📋 Indexed Seed Users:\n`);

  const seeds = await listSeedUsers();

  if (seeds.length === 0) {
    console.log(`   No seed users have been indexed yet.`);
    console.log(`   Run: npx tsx scripts/network-overlap/index.ts build --seed <username>`);
    return;
  }

  for (const seed of seeds) {
    const syncPercent = seed.following_count > 0
      ? Math.round((seed.synced_count / seed.following_count) * 100)
      : 0;

    console.log(`   @${seed.username} (${seed.name})`);
    console.log(`     Following: ${seed.following_count}`);
    console.log(`     Synced: ${seed.synced_count} (${syncPercent}%)`);
    console.log(`     Created: ${seed.created_at.toISOString()}`);
    console.log(`     Updated: ${seed.updated_at.toISOString()}`);
    console.log('');
  }
}

/**
 * Top command: Show top accounts by overlap score
 */
async function showTop(limit: number = 50): Promise<void> {
  console.log(`\n🏆 Top ${limit} Accounts by Overlap Score:\n`);

  const results = await getTopOverlap(limit);

  if (results.length === 0) {
    console.log(`   No data in index yet.`);
    return;
  }

  // Print header
  console.log(`   ${'Rank'.padEnd(6)} ${'Username'.padEnd(20)} ${'Score'.padEnd(8)} Followed By`);
  console.log(`   ${'-'.repeat(6)} ${'-'.repeat(20)} ${'-'.repeat(8)} ${'-'.repeat(40)}`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = `#${i + 1}`.padEnd(6);
    const username = `@${r.username}`.padEnd(20);
    const score = r.overlap_score.toString().padEnd(8);
    const followers = r.followed_by
      .slice(0, 3)
      .map((f) => f.username)
      .join(', ');
    const more = r.followed_by.length > 3 ? ` +${r.followed_by.length - 3} more` : '';

    console.log(`   ${rank} ${username} ${score} ${followers}${more}`);
  }
}

/**
 * Stats command: Show index statistics
 */
async function showStats(): Promise<void> {
  console.log(`\n📊 Network Overlap Index Statistics:\n`);

  const stats = await getIndexStats();

  console.log(`   Total Indexed Accounts: ${stats.totalIndexedAccounts.toLocaleString()}`);
  console.log(`   Total Seed Users: ${stats.totalSeedUsers}`);

  // Also show seed user details
  const seeds = await listSeedUsers();
  if (seeds.length > 0) {
    console.log(`\n   Seed Users:`);
    for (const seed of seeds) {
      const syncPercent = seed.following_count > 0
        ? Math.round((seed.synced_count / seed.following_count) * 100)
        : 0;
      console.log(`     - @${seed.username}: ${seed.synced_count}/${seed.following_count} synced (${syncPercent}%)`);
    }
  }
}

/**
 * Show help
 */
function showHelp(): void {
  console.log(`
Network Overlap Tool

Given a seed user, this tool tells you: "For any Twitter account,
how many people that the seed user follows also follow that account?"

Commands:
  build --seed <username>      Build the index for a seed user
  build --seed <username> --resume   Resume a previous build
  query --username <username>  Query overlap for any account
  list-seeds                   List all indexed seed users
  top [--limit N]              Show top accounts by overlap score (default: 50)
  stats                        Show index statistics

Examples:
  npx tsx scripts/network-overlap/index.ts build --seed veeraj
  npx tsx scripts/network-overlap/index.ts query --username elonmusk
  npx tsx scripts/network-overlap/index.ts list-seeds
  npx tsx scripts/network-overlap/index.ts top --limit 100
  npx tsx scripts/network-overlap/index.ts stats
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  try {
    switch (args.command) {
      case 'build':
        if (!args.seed) {
          console.error('❌ Error: --seed <username> is required for build command');
          process.exit(1);
        }
        await buildIndex(args.seed, args.resume);
        break;

      case 'query':
        if (!args.username) {
          console.error('❌ Error: --username <username> is required for query command');
          process.exit(1);
        }
        await queryUsername(args.username);
        break;

      case 'list-seeds':
        await listSeeds();
        break;

      case 'top':
        await showTop(args.limit || 50);
        break;

      case 'stats':
        await showStats();
        break;

      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
