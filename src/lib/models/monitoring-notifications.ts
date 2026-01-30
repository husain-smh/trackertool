import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-ranker';

// ===== TypeScript Interfaces =====

export type NotificationStatus = 'generated' | 'edited' | 'sent' | 'skipped';

export interface MonitoringNotification {
  _id?: ObjectId;
  tweet_id: string;
  engagement_id: string;        // Links to monitoring_engagements._id
  user_id: string;
  action_type: 'retweet' | 'reply' | 'quote' | 'like';

  // Notification content
  generated_text: string;       // LLM or template generated
  edited_text?: string;         // Creative director's edited version
  final_text?: string;          // What was actually sent

  // Status tracking
  status: NotificationStatus;

  // Metadata
  importance_score: number;
  engager_username: string;
  engager_name: string;
  engager_followers: number;

  // Timestamps
  generated_at: Date;
  edited_at?: Date;
  sent_at?: Date;
  sent_by?: string;             // Username of creative director who sent

  created_at: Date;
  updated_at: Date;
}

// ===== Collection Helpers =====

export async function getMonitoringNotificationsCollection(): Promise<Collection<MonitoringNotification>> {
  const db = await getDb();
  return db.collection<MonitoringNotification>('monitoring_notifications');
}

// ===== Database Operations =====

/**
 * Create a new notification draft
 */
export async function createNotification(
  notification: Omit<MonitoringNotification, '_id' | 'created_at' | 'updated_at' | 'generated_at'>
): Promise<MonitoringNotification> {
  const collection = await getMonitoringNotificationsCollection();
  const now = new Date();

  const doc: MonitoringNotification = {
    ...notification,
    generated_at: now,
    created_at: now,
    updated_at: now,
  };

  await collection.insertOne(doc);
  return doc;
}

/**
 * Check if notification already exists for this engagement
 */
export async function notificationExists(
  tweetId: string,
  userId: string,
  actionType: 'retweet' | 'reply' | 'quote' | 'like'
): Promise<boolean> {
  const collection = await getMonitoringNotificationsCollection();
  const count = await collection.countDocuments({
    tweet_id: tweetId,
    user_id: userId,
    action_type: actionType,
  });
  return count > 0;
}

/**
 * Bulk create notifications (skip if already exists)
 */
export async function bulkCreateNotifications(
  notifications: Array<Omit<MonitoringNotification, '_id' | 'created_at' | 'updated_at' | 'generated_at'>>
): Promise<{ created: number; skipped: number }> {
  if (notifications.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const collection = await getMonitoringNotificationsCollection();
  const now = new Date();

  let created = 0;
  let skipped = 0;

  // Check which ones already exist
  for (const notification of notifications) {
    const exists = await notificationExists(
      notification.tweet_id,
      notification.user_id,
      notification.action_type
    );

    if (exists) {
      skipped++;
      continue;
    }

    const doc: MonitoringNotification = {
      ...notification,
      generated_at: now,
      created_at: now,
      updated_at: now,
    };

    await collection.insertOne(doc);
    created++;
  }

  return { created, skipped };
}

/**
 * Get notifications for a tweet with optional status filter
 */
export async function getNotifications(
  tweetId: string,
  options: {
    status?: NotificationStatus | NotificationStatus[];
    limit?: number;
    skip?: number;
  } = {}
): Promise<{ notifications: MonitoringNotification[]; total: number }> {
  const collection = await getMonitoringNotificationsCollection();

  const filter: Record<string, any> = { tweet_id: tweetId };

  if (options.status) {
    if (Array.isArray(options.status)) {
      filter.status = { $in: options.status };
    } else {
      filter.status = options.status;
    }
  }

  const [notifications, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ importance_score: -1, generated_at: -1 })
      .skip(options.skip || 0)
      .limit(options.limit || 100)
      .toArray(),
    collection.countDocuments(filter),
  ]);

  return { notifications, total };
}

/**
 * Get notification by ID
 */
export async function getNotificationById(id: string): Promise<MonitoringNotification | null> {
  const collection = await getMonitoringNotificationsCollection();
  return collection.findOne({ _id: new ObjectId(id) });
}

/**
 * Update notification text (edit by creative director)
 */
export async function updateNotificationText(
  id: string,
  editedText: string
): Promise<MonitoringNotification | null> {
  const collection = await getMonitoringNotificationsCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        edited_text: editedText,
        status: 'edited' as NotificationStatus,
        edited_at: now,
        updated_at: now,
      },
    },
    { returnDocument: 'after' }
  );

  return result;
}

/**
 * Mark notification as sent
 */
export async function markNotificationSent(
  id: string,
  sentBy?: string
): Promise<MonitoringNotification | null> {
  const collection = await getMonitoringNotificationsCollection();
  const now = new Date();

  const notification = await getNotificationById(id);
  if (!notification) return null;

  // Use edited text if available, otherwise use generated text
  const finalText = notification.edited_text || notification.generated_text;

  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: 'sent' as NotificationStatus,
        final_text: finalText,
        sent_at: now,
        sent_by: sentBy,
        updated_at: now,
      },
    },
    { returnDocument: 'after' }
  );

  return result;
}

/**
 * Mark notification as skipped
 */
export async function markNotificationSkipped(id: string): Promise<MonitoringNotification | null> {
  const collection = await getMonitoringNotificationsCollection();
  const now = new Date();

  const result = await collection.findOneAndUpdate(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: 'skipped' as NotificationStatus,
        updated_at: now,
      },
    },
    { returnDocument: 'after' }
  );

  return result;
}

/**
 * Get notification stats for a tweet
 */
export async function getNotificationStats(tweetId: string): Promise<{
  total: number;
  generated: number;
  edited: number;
  sent: number;
  skipped: number;
}> {
  const collection = await getMonitoringNotificationsCollection();

  const [total, generated, edited, sent, skipped] = await Promise.all([
    collection.countDocuments({ tweet_id: tweetId }),
    collection.countDocuments({ tweet_id: tweetId, status: 'generated' }),
    collection.countDocuments({ tweet_id: tweetId, status: 'edited' }),
    collection.countDocuments({ tweet_id: tweetId, status: 'sent' }),
    collection.countDocuments({ tweet_id: tweetId, status: 'skipped' }),
  ]);

  return { total, generated, edited, sent, skipped };
}

/**
 * Get notifications ready to send (generated or edited, not sent/skipped)
 */
export async function getPendingNotifications(
  tweetId: string,
  limit?: number
): Promise<MonitoringNotification[]> {
  const collection = await getMonitoringNotificationsCollection();

  return collection
    .find({
      tweet_id: tweetId,
      status: { $in: ['generated', 'edited'] },
    })
    .sort({ importance_score: -1 })
    .limit(limit || 100)
    .toArray();
}

// ===== Index Creation =====

export async function createMonitoringNotificationsIndexes(): Promise<void> {
  const collection = await getMonitoringNotificationsCollection();

  // For querying by tweet and status
  await collection.createIndex({ tweet_id: 1, status: 1 });

  // For filtering generated vs sent
  await collection.createIndex({ status: 1, generated_at: -1 });

  // Unique compound index to prevent duplicates
  await collection.createIndex(
    { tweet_id: 1, user_id: 1, action_type: 1 },
    { unique: true }
  );

  console.log('Monitoring notifications indexes created');
}
