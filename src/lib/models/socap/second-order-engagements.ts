import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';

export type SecondOrderActionType = 'retweet' | 'reply';

export interface SecondOrderEngagement {
  _id?: string;
  campaign_id: string;
  source_quote_tweet_id: string; // The quote tweet being engaged with
  parent_tweet_id?: string; // The main/influencer/investor tweet that was quoted
  parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  action_type: SecondOrderActionType;
  user_id: string;
  timestamp: Date;
  text?: string; // For replies when available
  engagement_tweet_id?: string; // Reply tweet id when provided
  engagement_tweet_url?: string;
  account_profile: {
    username: string;
    name: string;
    bio?: string;
    location?: string;
    followers: number;
    verified: boolean;
  };
  importance_score: number;
  account_categories: string[];
  last_seen_at: Date;
  created_at: Date;
}

export interface SecondOrderEngagementInput {
  campaign_id: string;
  source_quote_tweet_id: string;
  parent_tweet_id?: string;
  parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
  action_type: SecondOrderActionType;
  user_id: string;
  timestamp: Date;
  text?: string;
  engagement_tweet_id?: string;
  engagement_tweet_url?: string;
  account_profile: SecondOrderEngagement['account_profile'];
  importance_score: number;
  account_categories: string[];
}

export async function getSecondOrderEngagementsCollection(): Promise<Collection<SecondOrderEngagement>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<SecondOrderEngagement>('socap_second_order_engagements');
}

export async function createSecondOrderEngagementIndexes(): Promise<void> {
  const collection = await getSecondOrderEngagementsCollection();

  await collection.createIndex(
    { campaign_id: 1, source_quote_tweet_id: 1, user_id: 1, action_type: 1 },
    { unique: true }
  );
  await collection.createIndex({ campaign_id: 1, timestamp: -1 });
  await collection.createIndex({ campaign_id: 1, parent_category: 1, timestamp: -1 });
  await collection.createIndex({ campaign_id: 1, importance_score: -1 });
  await collection.createIndex({ user_id: 1, campaign_id: 1 });
  await collection.createIndex({ campaign_id: 1, action_type: 1, timestamp: -1 });
  await collection.createIndex({ campaign_id: 1, parent_category: 1, action_type: 1, timestamp: -1 });
}

export async function createOrUpdateSecondOrderEngagement(
  input: SecondOrderEngagementInput
): Promise<SecondOrderEngagement> {
  const collection = await getSecondOrderEngagementsCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    {
      campaign_id: input.campaign_id,
      source_quote_tweet_id: input.source_quote_tweet_id,
      user_id: input.user_id,
      action_type: input.action_type,
    },
    {
      $set: {
        source_quote_tweet_id: input.source_quote_tweet_id,
        parent_tweet_id: input.parent_tweet_id,
        parent_category: input.parent_category,
        action_type: input.action_type,
        user_id: input.user_id,
        timestamp: input.timestamp,
        text: input.text,
        engagement_tweet_id: input.engagement_tweet_id,
        engagement_tweet_url: input.engagement_tweet_url,
        account_profile: input.account_profile,
        importance_score: input.importance_score,
        account_categories: input.account_categories,
        last_seen_at: now,
      },
      $setOnInsert: {
        campaign_id: input.campaign_id,
        created_at: input.timestamp,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
    }
  );

  return result as SecondOrderEngagement;
}

export async function getSecondOrderEngagementsByCampaign(
  campaignId: string,
  options?: {
    action_type?: SecondOrderActionType;
    parent_category?: 'main_twt' | 'influencer_twt' | 'investor_twt';
    limit?: number;
    offset?: number;
    sort?: 'timestamp' | 'importance_score';
  }
): Promise<SecondOrderEngagement[]> {
  const collection = await getSecondOrderEngagementsCollection();

  const query: any = { campaign_id: campaignId };
  if (options?.action_type) query.action_type = options.action_type;
  if (options?.parent_category) query.parent_category = options.parent_category;

  const sortField = options?.sort === 'timestamp' ? 'timestamp' : 'importance_score';
  const cursor = collection.find(query).sort({ [sortField]: -1 });

  if (options?.offset) cursor.skip(options.offset);
  if (options?.limit) cursor.limit(options.limit);

  return cursor.toArray();
}

