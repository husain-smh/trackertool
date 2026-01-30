#!/usr/bin/env node

/**
 * Fetch all replies for each campaign tweet, with page-by-page logging
 * and ingestion into socap_replies + engagements.
 *
 * Usage:
 *   npx tsx scripts/fetch-replies-logged.ts --campaign <id> [--maxPages 60] [--intervalMs 500]
 *   (optional) --tweet <tweetId> to target a single parent tweet
 *   (optional) --category main|influencer|investor|all to filter parent tweets
 */

import 'dotenv/config';
import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';
import { makeApiRequest } from '../src/lib/twitter-api-client';
import { disconnect } from '../src/lib/mongodb';
import {
  CampaignTweet,
  getTweetByTweetId,
  getTweetsByCampaign,
  getTweetsByCampaignAndCategory,
} from '../src/lib/models/socap/tweets';
import { createOrUpdateEngagement } from '../src/lib/models/socap/engagements';
import { processEngagement } from '../src/lib/socap/engagement-processor';
import { createOrUpdateReply } from '../src/lib/models/socap/replies';

type Category = 'main_twt' | 'influencer_twt' | 'investor_twt' | 'all';

type ReplyHit = {
  engagementId: string;
  engagementText?: string;
  inReplyToTweetId?: string;
  metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };
  author: {
    userId: string;
    username: string | null;
    name: string | null;
    followers: number;
    verified: boolean;
    bio: string | null;
    location: string | null;
  };
  createdAt?: Date;
};

function ts(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArg(name: string, alias?: string): string | null {
  const byName = process.argv.find((a) => a.startsWith(`${name}=`));
  if (byName) return byName.split('=')[1];
  if (alias) {
    const idx = process.argv.findIndex((a) => a === name || a === alias);
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  }
  return null;
}

function parseCategory(): Category {
  const raw = parseArg('--category', '-c') || 'all';
  if (raw === 'main' || raw === 'main_twt') return 'main_twt';
  if (raw === 'influencer' || raw === 'influencer_twt') return 'influencer_twt';
  if (raw === 'investor' || raw === 'investor_twt') return 'investor_twt';
  return 'all';
}

function toInt(val: unknown): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function extractInReplyToTweetId(tweet: any): string | undefined {
  return (
    tweet?.inReplyToStatusId ||
    tweet?.inReplyToStatusIdStr ||
    tweet?.in_reply_to_status_id ||
    tweet?.in_reply_to_status_id_str ||
    tweet?.inReplyToTweetId ||
    tweet?.legacy?.in_reply_to_status_id ||
    tweet?.legacy?.in_reply_to_status_id_str
  );
}

function mapReply(tweet: any, parentTweetId: string): ReplyHit | null {
  if (!tweet?.author || !tweet.id) return null;

  const inReplyTo = extractInReplyToTweetId(tweet) || undefined;

  // Filter out accidental mismatches if upstream returns a different parent
  if (inReplyTo && inReplyTo !== parentTweetId) {
    return null;
  }

  const viewCountNum = toInt(tweet.viewCount);

  return {
    engagementId: tweet.id,
    engagementText: tweet.text || undefined,
    inReplyToTweetId: parentTweetId,
    metrics: {
      viewCount: viewCountNum,
      likeCount: toInt(tweet.likeCount),
      retweetCount: toInt(tweet.retweetCount),
      replyCount: toInt(tweet.replyCount),
      quoteCount: toInt(tweet.quoteCount),
      bookmarkCount: toInt(tweet.bookmarkCount),
    },
    author: {
      userId: tweet.author.id,
      username: tweet.author.userName || tweet.author.screen_name || null,
      name: tweet.author.name || null,
      followers: toInt(tweet.author.followers || tweet.author.followers_count) ?? 0,
      verified: Boolean(tweet.author.isBlueVerified ?? tweet.author.verified),
      bio: tweet.author.profile_bio?.description || null,
      location: tweet.author.location || null,
    },
    createdAt: tweet.createdAt ? new Date(tweet.createdAt) : undefined,
  };
}

async function fetchTweetRepliesLogged(options: {
  tweetId: string;
  maxPages: number;
  intervalMs: number;
  cursor?: string;
}): Promise<{ data: ReplyHit[]; nextCursor?: string; pagesFetched: number }> {
  const { tweetId, maxPages, intervalMs, cursor } = options;
  const config = getTwitterApiConfig();
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY not configured');
  }

  let currentCursor = cursor;
  let pagesFetched = 0;
  const collected: ReplyHit[] = [];

  while (pagesFetched < maxPages) {
    const pageNumber = pagesFetched + 1;
    const url = new URL(`${config.apiUrl}/twitter/tweet/replies`);
    url.searchParams.set('tweetId', tweetId);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    console.log(
      `[${ts()}] [replies] tweet=${tweetId} page=${pageNumber} cursor=${currentCursor ?? 'none'} START`
    );

    const data = await makeApiRequest(url.toString(), config);
    const replies = Array.isArray(data.replies) ? data.replies : Array.isArray(data.tweets) ? data.tweets : [];

    console.log(
      `[${ts()}] [replies] tweet=${tweetId} page=${pageNumber} received=${replies.length}`
    );

    const mapped: ReplyHit[] = [];

    for (const reply of replies) {
      const mappedItem = mapReply(reply, tweetId);
      if (mappedItem) {
        mapped.push(mappedItem);
      } else {
        console.log(
          `[${ts()}] [replies] tweet=${tweetId} page=${pageNumber} SKIP parentMismatch`
        );
      }
    }

    console.log(
      `[${ts()}] [replies] tweet=${tweetId} page=${pageNumber} accepted=${mapped.length}`
    );

    collected.push(...mapped);

    const nextCursor =
      data.next_cursor ??
      data.nextCursor ??
      data.meta?.next_token ??
      null;

    const hasNext =
      Boolean(nextCursor) &&
      replies.length > 0 &&
      pagesFetched + 1 < maxPages;

    if (!hasNext) {
      console.log(
        `[${ts()}] [replies] tweet=${tweetId} page=${pageNumber} STOP hasNext=${hasNext} nextCursor=${nextCursor ?? 'none'}`
      );
      return { data: collected, nextCursor: nextCursor || undefined, pagesFetched: pageNumber };
    }

    currentCursor = nextCursor || undefined;
    pagesFetched++;

    await sleep(intervalMs); // space out page requests
  }

  return { data: collected, nextCursor: currentCursor, pagesFetched };
}

async function loadParentTweets(
  campaignId: string,
  category: Category,
  specificTweetId?: string
): Promise<CampaignTweet[]> {
  if (specificTweetId) {
    const tweet = await getTweetByTweetId(specificTweetId);
    if (!tweet) throw new Error(`Tweet ${specificTweetId} not found`);
    if (tweet.campaign_id !== campaignId) {
      throw new Error(`Tweet ${specificTweetId} belongs to campaign ${tweet.campaign_id}, not ${campaignId}`);
    }
    if (category !== 'all' && tweet.category !== category) {
      console.warn(
        `[${ts()}] ⚠️ Tweet ${specificTweetId} category ${tweet.category} does not match filter ${category}, including anyway.`
      );
    }
    return [tweet];
  }

  if (category === 'all') {
    return getTweetsByCampaign(campaignId);
  }

  return getTweetsByCampaignAndCategory(campaignId, category);
}

async function main(): Promise<void> {
  const campaignId = parseArg('--campaign', '-C');
  if (!campaignId) {
    console.error(
      'Usage: npx tsx scripts/fetch-replies-logged.ts --campaign <id> [--category main|influencer|investor|all] [--tweet <tweetId>] [--maxPages N] [--intervalMs 500]'
    );
    process.exit(1);
  }

  const category = parseCategory();
  const tweetId = parseArg('--tweet', '-t') || undefined;
  const maxPages = Number(parseArg('--maxPages') ?? 60);
  const intervalMs = Number(parseArg('--intervalMs') ?? 500);

  console.log(`[${ts()}] 🚀 Fetch replies (logged)`);
  console.log(`[${ts()}] campaignId=${campaignId}, category=${category}, tweetId=${tweetId ?? 'all'}, maxPages=${maxPages}, intervalMs=${intervalMs}`);

  const parents = await loadParentTweets(campaignId, category, tweetId);
  if (parents.length === 0) {
    console.warn(`[${ts()}] No tweets found for the given filters.`);
    return;
  }

  for (const parent of parents) {
    const parentId = parent.tweet_id;
    console.log(`[${ts()}] ▶️ Parent tweet ${parentId} (${parent.category})`);

    const { data, pagesFetched, nextCursor } = await fetchTweetRepliesLogged({
      tweetId: parentId,
      maxPages,
      intervalMs,
    });

    console.log(
      `[${ts()}] ↳ fetched replies parent=${parentId} total=${data.length} pages=${pagesFetched} nextCursor=${nextCursor ?? 'none'}`
    );

    let saved = 0;
    for (const reply of data) {
      if (!reply.engagementId) continue;

      // Store engagement (same pipeline used elsewhere)
      const engagementInput = await processEngagement(
        campaignId,
        parentId,
        {
          userId: reply.author.userId,
          username: reply.author.username,
          name: reply.author.name,
          followers: reply.author.followers,
          verified: reply.author.verified,
          bio: reply.author.bio,
          location: reply.author.location,
          engagementId: reply.engagementId,
          engagementText: reply.engagementText,
          engagementCreatedAt: reply.createdAt,
        },
        'reply',
        reply.createdAt || new Date(),
        reply.engagementText
      );

      await createOrUpdateEngagement(engagementInput);

      await createOrUpdateReply({
        campaign_id: campaignId,
        parent_tweet_id: parentId,
        reply_tweet_id: reply.engagementId,
        reply_tweet_url: `https://twitter.com/i/web/status/${reply.engagementId}`,
        text: reply.engagementText,
        author: {
          user_id: reply.author.userId,
          username: reply.author.username || '',
          name: reply.author.name || '',
          bio: reply.author.bio || undefined,
          location: reply.author.location || undefined,
          followers: reply.author.followers,
          verified: reply.author.verified,
        },
        metrics: reply.metrics,
        created_at: reply.createdAt || new Date(),
      });

      saved += 1;
    }

    console.log(
      `[${ts()}] ✅ saved=${saved} replies for parent=${parentId}`
    );
  }

  console.log(`[${ts()}] 🏁 Done.`);
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`[${ts()}] ❌ Error`, err);
    await disconnect();
    process.exit(1);
  });


