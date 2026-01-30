#!/usr/bin/env node

/**
 * Fetch all quote tweets for each parent quote tweet in a campaign,
 * with page-by-page logging and ingestion into SOCAP_Nested_Qotes_Tweets.
 *
 * Usage:
 *   npx tsx scripts/fetch-nested-quotes-logged.ts --campaign <id> [--maxPages 60] [--intervalMs 500]
 *   (optional) --parent <quoteTweetId> to target a single parent quote tweet
 */

import 'dotenv/config';
import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';
import { makeApiRequest } from '../src/lib/twitter-api-client';
import { disconnect } from '../src/lib/mongodb';
import {
  getQuoteTweetsByCampaign,
  QuoteTweet,
} from '../src/lib/models/socap/quote-tweets';
import { createOrUpdateNestedQuoteTweet } from '../src/lib/models/socap/nested-quote-tweets';

type QuoteHit = {
  engagementId: string;
  engagementText?: string;
  quotedTweetId?: string;
  quoteViewCount?: number;
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

function toInt(val: unknown): number | undefined {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function extractQuotedTweetId(qt: any): string | undefined {
  if (typeof qt?.quoted_tweet === 'string') {
    return qt.quoted_tweet;
  }
  return (
    qt?.quoted_tweet?.id ||
    qt?.quotedTweet?.id ||
    qt?.quoted_tweet?.id_str ||
    qt?.quotedTweet?.id_str ||
    qt?.quoted_status_id ||
    qt?.quoted_status_id_str ||
    qt?.legacy?.quoted_status_id ||
    qt?.legacy?.quoted_status_id_str
  );
}

function mapQuoteTweet(qt: any, quotedTweetId?: string): QuoteHit | null {
  if (!qt?.author || !qt.id) return null;

  const viewCountNum = toInt(qt.viewCount) ?? 0;

  return {
    engagementId: qt.id,
    engagementText: qt.text || undefined,
    quotedTweetId,
    quoteViewCount: viewCountNum,
    metrics: {
      viewCount: viewCountNum,
      likeCount: toInt(qt.likeCount),
      retweetCount: toInt(qt.retweetCount),
      replyCount: toInt(qt.replyCount),
      quoteCount: toInt(qt.quoteCount),
      bookmarkCount: toInt(qt.bookmarkCount),
    },
    author: {
      userId: qt.author.id,
      username: qt.author.userName || qt.author.screen_name || null,
      name: qt.author.name || null,
      followers: toInt(qt.author.followers || qt.author.followers_count) ?? 0,
      verified: Boolean(qt.author.isBlueVerified ?? qt.author.verified),
      bio: qt.author.profile_bio?.description || null,
      location: qt.author.location || null,
    },
    createdAt: qt.createdAt ? new Date(qt.createdAt) : undefined,
  };
}

async function fetchTweetQuotesLogged(options: {
  tweetId: string;
  maxPages: number;
  intervalMs: number;
  cursor?: string;
}): Promise<{ data: QuoteHit[]; nextCursor?: string; pagesFetched: number }> {
  const { tweetId, maxPages, intervalMs, cursor } = options;
  const config = getTwitterApiConfig();
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY not configured');
  }

  let currentCursor = cursor;
  let pagesFetched = 0;
  const collected: QuoteHit[] = [];

  while (pagesFetched < maxPages) {
    const pageNumber = pagesFetched + 1;
    const url = new URL(`${config.apiUrl}/twitter/tweet/quotes`);
    url.searchParams.set('tweetId', tweetId);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    console.log(
      `[${ts()}] [quotes] tweet=${tweetId} page=${pageNumber} cursor=${currentCursor ?? 'none'} START`
    );

    const data = await makeApiRequest(url.toString(), config);
    const tweets = Array.isArray(data.tweets) ? data.tweets : [];

    console.log(
      `[${ts()}] [quotes] tweet=${tweetId} page=${pageNumber} received=${tweets.length}`
    );

    const mapped: QuoteHit[] = [];

    for (const qt of tweets) {
      const quotedId = extractQuotedTweetId(qt);
      if (quotedId && quotedId !== tweetId) {
        console.log(
          `[${ts()}] [quotes] tweet=${tweetId} page=${pageNumber} SKIP quotedIdMismatch quotedId=${quotedId}`
        );
        continue;
      }
      const mappedItem = mapQuoteTweet(qt, quotedId);
      if (mappedItem) {
        mapped.push(mappedItem);
      }
    }

    console.log(
      `[${ts()}] [quotes] tweet=${tweetId} page=${pageNumber} accepted=${mapped.length}`
    );

    collected.push(...mapped);

    const nextCursor =
      data.next_cursor ??
      data.nextCursor ??
      data.meta?.next_token ??
      null;

    const hasNext =
      Boolean(nextCursor) &&
      tweets.length > 0 &&
      pagesFetched + 1 < maxPages;

    if (!hasNext) {
      console.log(
        `[${ts()}] [quotes] tweet=${tweetId} page=${pageNumber} STOP hasNext=${hasNext} nextCursor=${nextCursor ?? 'none'}`
      );
      return { data: collected, nextCursor: nextCursor || undefined, pagesFetched: pageNumber };
    }

    currentCursor = nextCursor || undefined;
    pagesFetched++;

    await sleep(intervalMs); // 0.5s gap between pages
  }

  return { data: collected, nextCursor: currentCursor, pagesFetched };
}

async function loadParentQuoteTweets(
  campaignId: string,
  specificParentId?: string
): Promise<QuoteTweet[]> {
  const quotes = await getQuoteTweetsByCampaign(campaignId);
  if (!specificParentId) return quotes;
  return quotes.filter((q) => q.quote_tweet_id === specificParentId);
}

async function main(): Promise<void> {
  const campaignId = parseArg('--campaign', '-C');
  if (!campaignId) {
    console.error(
      'Usage: npx tsx scripts/fetch-nested-quotes-logged.ts --campaign <id> [--maxPages 60] [--intervalMs 500] [--parent <quoteTweetId>]'
    );
    process.exit(1);
  }

  const parentId = parseArg('--parent');
  const maxPages = Number(parseArg('--maxPages') ?? 60);
  const intervalMs = Number(parseArg('--intervalMs') ?? 500);

  console.log(
    `[${ts()}] 🚀 Fetch nested quotes (logged) campaign=${campaignId} parent=${parentId ?? 'all'} maxPages=${maxPages} intervalMs=${intervalMs}`
  );

  const parents = await loadParentQuoteTweets(campaignId, parentId || undefined);
  if (parents.length === 0) {
    console.warn(`[${ts()}] No parent quote tweets found for campaign/filters.`);
    return;
  }

  for (const parent of parents) {
    const tweetId = parent.quote_tweet_id;
    console.log(
      `[${ts()}] ▶️ Parent quote tweet ${tweetId} (parent_tweet_id=${parent.parent_tweet_id})`
    );

    const { data, pagesFetched, nextCursor } = await fetchTweetQuotesLogged({
      tweetId,
      maxPages,
      intervalMs,
    });

    console.log(
      `[${ts()}] ↳ fetched quotes parent=${tweetId} total=${data.length} pages=${pagesFetched} nextCursor=${nextCursor ?? 'none'}`
    );

    let saved = 0;
    for (const q of data) {
      if (!q.engagementId) continue;

      await createOrUpdateNestedQuoteTweet({
        campaign_id: campaignId,
        parent_quote_tweet_id: tweetId,
        parent_tweet_id: parent.parent_tweet_id,
        parent_category: parent.parent_category,
        quote_tweet_id: q.engagementId,
        quote_tweet_url: `https://twitter.com/i/web/status/${q.engagementId}`,
        text: q.engagementText,
        author: {
          user_id: q.author.userId,
          username: q.author.username || '',
          name: q.author.name || '',
          bio: q.author.bio || undefined,
          location: q.author.location || undefined,
          followers: q.author.followers,
          verified: q.author.verified,
        },
        metrics: q.metrics || { viewCount: q.quoteViewCount },
        created_at: q.createdAt || new Date(),
      });
      saved += 1;
    }

    console.log(
      `[${ts()}] ✅ saved=${saved} nested quotes for parent=${tweetId}`
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

