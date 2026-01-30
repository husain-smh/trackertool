#!/usr/bin/env node

import 'dotenv/config';
import { fetchTweetQuotes } from '../src/lib/twitter-api-client';
import {
  getTweetsByCampaign,
  getTweetsByCampaignAndCategory,
  getTweetByTweetId,
  updateTweetQuoteViewsFromQuotes,
  CampaignTweet,
} from '../src/lib/models/socap/tweets';
import { processEngagement } from '../src/lib/socap/engagement-processor';
import { createOrUpdateEngagement } from '../src/lib/models/socap/engagements';
import { createOrUpdateQuoteTweet } from '../src/lib/models/socap/quote-tweets';
import { disconnect } from '../src/lib/mongodb';

type Category = 'main_twt' | 'influencer_twt' | 'investor_twt' | 'all';

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

function parseCategory(): Category {
  const raw = parseArg('--category', '-c') || 'all';
  if (raw === 'main' || raw === 'main_twt') return 'main_twt';
  if (raw === 'influencer' || raw === 'influencer_twt') return 'influencer_twt';
  if (raw === 'investor' || raw === 'investor_twt') return 'investor_twt';
  return 'all';
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
      throw new Error(
        `Tweet ${specificTweetId} belongs to campaign ${tweet.campaign_id}, not ${campaignId}`
      );
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

type Totals = {
  views: number;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
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
  acc.views += metrics.viewCount ?? 0;
  acc.likes += metrics.likeCount ?? 0;
  acc.retweets += metrics.retweetCount ?? 0;
  acc.replies += metrics.replyCount ?? 0;
  acc.quotes += metrics.quoteCount ?? 0;
  acc.bookmarks += metrics.bookmarkCount ?? 0;
}

async function processParentTweet(options: {
  campaignId: string;
  tweet: CampaignTweet;
  maxPages: number;
  intervalMs: number;
}): Promise<Totals> {
  const { campaignId, tweet, maxPages, intervalMs } = options;
  console.log(
    `[${ts()}] ▶️  Fetching quotes for tweet ${tweet.tweet_id} (${tweet.category})`
  );

  const response = await fetchTweetQuotes(tweet.tweet_id, {
    maxPages,
    requestIntervalMs: intervalMs,
  });

  const totals: Totals = { views: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };

  for (const user of response.data) {
    // Optional safety filter: ensure this quote actually targets the parent tweet
    if (user.quotedTweetId && user.quotedTweetId !== tweet.tweet_id) {
      continue;
    }

    const timestamp = user.engagementCreatedAt || new Date();
    const engagementInput = await processEngagement(
      campaignId,
      tweet.tweet_id,
      user,
      'quote',
      timestamp,
      user.engagementText
    );

    if (typeof user.quoteViewCount === 'number' && !Number.isNaN(user.quoteViewCount)) {
      (engagementInput as any).quote_view_count = user.quoteViewCount;
    }

    if (user.quoteMetrics) {
      (engagementInput as any).quote_metrics = user.quoteMetrics;
    }

    if (user.engagementId) {
      (engagementInput as any).engagement_tweet_url = `https://twitter.com/i/web/status/${user.engagementId}`;
    }

    await createOrUpdateEngagement(engagementInput);

    // Also store as a first-class quote tweet document
    if (user.engagementId) {
      await createOrUpdateQuoteTweet({
        campaign_id: campaignId,
        parent_tweet_id: tweet.tweet_id,
        parent_category: tweet.category,
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
        metrics: user.quoteMetrics || { viewCount: user.quoteViewCount },
        created_at: user.engagementCreatedAt || new Date(),
      });
    }

    addTotals(totals, user.quoteMetrics || { viewCount: user.quoteViewCount });
  }

  // Replace parent totals with the fresh sum (not additive)
  await updateTweetQuoteViewsFromQuotes(tweet.tweet_id, totals.views);

  console.log(
    `[${ts()}] ✅ Completed ${tweet.tweet_id}: quotes=${response.data.length}, views=${totals.views.toLocaleString()}`
  );

  return totals;
}

async function main(): Promise<void> {
  const campaignId = parseArg('--campaign', '-C');
  if (!campaignId) {
    console.error('Usage: npx tsx scripts/aggregate-quote-metrics.ts --campaign <id> [--category main|influencer|investor|all] [--tweet <tweetId>] [--maxPages N] [--intervalMs 500]');
    process.exit(1);
  }

  const category = parseCategory();
  const tweetId = parseArg('--tweet', '-t') || undefined;
  const maxPages = Number(parseArg('--maxPages') ?? MAX_PAGES_DEFAULT);
  const intervalMs = Number(parseArg('--intervalMs') ?? REQUEST_INTERVAL_MS_DEFAULT);

  console.log(`[${ts()}] 🚀 Aggregate Quote Metrics`);
  console.log(`[${ts()}] campaignId=${campaignId}, category=${category}, tweetId=${tweetId ?? 'all'}, maxPages=${maxPages}, intervalMs=${intervalMs}`);

  const parents = await loadParentTweets(campaignId, category, tweetId);
  if (parents.length === 0) {
    console.warn(`[${ts()}] No tweets found for the given filters.`);
    return;
  }

  const runTotals: Totals = { views: 0, likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };

  for (const parent of parents) {
    const totals = await processParentTweet({ campaignId, tweet: parent, maxPages, intervalMs });
    runTotals.views += totals.views;
    runTotals.likes += totals.likes;
    runTotals.retweets += totals.retweets;
    runTotals.replies += totals.replies;
    runTotals.quotes += totals.quotes;
    runTotals.bookmarks += totals.bookmarks;
  }

  console.log(
    `[${ts()}] 🏁 Done. Parents=${parents.length}, total quote views=${runTotals.views.toLocaleString()}`
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

