import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';

export interface QuoteTweet {
  _id?: string;
  campaign_id: string;
  parent_tweet_id: string;
  parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  quote_tweet_id: string;
  quote_tweet_url: string;
  text?: string;
  author: {
    user_id: string;
    username: string;
    name: string;
    bio?: string;
    location?: string;
    followers: number;
    verified: boolean;
  };
  metrics: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };
  /**
   * Metrics aggregated from quotes-of-this-quote. Kept separate from the tweet's
   * own metrics to avoid overwriting the source values.
   */
  nested_metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
    last_updated: Date;
  };
  created_at: Date; // when the quote tweet was posted
  ingested_at: Date; // when we first saw it
  last_seen_at: Date; // last time we refreshed it
}

export interface QuoteTweetInput {
  campaign_id: string;
  parent_tweet_id: string;
  parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  quote_tweet_id: string;
  quote_tweet_url: string;
  text?: string;
  author: QuoteTweet['author'];
  metrics: QuoteTweet['metrics'];
  created_at: Date;
}

export async function getQuoteTweetsCollection(): Promise<Collection<QuoteTweet>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<QuoteTweet>('socap_quote_tweets');
}

export async function createQuoteTweetIndexes(): Promise<void> {
  const collection = await getQuoteTweetsCollection();

  // One document per quote tweet per campaign/parent.
  await collection.createIndex(
    { campaign_id: 1, parent_tweet_id: 1, quote_tweet_id: 1 },
    { unique: true }
  );

  await collection.createIndex({ parent_tweet_id: 1, created_at: -1 });
  await collection.createIndex({ 'author.user_id': 1, campaign_id: 1 });
  await collection.createIndex({ campaign_id: 1, parent_category: 1, created_at: 1 });
  await collection.createIndex({ campaign_id: 1, parent_category: 1, ingested_at: 1 });
}

export async function createOrUpdateQuoteTweet(input: QuoteTweetInput): Promise<QuoteTweet> {
  const collection = await getQuoteTweetsCollection();

  const now = new Date();

  const result = await collection.findOneAndUpdate(
    {
      campaign_id: input.campaign_id,
      parent_tweet_id: input.parent_tweet_id,
      quote_tweet_id: input.quote_tweet_id,
    },
    {
      $set: {
        campaign_id: input.campaign_id,
        parent_tweet_id: input.parent_tweet_id,
        parent_category: input.parent_category,
        quote_tweet_id: input.quote_tweet_id,
        quote_tweet_url: input.quote_tweet_url,
        text: input.text,
        author: input.author,
        metrics: input.metrics,
        created_at: input.created_at,
        last_seen_at: now,
      },
      $setOnInsert: {
        ingested_at: now,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );

  return result as QuoteTweet;
}

export async function getQuoteTweetsByCampaign(campaignId: string): Promise<QuoteTweet[]> {
  const collection = await getQuoteTweetsCollection();
  return collection.find({ campaign_id: campaignId }).toArray();
}

export async function updateQuoteTweetNestedMetrics(
  campaignId: string,
  quoteTweetId: string,
  nestedMetrics: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  }
): Promise<boolean> {
  const collection = await getQuoteTweetsCollection();
  const now = new Date();

  const result = await collection.updateOne(
    { campaign_id: campaignId, quote_tweet_id: quoteTweetId },
    {
      $set: {
        nested_metrics: {
          ...nestedMetrics,
          last_updated: now,
        },
        last_seen_at: now,
      },
    }
  );

  return result.modifiedCount > 0;
}

