#!/usr/bin/env node

import 'dotenv/config';
import { fetchTweetReplies, fetchTweetRetweets, FilteredUser } from '../src/lib/twitter-api-client';
import { getQuoteTweetsByCampaign } from '../src/lib/models/socap/quote-tweets';
import {
  createOrUpdateSecondOrderEngagement,
  createSecondOrderEngagementIndexes,
  SecondOrderActionType,
  SecondOrderEngagementInput,
} from '../src/lib/models/socap/second-order-engagements';
import { calculateImportanceScore, classifyAccount } from '../src/lib/socap/engagement-processor';
import { disconnect } from '../src/lib/mongodb';

const MAX_PAGES = Number(process.env.SECOND_ORDER_MAX_PAGES ?? 10);
const REQUEST_INTERVAL_MS = Number(process.env.SECOND_ORDER_REQUEST_INTERVAL_MS ?? 500);

function ts(): string {
  return new Date().toISOString();
}

function parseCampaignArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--campaign='));
  if (arg) return arg.split('=')[1];
  const idx = process.argv.findIndex((a) => a === '--campaign' || a === '-c');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function buildEngagementInput(
  campaignId: string,
  quote: {
    quote_tweet_id: string;
    parent_tweet_id?: string;
    parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  },
  user: FilteredUser,
  action: SecondOrderActionType,
  timestamp: Date,
  text?: string
): SecondOrderEngagementInput {
  const account_profile = {
    username: user.username || '',
    name: user.name || '',
    bio: user.bio || undefined,
    location: user.location || undefined,
    followers: user.followers,
    verified: user.verified,
  };

  return {
    campaign_id: campaignId,
    source_quote_tweet_id: quote.quote_tweet_id,
    parent_tweet_id: quote.parent_tweet_id,
    parent_category: quote.parent_category,
    action_type: action,
    user_id: user.userId,
    timestamp,
    text,
    engagement_tweet_id: user.engagementId,
    engagement_tweet_url: user.engagementId ? `https://twitter.com/i/web/status/${user.engagementId}` : undefined,
    account_profile,
    importance_score: 0, // populated after calculateImportanceScore
    account_categories: [], // populated after classifyAccount
  };
}

async function enrichEngagement(input: SecondOrderEngagementInput): Promise<SecondOrderEngagementInput> {
  const importanceScore = await calculateImportanceScore(input.user_id);
  const categories = classifyAccount({
    username: input.account_profile.username,
    name: input.account_profile.name,
    bio: input.account_profile.bio ?? null,
    location: input.account_profile.location ?? null,
    followers: input.account_profile.followers,
    verified: input.account_profile.verified,
  });

  return {
    ...input,
    importance_score: importanceScore,
    account_categories: categories,
  };
}

async function processQuoteTweet(campaignId: string, quote: any): Promise<void> {
  console.log(`[${ts()}] ▶️  Processing quote ${quote.quote_tweet_id} (parent ${quote.parent_tweet_id})`);

  const retweets = await fetchTweetRetweets(quote.quote_tweet_id, { maxPages: MAX_PAGES });
  let retweetCount = 0;
  for (const user of retweets.data) {
    const timestamp = user.engagementCreatedAt || new Date();
    const base = buildEngagementInput(campaignId, quote, user, 'retweet', timestamp);
    const enriched = await enrichEngagement(base);
    await createOrUpdateSecondOrderEngagement(enriched);
    retweetCount++;
  }

  const replies = await fetchTweetReplies(quote.quote_tweet_id, {
    maxPages: MAX_PAGES,
    requestIntervalMs: REQUEST_INTERVAL_MS,
  });
  let replyCount = 0;
  for (const user of replies.data) {
    const timestamp = user.engagementCreatedAt || new Date();
    const base = buildEngagementInput(campaignId, quote, user, 'reply', timestamp, user.engagementText);
    const enriched = await enrichEngagement(base);
    await createOrUpdateSecondOrderEngagement(enriched);
    replyCount++;
  }

  console.log(
    `[${ts()}] ✅ Completed quote ${quote.quote_tweet_id}: ${retweetCount} retweets, ${replyCount} replies`
  );
}

async function main(): Promise<void> {
  const campaignId = parseCampaignArg();
  if (!campaignId) {
    console.error('Usage: npx tsx scripts/populate-second-order-engagements.ts --campaign <campaign_id>');
    process.exit(1);
  }

  console.log(`[${ts()}] 🏁 Starting second-order ingestion for campaign ${campaignId}`);
  await createSecondOrderEngagementIndexes();

  const quotes = await getQuoteTweetsByCampaign(campaignId);
  console.log(`[${ts()}] Found ${quotes.length} quote tweets for campaign ${campaignId}`);

  for (const quote of quotes) {
    await processQuoteTweet(campaignId, quote);
  }

  console.log(`[${ts()}] 🎉 Done processing campaign ${campaignId}`);
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`[${ts()}] ❌ Error:`, err);
    await disconnect();
    process.exit(1);
  });

