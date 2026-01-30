import { Collection, ObjectId } from 'mongodb';
import { getDb } from '../mongodb-ranker';

// ===== TypeScript Interfaces =====

export interface ManagedClient {
  _id?: ObjectId;
  x_username: string;         // unique, no @
  display_name?: string;
  x_user_id?: string;
  auto_analyze: boolean;       // default true
  monitoring_enabled: boolean; // default true
  added_at: Date;
  last_known_tweet_id?: string;   // cache: latest tweet ID seen
  last_checked_at?: Date;         // when we last polled
}

// ===== Collection Helpers =====

export async function getClientsCollection(): Promise<Collection<ManagedClient>> {
  const db = await getDb();
  return db.collection<ManagedClient>('managed_clients');
}

// ===== Database Operations =====

export async function addClient(
  x_username: string,
  options?: { display_name?: string; x_user_id?: string; last_known_tweet_id?: string }
): Promise<ManagedClient> {
  const collection = await getClientsCollection();

  const client: ManagedClient = {
    x_username: x_username.replace(/^@/, '').toLowerCase(),
    display_name: options?.display_name,
    x_user_id: options?.x_user_id,
    auto_analyze: true,
    monitoring_enabled: true,
    added_at: new Date(),
    last_known_tweet_id: options?.last_known_tweet_id,
  };

  await collection.insertOne(client);
  return client;
}

export async function getAllClients(): Promise<ManagedClient[]> {
  const collection = await getClientsCollection();
  return await collection.find({}).sort({ added_at: -1 }).toArray();
}

export async function getClient(x_username: string): Promise<ManagedClient | null> {
  const collection = await getClientsCollection();
  return await collection.findOne({ x_username: x_username.replace(/^@/, '').toLowerCase() });
}

export async function getMonitoringEnabledClients(): Promise<ManagedClient[]> {
  const collection = await getClientsCollection();
  return await collection.find({ monitoring_enabled: true }).toArray();
}

export async function removeClient(x_username: string): Promise<boolean> {
  const collection = await getClientsCollection();
  const result = await collection.deleteOne({ x_username: x_username.replace(/^@/, '').toLowerCase() });
  return result.deletedCount === 1;
}

export async function updateClient(
  x_username: string,
  updates: Partial<Pick<ManagedClient, 'display_name' | 'auto_analyze' | 'monitoring_enabled' | 'x_user_id'>>
): Promise<boolean> {
  const collection = await getClientsCollection();
  const result = await collection.updateOne(
    { x_username: x_username.replace(/^@/, '').toLowerCase() },
    { $set: updates }
  );
  return result.matchedCount === 1;
}

export async function updateLastKnownTweet(
  x_username: string,
  tweetId: string
): Promise<void> {
  const collection = await getClientsCollection();
  await collection.updateOne(
    { x_username: x_username.replace(/^@/, '').toLowerCase() },
    { $set: { last_known_tweet_id: tweetId, last_checked_at: new Date() } }
  );
}

export async function updateLastChecked(x_username: string): Promise<void> {
  const collection = await getClientsCollection();
  await collection.updateOne(
    { x_username: x_username.replace(/^@/, '').toLowerCase() },
    { $set: { last_checked_at: new Date() } }
  );
}

// ===== Index Creation =====

export async function createClientIndexes(): Promise<void> {
  const collection = await getClientsCollection();
  await collection.createIndex({ x_username: 1 }, { unique: true });
  await collection.createIndex({ monitoring_enabled: 1 });
  console.log('✅ Managed client indexes created');
}
