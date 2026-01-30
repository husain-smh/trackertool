#!/usr/bin/env node

import 'dotenv/config';
import { fetchTweetQuotes } from '../src/lib/twitter-api-client';
import {
  getQuoteTweetsByCampaign,
  updateQuoteTweetNestedMetrics,
  QuoteTweet,
} from '../src/lib/models/socap/quote-tweets';
import { createOrUpdateNestedQuoteTweet } from '../src/lib/models/socap/nested-quote-tweets';
import { disconnect } from '../src/lib/mongodb';

const REQUEST_INTERVAL_MS_DEFAULT = Number(process.env.REQUEST_INTERVAL_MS ?? 500);
const MAX_PAGES_DEFAULT = Number(process.env.MAX_PAGES ?? 60);

function ts(): string {
  return new Date().toISOString();
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

async function loadParentQuoteTweets(
  campaignId: string,
  specificQuoteTweetId?: string
): Promise<QuoteTweet[]> {
  const quotes = await getQuoteTweetsByCampaign(campaignId);
  if (!specificQuoteTweetId) return quotes;

  const match = quotes.filter((q) => q.quote_tweet_id === specificQuoteTweetId);
  if (match.length === 0) {
    throw new Error(`Quote tweet ${specificQuoteTweetId} not found in campaign ${campaignId}`);
  }
  return match;
}

type Totals = {
  viewCount: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
};

function addTotals(
  acc: Totals,
  metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  }
): void {
  if (!metrics) return;
  acc.viewCount += metrics.viewCount ?? 0;
  acc.likeCount += metrics.likeCount ?? 0;
  acc.retweetCount += metrics.retweetCount ?? 0;
  acc.replyCount += metrics.replyCount ?? 0;
  acc.quoteCount += metrics.quoteCount ?? 0;
  acc.bookmarkCount += metrics.bookmarkCount ?? 0;
}

async function processParentQuoteTweet(options: {
  campaignId: string;
  quoteTweet: QuoteTweet;
  maxPages: number;
  intervalMs: number;
}): Promise<Totals> {
  const { campaignId, quoteTweet, maxPages, intervalMs } = options;
  console.log(
    `[${ts()}] ▶️  Fetching quotes-of-quote for ${quoteTweet.quote_tweet_id} (parent ${quoteTweet.parent_tweet_id})`
  );

  const response = await fetchTweetQuotes(quoteTweet.quote_tweet_id, {
    maxPages,
    requestIntervalMs: intervalMs,
  });

  const totals: Totals = {
    viewCount: 0,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    bookmarkCount: 0,
  };

  for (const user of response.data) {
    // Strict safety filter: only accept quotes that explicitly target this parent quote.
    // If quotedTweetId is missing or mismatched, skip to avoid cross-linking unrelated quotes.
    if (!user.quotedTweetId || user.quotedTweetId !== quoteTweet.quote_tweet_id) {
      continue;
    }

    if (!user.engagementId) {
      continue;
    }

    const metrics = user.quoteMetrics || { viewCount: user.quoteViewCount };

    await createOrUpdateNestedQuoteTweet({
      campaign_id: campaignId,
      parent_quote_tweet_id: quoteTweet.quote_tweet_id,
      parent_tweet_id: quoteTweet.parent_tweet_id,
      parent_category: quoteTweet.parent_category,
      quote_tweet_id: user.engagementId,
      quote_tweet_url: `https://twitter.com/i/web/status/${user.engagementId}`,
      text: user.engagementText,
      author: {
        user_id: user.userId,
        username: user.username || '',
        name: user.name || '',
        bio: user.bio || undefined,
        location: user.location || undefined,
        followers: user.followers,
        verified: user.verified,
      },
      metrics,
      created_at: user.engagementCreatedAt || new Date(),
    });

    addTotals(totals, metrics);
  }

  await updateQuoteTweetNestedMetrics(campaignId, quoteTweet.quote_tweet_id, totals);

  console.log(
    `[${ts()}] ✅ Completed ${quoteTweet.quote_tweet_id}: nested quotes=${response.data.length}, nested views=${totals.viewCount.toLocaleString()}`
  );

  return totals;
}

async function main(): Promise<void> {
  const campaignId = parseArg('--campaign', '-C');
  if (!campaignId) {
    console.error(
      'Usage: npx tsx scripts/aggregate-nested-quote-metrics.ts --campaign <id> [--quote <quoteTweetId>] [--maxPages N] [--intervalMs 500]'
    );
    process.exit(1);
  }

  const quoteTweetId = parseArg('--quote', '-q') || undefined;
  const maxPages = Number(parseArg('--maxPages') ?? MAX_PAGES_DEFAULT);
  const intervalMs = Number(parseArg('--intervalMs') ?? REQUEST_INTERVAL_MS_DEFAULT);

  console.log(`[${ts()}] 🚀 Aggregate Nested Quote Metrics`);
  console.log(
    `[${ts()}] campaignId=${campaignId}, quoteTweetId=${quoteTweetId ?? 'all'}, maxPages=${maxPages}, intervalMs=${intervalMs}`
  );

  const parents = await loadParentQuoteTweets(campaignId, quoteTweetId);
  if (parents.length === 0) {
    console.warn(`[${ts()}] No quote tweets found for the given filters.`);
    return;
  }

  const runTotals: Totals = {
    viewCount: 0,
    likeCount: 0,
    retweetCount: 0,
    replyCount: 0,
    quoteCount: 0,
    bookmarkCount: 0,
  };

  for (const parent of parents) {
    const totals = await processParentQuoteTweet({
      campaignId,
      quoteTweet: parent,
      maxPages,
      intervalMs,
    });
    runTotals.viewCount += totals.viewCount;
    runTotals.likeCount += totals.likeCount;
    runTotals.retweetCount += totals.retweetCount;
    runTotals.replyCount += totals.replyCount;
    runTotals.quoteCount += totals.quoteCount;
    runTotals.bookmarkCount += totals.bookmarkCount;
  }

  console.log(
    `[${ts()}] 🏁 Done. Parents=${parents.length}, total nested quote views=${runTotals.viewCount.toLocaleString()}`
  );
}

main()
  .then(async () => {
    // Gracefully close MongoDB connection so the process can exit
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`[${ts()}] ❌ Error`, err);
    await disconnect();
    process.exit(1);
  });

