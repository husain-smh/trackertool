import { resolveTweetUrls } from './tweet-resolver';
import { getCampaignTweetsCollection, CampaignTweet } from '../models/socap/tweets';
import { getOrCreateWorkerState } from '../models/socap/worker-state';

type TweetCategory = 'main_twt' | 'influencer_twt' | 'investor_twt';

interface UrlEntry {
  url: string;
}

export interface SyncCampaignTweetsInput {
  campaignId: string;
  maintweets: UrlEntry[];
  influencer_twts: UrlEntry[];
  investor_twts: UrlEntry[];
}

/**
 * Sync campaign tweets (main/influencer/investor) by APPENDING from a set of URLs.
 *
 * - Adds new tweets (resolves URL → tweet_id, creates CampaignTweet + worker_state)
 * - If a tweet already exists for the campaign, we optionally update its category.
 * - We NEVER delete existing tweets, worker state, jobs, engagements, or snapshots here.
 *
 * This makes the edit-campaign flow safe even when URLs are edited or some lines are removed
 * in the UI: existing monitored tweets and their historical data are always preserved.
 */
export async function syncCampaignTweets(input: SyncCampaignTweetsInput): Promise<{
  added: number;
  removed: number;
  updatedCategory: number;
}> {
  const { campaignId, maintweets, influencer_twts, investor_twts } = input;

  // 1) Build desired map: tweet_url -> category (temporary, before resolving IDs)
  const desiredUrlMap = new Map<string, TweetCategory>();

  const addUrlsToMap = (entries: UrlEntry[], category: TweetCategory) => {
    for (const entry of entries) {
      const cleanUrl = entry.url?.trim();
      if (!cleanUrl) continue;
      desiredUrlMap.set(cleanUrl, category);
    }
  };

  addUrlsToMap(maintweets || [], 'main_twt');
  addUrlsToMap(influencer_twts || [], 'influencer_twt');
  addUrlsToMap(investor_twts || [], 'investor_twt');

  if (desiredUrlMap.size === 0) {
    throw new Error('At least one tweet URL is required when syncing campaign tweets');
  }

  const tweetCollection = await getCampaignTweetsCollection();

  // 2) Resolve all desired URLs to tweet IDs
  const desiredUrls = Array.from(desiredUrlMap.keys());
  const resolved = await resolveTweetUrls(desiredUrls);

  // Map of tweet_id -> { category, resolved data }
  const desiredById = new Map<
    string,
    {
      category: TweetCategory;
      resolved: (typeof resolved)[number];
    }
  >();

  for (const r of resolved) {
    const category = desiredUrlMap.get(r.tweet_url);
    if (!category) continue;
    desiredById.set(r.tweet_id, { category, resolved: r });
  }

  if (desiredById.size === 0) {
    throw new Error('None of the provided tweet URLs could be resolved');
  }

  // 3) Load current tweets for campaign and index by tweet_id
  const currentTweets = await tweetCollection
    .find({ campaign_id: campaignId })
    .toArray();

  const currentById = new Map<string, CampaignTweet>();
  for (const t of currentTweets) {
    currentById.set(t.tweet_id, t);
  }

  let added = 0;
  let updatedCategory = 0;
  
  // 4) Handle additions and category updates (by tweet_id) — APPEND-ONLY
  for (const [tweetId, { category, resolved: resolvedTweet }] of desiredById.entries()) {
    const existing = currentById.get(tweetId);

    if (!existing) {
      // New tweet: insert into socap_tweets
      const newTweet: Omit<CampaignTweet, '_id'> = {
        campaign_id: campaignId,
        tweet_id: resolvedTweet.tweet_id,
        tweet_url: resolvedTweet.tweet_url,
        text: resolvedTweet.text,
        category,
        author_name: resolvedTweet.author_name,
        author_username: resolvedTweet.author_username,
        metrics: {
          likeCount: 0,
          retweetCount: 0,
          quoteCount: 0,
          replyCount: 0,
          viewCount: 0,
          quoteViewsFromQuotes: 0,
          bookmarkCount: 0,
          last_updated: null,
        },
        created_at: new Date(),
      };

      await tweetCollection.insertOne(newTweet);
      const createdTweetId = resolvedTweet.tweet_id;

      // Create worker state rows for each job type so workers can pick this tweet up
      const jobTypes: Array<'retweets' | 'replies' | 'quotes' | 'metrics'> = [
        'retweets',
        'replies',
        'quotes',
        'metrics',
      ];

      for (const jobType of jobTypes) {
        await getOrCreateWorkerState({
          campaign_id: campaignId,
          tweet_id: createdTweetId,
          job_type: jobType,
        });
      }

      added += 1;
    } else if (existing.category !== category) {
      // Category changed: update in-place
      await tweetCollection.updateOne(
        { _id: (existing as any)._id },
        { $set: { category } }
      );
      updatedCategory += 1;
    }
  }

  return { added, removed: 0, updatedCategory };
}


