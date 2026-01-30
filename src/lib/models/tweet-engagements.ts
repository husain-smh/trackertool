import { Collection } from 'mongodb';
import { getDb } from '../mongodb-ranker';

export type TweetEngagementAction = 'retweet' | 'reply' | 'quote' | 'like';
export type SentimentLabel = 'positive' | 'neutral' | 'critical';

export interface TweetEngagement {
  _id?: unknown;
  tweet_id: string; // The original tweet being engaged with (the tweet we analyze)
  user_id: string; // Engager userId (string from API)
  action_type: TweetEngagementAction;

  /**
   * When available (quotes/replies), this is the actual engagement tweet id.
   * Retweets generally do not provide a distinct tweet id via twitterapi.io.
   */
  engagement_tweet_id?: string;
  engagement_tweet_url?: string;

  /**
   * When available (quotes/replies), this is what they wrote.
   * This is the critical field needed for SOCAP-style contextual LLM notifications.
   */
  text?: string;

  /**
   * When the engagement happened (quotes/replies have createdAt).
   * Retweets from twitterapi.io do not include a timestamp in our current integration.
   */
  timestamp?: Date;

  account_profile: {
    username: string;
    name: string;
    bio?: string;
    location?: string;
    followers: number;
    verified: boolean;
  };

  /**
   * Quote-specific metadata (if present).
   */
  quoted_tweet_id?: string;
  quote_view_count?: number;
  quote_metrics?: {
    viewCount?: number;
    likeCount?: number;
    retweetCount?: number;
    replyCount?: number;
    quoteCount?: number;
    bookmarkCount?: number;
  };

  /**
   * Optional LLM-generated copy for SOCAP-style notifications.
   * Stored on the engagement so the UI can show/refresh/edit/send to Slack.
   */
  llm_copy?: string;
  llm_sentiment?: SentimentLabel;
  llm_generated_at?: Date;

  last_seen_at: Date;
  created_at: Date;
}

export interface TweetEngagementInput {
  tweet_id: string;
  user_id: string;
  action_type: TweetEngagementAction;
  engagement_tweet_id?: string;
  engagement_tweet_url?: string;
  text?: string;
  timestamp?: Date;
  account_profile: TweetEngagement['account_profile'];
  quoted_tweet_id?: string;
  quote_view_count?: number;
  quote_metrics?: TweetEngagement['quote_metrics'];
}

export async function getTweetEngagementsCollection(): Promise<Collection<TweetEngagement>> {
  const db = await getDb();
  return db.collection<TweetEngagement>('tweet_engagements');
}

/**
 * Bulk upsert engagements. This mirrors SOCAP’s approach:
 * one record per (tweet_id, user_id, action_type), updated as we re-fetch.
 */
export async function upsertTweetEngagements(
  inputs: TweetEngagementInput[]
): Promise<{ upserted: number; modified: number }> {
  if (inputs.length === 0) return { upserted: 0, modified: 0 };

  const collection = await getTweetEngagementsCollection();
  const now = new Date();

  const ops = inputs.map((input) => {
    const setDoc: Partial<TweetEngagement> = {
      tweet_id: input.tweet_id,
      user_id: input.user_id,
      action_type: input.action_type,
      engagement_tweet_id: input.engagement_tweet_id,
      engagement_tweet_url: input.engagement_tweet_url,
      text: input.text,
      timestamp: input.timestamp,
      account_profile: input.account_profile,
      quoted_tweet_id: input.quoted_tweet_id,
      last_seen_at: now,
    };

    // Only set quote fields when provided (preserves any existing stored values).
    if (typeof input.quote_view_count === 'number') {
      setDoc.quote_view_count = input.quote_view_count;
    }
    if (input.quote_metrics) {
      setDoc.quote_metrics = input.quote_metrics;
    }

    return {
      updateOne: {
        filter: {
          tweet_id: input.tweet_id,
          user_id: input.user_id,
          action_type: input.action_type,
        },
        update: {
          $set: setDoc,
          $setOnInsert: {
            created_at: input.timestamp || now,
          },
        },
        upsert: true,
      },
    } as const;
  });

  const result = await collection.bulkWrite(ops, { ordered: false });
  return { upserted: result.upsertedCount || 0, modified: result.modifiedCount || 0 };
}

export async function getTweetEngagementsByUsers(
  tweetId: string,
  actionType: TweetEngagementAction,
  userIds: string[]
): Promise<TweetEngagement[]> {
  if (userIds.length === 0) return [];
  const collection = await getTweetEngagementsCollection();
  return collection
    .find({
      tweet_id: tweetId,
      action_type: actionType,
      user_id: { $in: userIds },
    })
    .toArray();
}

export async function updateTweetEngagementLlmFields(
  tweetId: string,
  userId: string,
  actionType: TweetEngagementAction,
  fields: Partial<Pick<TweetEngagement, 'llm_copy' | 'llm_sentiment' | 'llm_generated_at'>>
): Promise<boolean> {
  const collection = await getTweetEngagementsCollection();
  const res = await collection.updateOne(
    { tweet_id: tweetId, user_id: userId, action_type: actionType },
    {
      $set: {
        ...fields,
      },
    }
  );
  return res.modifiedCount > 0;
}


