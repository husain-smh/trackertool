import { Collection, ObjectId } from 'mongodb';
import { getClient } from '../../mongodb';

// ===== TypeScript Interfaces =====

export interface Campaign {
  _id?: string;
  launch_name: string;
  
  /**
   * Client identifier - used to link OAuth authorization to this campaign.
   * Typically the client's Twitter username (e.g., "johndoe").
   * This should match the `client` parameter used in the OAuth auth link.
   */
  client_id?: string;
  
  /**
   * Legacy client info. The email field is no longer actively used for OAuth.
   * @deprecated Use client_id instead for OAuth linking
   */
  client_info?: {
    name?: string;
    email?: string;
  };
  
  status: 'active' | 'paused' | 'completed';
  monitor_window: {
    start_date: Date;
    end_date: Date;
  };
  /**
   * Optional minimum date for chart displays. When set, time-series
   * queries should exclude data points before this timestamp.
   */
  chart_min_date?: Date;
  /**
   * Optional feature flags for advanced functionality.
   * All features are opt-in to maintain backward compatibility.
   */
  features?: {
    /**
     * Enable liking users tracking for main tweets.
     * Requires client to authorize their Twitter account via OAuth.
     * Only works for main tweets authored by the authenticated client.
     * Default: false
     */
    track_liking_users?: boolean;
  };
  alert_preferences: {
    importance_threshold: number;
    channels: string[]; // ['slack', 'email']
    frequency_window_minutes: number;
    alert_spacing_minutes: number; // default 20
  };
  created_at: Date;
  updated_at: Date;
}

export interface CreateCampaignInput {
  launch_name: string;
  
  /**
   * Client identifier - used to link OAuth authorization to this campaign.
   * Typically the client's Twitter username (e.g., "johndoe").
   */
  client_id?: string;
  
  /**
   * Legacy client info (optional)
   * @deprecated Use client_id instead
   */
  client_info?: {
    name?: string;
    email?: string;
  };
  
  maintweets: Array<{ url: string }>;
  influencer_twts: Array<{ url: string }>;
  investor_twts: Array<{ url: string }>;
  monitor_window: {
    start_date: string; // ISO string
    end_date: string; // ISO string
  };
  features?: {
    track_liking_users?: boolean;
  };
  alert_preferences: {
    importance_threshold: number;
    channels: string[];
    frequency_window_minutes?: number;
    alert_spacing_minutes?: number;
  };
}

// ===== Collection Getter =====

export async function getCampaignsCollection(): Promise<Collection<Campaign>> {
  const client = await getClient();
  const db = client.db();
  return db.collection<Campaign>('socap_campaigns');
}

// ===== Indexes =====

export async function createCampaignIndexes(): Promise<void> {
  const collection = await getCampaignsCollection();
  
  await collection.createIndex({ status: 1, 'monitor_window.end_date': 1 });
  await collection.createIndex({ created_at: -1 });
  await collection.createIndex({ client_id: 1 });
  // Legacy index - kept for backward compatibility
  await collection.createIndex({ 'client_info.email': 1 });
}

// ===== CRUD Operations =====

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
  const collection = await getCampaignsCollection();
  
  const campaign: Campaign = {
    launch_name: input.launch_name,
    client_id: input.client_id,
    client_info: input.client_info,
    status: 'active',
    monitor_window: {
      start_date: new Date(input.monitor_window.start_date),
      end_date: new Date(input.monitor_window.end_date),
    },
    features: input.features || {},
    alert_preferences: {
      importance_threshold: input.alert_preferences.importance_threshold,
      channels: input.alert_preferences.channels,
      frequency_window_minutes: input.alert_preferences.frequency_window_minutes || 30,
      alert_spacing_minutes: input.alert_preferences.alert_spacing_minutes || 20,
    },
    created_at: new Date(),
    updated_at: new Date(),
  };
  
  const result = await collection.insertOne(campaign);
  campaign._id = result.insertedId.toString();
  
  return campaign;
}

export async function getCampaignById(campaignId: string): Promise<Campaign | null> {
  const collection = await getCampaignsCollection();
  
  if (!ObjectId.isValid(campaignId)) {
    return null;
  }
  
  return await collection.findOne({ _id: new ObjectId(campaignId) } as any);
}

export async function getAllCampaigns(): Promise<Campaign[]> {
  const collection = await getCampaignsCollection();
  return await collection.find({}).sort({ created_at: -1 }).toArray();
}

export async function getActiveCampaigns(): Promise<Campaign[]> {
  const collection = await getCampaignsCollection();
  const now = new Date();
  
  return await collection.find({
    status: 'active',
    'monitor_window.start_date': { $lte: now },
    'monitor_window.end_date': { $gte: now },
  }).toArray();
}

export async function updateCampaignStatus(
  campaignId: string,
  status: Campaign['status']
): Promise<boolean> {
  const collection = await getCampaignsCollection();
  
  if (!ObjectId.isValid(campaignId)) {
    return false;
  }
  
  const result = await collection.updateOne(
    { _id: new ObjectId(campaignId) } as any,
    {
      $set: {
        status,
        updated_at: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

export async function updateCampaign(
  campaignId: string,
  updates: Partial<Campaign>
): Promise<boolean> {
  const collection = await getCampaignsCollection();
  
  if (!ObjectId.isValid(campaignId)) {
    return false;
  }
  
  const result = await collection.updateOne(
    { _id: new ObjectId(campaignId) } as any,
    {
      $set: {
        ...updates,
        updated_at: new Date(),
      },
    }
  );
  
  return result.modifiedCount > 0;
}

export async function deleteCampaign(campaignId: string): Promise<boolean> {
  const collection = await getCampaignsCollection();
  
  if (!ObjectId.isValid(campaignId)) {
    return false;
  }
  
  const result = await collection.deleteOne({ _id: new ObjectId(campaignId) } as any);
  return result.deletedCount > 0;
}

