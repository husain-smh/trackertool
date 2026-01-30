#!/usr/bin/env node

import 'dotenv/config';
import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';

/**
 * Auto Sync Following (Local Backend)
 *
 * Replacement for the N8N flow that calls twitterapi.io directly, paginates
 * through followings, cleans the data to match the prior N8N output, and posts
 * to our existing Next.js endpoint (/api/ranker/sync/following).
 *
 * Usage:
 *   npx tsx scripts/auto-sync-followers-local-backend.ts --username elonmusk
 *
 * Env:
 *   - TWITTER_API_KEY (required)
 *   - TWITTER_API_URL (optional, defaults via getTwitterApiConfig)
 *   - AUTO_SYNC_BASE_URL (optional, default: http://localhost:3000)
 *   - REQUEST_INTERVAL_MS (optional, default: 500)
 *   - MAX_REQUESTS (optional, default: 500)
 */

const BASE_URL = process.env.AUTO_SYNC_BASE_URL || 'http://localhost:3000';
const REQUEST_INTERVAL_MS = Number(process.env.REQUEST_INTERVAL_MS ?? 500);
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS ?? 500);
const MAX_RETRIES = 5;

function ts(): string {
  return new Date().toISOString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUsernameArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--username='));
  if (arg) return arg.split('=')[1];
  const idx = process.argv.findIndex((a) => a === '--username' || a === '-u');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

type FollowingsResponse = {
  followings?: any[];
  has_next_page?: boolean;
  next_cursor?: string | null;
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

      // Retry on 429/5xx
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

type CleanedFollowing = {
  user_id: string;
  username: string;
  name: string;
  screen_name?: string | null;
  followers_count?: number | null;
  description?: string | null;
  verified?: boolean | null;
};

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

async function main() {
  const username = parseUsernameArg();
  if (!username) {
    console.error('Usage: npx tsx scripts/auto-sync-followers-local-backend.ts --username <user>');
    process.exit(1);
  }

  console.log(`[${ts()}] 🚀 Auto Sync Following (Local Backend)`);
  console.log(`[${ts()}] Target username: @${username}`);
  console.log(`[${ts()}] Base URL: ${BASE_URL}`);
  console.log(`[${ts()}] Request interval: ${REQUEST_INTERVAL_MS}ms, Max requests: ${MAX_REQUESTS}`);

  try {
    // Fetch user info to ensure we have user_id for the important person
    const userInfo = await fetchUserInfo(username);
    console.log(`[${ts()}] ℹ️  User info: id=${userInfo.user_id}, name=${userInfo.name}`);

    // Fetch and clean followings
    const rawFollowings = await fetchFollowings(username);
    const cleanedFollowings = cleanFollowings(rawFollowings);

    console.log(
      `[${ts()}] 📊 Stats: raw=${rawFollowings.length}, deduped=${cleanedFollowings.length}`,
    );

    // Post to existing backend endpoint
    await postToBackend({
      username: userInfo.username,
      user_id: userInfo.user_id,
      following_list: cleanedFollowings,
    });

    console.log(`[${ts()}] 🏁 Done.`);
    process.exit(0);
  } catch (err) {
    console.error(`[${ts()}] ❌ Failed:`, err);
    process.exit(1);
  }
}

main();

