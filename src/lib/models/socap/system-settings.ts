import { Collection, ObjectId } from 'mongodb';
import clientPromise from '../../mongodb';

export interface SystemSettings {
  _id?: string | ObjectId;
  schedule_interval_minutes: number; // Global schedule interval (e.g., 5, 30)
  updated_at: Date;
  updated_by?: string;
}

// Use a fixed ObjectId for the single settings document
const SETTINGS_DOC_ID = new ObjectId('000000000000000000000001');

export async function getSystemSettingsCollection(): Promise<Collection<SystemSettings>> {
  const client = await clientPromise;
  const db = client.db();
  return db.collection<SystemSettings>('socap_system_settings');
}

/**
 * Get current system settings
 * Falls back to environment variable if not set in DB
 */
export async function getSystemSettings(): Promise<SystemSettings> {
  const collection = await getSystemSettingsCollection();
  
  const settings = await collection.findOne({ _id: SETTINGS_DOC_ID });
  
  if (!settings) {
    // Return defaults from env var (but don't save to DB yet - will be created on first update)
    const defaultInterval = parseInt(
      process.env.SOCAP_SCHEDULE_INTERVAL_MINUTES || '30',
      10
    );
    
    return {
      _id: SETTINGS_DOC_ID.toString(),
      schedule_interval_minutes: defaultInterval,
      updated_at: new Date(),
    };
  }
  
  // Convert ObjectId to string for consistency
  return {
    ...settings,
    _id: settings._id?.toString(),
  };
}

/**
 * Update system settings
 */
export async function updateSystemSettings(
  updates: Partial<Omit<SystemSettings, '_id' | 'updated_at'>>
): Promise<boolean> {
  const collection = await getSystemSettingsCollection();
  
  const result = await collection.updateOne(
    { _id: SETTINGS_DOC_ID },
    {
      $set: {
        ...updates,
        updated_at: new Date(),
      },
      $setOnInsert: {
        _id: SETTINGS_DOC_ID,
      },
    },
    { upsert: true }
  );
  
  return result.modifiedCount > 0 || result.upsertedCount > 0;
}

/**
 * Get schedule interval (from DB or env var)
 */
export async function getScheduleIntervalMinutes(): Promise<number> {
  const settings = await getSystemSettings();
  return settings.schedule_interval_minutes;
}

