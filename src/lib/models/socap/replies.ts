import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';

export interface Reply {
  _id?: string;
  campaign_id: string;
  parent_tweet_id: string;
  reply_tweet_id: string;
  reply_tweet_url: string;
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
  metrics?: {
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

export interface ReplyInput {
  campaign_id: string;
  parent_tweet_id: string;
  reply_tweet_id: string;
  reply_tweet_url: string;
  text?: string;
  author: Reply['author'];
  metrics?: Reply['metrics'];
  created_at: Date;
}

export async function getRepliesCollection(): Promise<Collection<Reply>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<Reply>('socap_replies');
}

export async function createReplyIndexes(): Promise<void> {
  const collection = await getRepliesCollection();

  await collection.createIndex(
    { campaign_id: 1, parent_tweet_id: 1, reply_tweet_id: 1 },
    { unique: true }
  );

  await collection.createIndex({ parent_tweet_id: 1, created_at: -1 });
  await collection.createIndex({ 'author.user_id': 1, campaign_id: 1 });
}

export async function createOrUpdateReply(input: ReplyInput): Promise<Reply> {
  const collection = await getRepliesCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    {
      campaign_id: input.campaign_id,
      parent_tweet_id: input.parent_tweet_id,
      reply_tweet_id: input.reply_tweet_id,
    },
    {
      $set: {
        campaign_id: input.campaign_id,
        parent_tweet_id: input.parent_tweet_id,
        reply_tweet_id: input.reply_tweet_id,
        reply_tweet_url: input.reply_tweet_url,
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

  return result as Reply;
}


