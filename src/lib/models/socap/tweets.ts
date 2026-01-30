import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';

// ===== TypeScript Interfaces =====

export interface CampaignTweet {
  _id?: string;
  campaign_id: string;
  tweet_id: string;
  tweet_url: string;
  text?: string;
  category: 'main_twt' | 'influencer_twt' | 'investor_twt';
  author_name: string;
  author_username: string;
  metrics: {
    likeCount: number;
    retweetCount: number;
    quoteCount: number;
    replyCount: number;
    viewCount: number;
    /**
     * Total views accumulated from all quote tweets of this tweet
     * (sum of viewCount of each quote tweet fetched via quotes endpoint)
     */
    quoteViewsFromQuotes: number;
    bookmarkCount: number;
    last_updated: Date | null;
  };
  created_at: Date;
}

export interface TweetMetrics {
  likeCount: number;
  retweetCount: number;
  quoteCount: number;
  replyCount: number;
  viewCount: number;
  bookmarkCount: number;
}

// ===== Collection Getter =====

export async function getCampaignTweetsCollection(): Promise<Collection<CampaignTweet>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<CampaignTweet>('socap_tweets');
}

// ===== Indexes =====

export async function createTweetIndexes(): Promise<void> {
  const collection = await getCampaignTweetsCollection();
  
  await collection.createIndex({ campaign_id: 1 });

  // Allow the same tweet to be monitored across multiple campaigns,
  // but prevent duplicate tweet_id entries within the *same* campaign.
  await collection.createIndex(
    { campaign_id: 1, tweet_id: 1 },
    { unique: true }
  );

  await collection.createIndex({ campaign_id: 1, category: 1 });
  await collection.createIndex({ campaign_id: 1, category: 1, author_username: 1 });
}

// ===== CRUD Operations =====

export async function createCampaignTweet(
  campaignId: string,
  tweetId: string,
  tweetUrl: string,
  category: CampaignTweet['category'],
  authorName: string,
  authorUsername: string,
  text?: string
): Promise<CampaignTweet> {
  const collection = await getCampaignTweetsCollection();
  
  const tweet: CampaignTweet = {
    campaign_id: campaignId,
    tweet_id: tweetId,
    tweet_url: tweetUrl,
    text,
    category,
    author_name: authorName,
    author_username: authorUsername,
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
  
  const result = await collection.insertOne(tweet);
  tweet._id = result.insertedId.toString();
  
  return tweet;
}

export async function getTweetByTweetId(tweetId: string): Promise<CampaignTweet | null> {
  const collection = await getCampaignTweetsCollection();
  return await collection.findOne({ tweet_id: tweetId });
}

export async function getTweetsByCampaign(campaignId: string): Promise<CampaignTweet[]> {
  const collection = await getCampaignTweetsCollection();
  return await collection.find({ campaign_id: campaignId }).toArray();
}

export async function getTweetsByCampaignAndCategory(
  campaignId: string,
  category: CampaignTweet['category']
): Promise<CampaignTweet[]> {
  const collection = await getCampaignTweetsCollection();
  return await collection.find({ campaign_id: campaignId, category }).toArray();
}

export async function updateTweetMetrics(
  tweetId: string,
  metrics: TweetMetrics
): Promise<boolean> {
  const collection = await getCampaignTweetsCollection();
  
  const result = await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        'metrics.likeCount': metrics.likeCount,
        'metrics.retweetCount': metrics.retweetCount,
        'metrics.quoteCount': metrics.quoteCount,
        'metrics.replyCount': metrics.replyCount,
        'metrics.viewCount': metrics.viewCount,
        'metrics.bookmarkCount': metrics.bookmarkCount,
        'metrics.last_updated': new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

export async function getTweetMetrics(tweetId: string): Promise<TweetMetrics | null> {
  const tweet = await getTweetByTweetId(tweetId);
  if (!tweet) return null;

  const metrics = tweet.metrics;

  // Backward compatibility: older documents might not have quoteViewsFromQuotes
  if (typeof (metrics as any).quoteViewsFromQuotes !== 'number') {
    (metrics as any).quoteViewsFromQuotes = 0;
  }

  return metrics;
}

/**
 * Update only the quoteViewsFromQuotes metric for a tweet.
 * This is used by the QuotesWorker after processing quote tweets.
 */
export async function updateTweetQuoteViewsFromQuotes(
  tweetId: string,
  quoteViewsFromQuotes: number
): Promise<boolean> {
  const collection = await getCampaignTweetsCollection();

  const result = await collection.updateOne(
    { tweet_id: tweetId },
    {
      $set: {
        'metrics.quoteViewsFromQuotes': quoteViewsFromQuotes,
        'metrics.last_updated': new Date(),
      },
    }
  );

  return result.modifiedCount > 0;
}

