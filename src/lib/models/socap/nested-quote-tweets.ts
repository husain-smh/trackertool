import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';

export interface NestedQuoteTweet {
  _id?: string;
  campaign_id: string;
  parent_quote_tweet_id: string;
  parent_tweet_id?: string;
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
  created_at: Date;
  ingested_at: Date;
  last_seen_at: Date;
}

export interface NestedQuoteTweetInput {
  campaign_id: string;
  parent_quote_tweet_id: string;
  parent_tweet_id?: string;
  parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  quote_tweet_id: string;
  quote_tweet_url: string;
  text?: string;
  author: NestedQuoteTweet['author'];
  metrics: NestedQuoteTweet['metrics'];
  created_at: Date;
}

/**
 * Collection name requested by product: SOCAP_Nested_Qotes_Tweets
 * (note the intentional spelling per requirement).
 */
export async function getNestedQuoteTweetsCollection(): Promise<Collection<NestedQuoteTweet>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<NestedQuoteTweet>('SOCAP_Nested_Qotes_Tweets');
}

export async function createNestedQuoteTweetIndexes(): Promise<void> {
  const collection = await getNestedQuoteTweetsCollection();

  await collection.createIndex(
    { campaign_id: 1, parent_quote_tweet_id: 1, quote_tweet_id: 1 },
    { unique: true }
  );

  await collection.createIndex({ parent_quote_tweet_id: 1, created_at: -1 });
  await collection.createIndex({ 'author.user_id': 1, campaign_id: 1 });
}

export async function createOrUpdateNestedQuoteTweet(
  input: NestedQuoteTweetInput
): Promise<NestedQuoteTweet> {
  const collection = await getNestedQuoteTweetsCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    {
      campaign_id: input.campaign_id,
      parent_quote_tweet_id: input.parent_quote_tweet_id,
      quote_tweet_id: input.quote_tweet_id,
    },
    {
      $set: {
        campaign_id: input.campaign_id,
        parent_quote_tweet_id: input.parent_quote_tweet_id,
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

  return result as NestedQuoteTweet;
}

