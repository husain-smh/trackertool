import { Collection } from 'mongodb';
import clientPromise from '../../mongodb';
import { roundToHour } from './utils';

// ===== TypeScript Interfaces =====

export interface AlertHistory {
  _id?: string;
  campaign_id: string;
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';
  timestamp_hour: Date; // Rounded to hour for deduplication
  sent_at: Date;
  channel: 'slack' | 'email';
}

export interface CreateAlertHistoryInput {
  campaign_id: string;
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';
  timestamp_hour: Date;
  sent_at: Date;
  channel: 'slack' | 'email';
}

// ===== Collection Getter =====

export async function getAlertHistoryCollection(): Promise<Collection<AlertHistory>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<AlertHistory>('socap_alert_history');
}

// ===== Indexes =====

export async function createAlertHistoryIndexes(): Promise<void> {
  const collection = await getAlertHistoryCollection();
  
  // Unique index prevents duplicate sends
  await collection.createIndex(
    { campaign_id: 1, user_id: 1, action_type: 1, timestamp_hour: 1 },
    { unique: true }
  );
  
  await collection.createIndex({ campaign_id: 1, sent_at: -1 });
  await collection.createIndex({ user_id: 1 });
}

// ===== Helper Functions =====

// roundToHour is imported from ./utils
export { roundToHour };

// ===== CRUD Operations =====

export async function createAlertHistory(input: CreateAlertHistoryInput): Promise<AlertHistory> {
  const collection = await getAlertHistoryCollection();
  
  const history: AlertHistory = {
    ...input,
  };
  
  const result = await collection.insertOne(history);
  history._id = result.insertedId.toString();
  
  return history;
}

export async function checkRecentAlert(
  campaignId: string,
  userId: string,
  actionType: 'retweet' | 'reply' | 'quote' | 'like',
  timestamp: Date,
  frequencyWindowMinutes: number
): Promise<boolean> {
  const collection = await getAlertHistoryCollection();
  
  const windowStart = new Date(timestamp.getTime() - frequencyWindowMinutes * 60 * 1000);
  
  const existing = await collection.findOne({
    campaign_id: campaignId,
    user_id: userId,
    action_type: actionType,
    sent_at: { $gte: windowStart },
  });
  
  return existing !== null; // Returns true if alert was sent recently
}

export async function getAlertHistoryByCampaign(
  campaignId: string,
  limit: number = 100
): Promise<AlertHistory[]> {
  const collection = await getAlertHistoryCollection();
  
  return await collection
    .find({ campaign_id: campaignId })
    .sort({ sent_at: -1 })
    .limit(limit)
    .toArray();
}

