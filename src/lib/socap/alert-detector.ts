import { getEngagementsByCampaign } from '../models/socap/engagements';
import { getCampaignById, Campaign } from '../models/socap/campaigns';
import { checkRecentAlert } from '../models/socap/alert-history';
import { createAlert, updateAlertLlmFields } from '../models/socap/alert-queue';
import { getTweetByTweetId } from '../models/socap/tweets';
import { generateQuoteNotifications } from './quote-notification-generator';

/**
 * Backfill LLM-generated notifications for existing quote tweet alerts that don't have them yet.
 * This is useful when LLM generation is added to an existing campaign.
 */
export async function backfillQuoteNotifications(campaignId: string): Promise<{
  processed: number;
  generated: number;
  errors: number;
}> {
  const campaign = await getCampaignById(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }

  const { getAlertsByCampaign } = await import('../models/socap/alert-queue');
  const { getEngagementById } = await import('../models/socap/engagements');
  
  // Get all pending quote tweet alerts that don't have LLM copy yet
  const allAlerts = await getAlertsByCampaign(campaignId, { limit: 1000 });
  const quoteAlertsWithoutLlm = allAlerts.filter(
    (alert) => alert.action_type === 'quote' && !alert.llm_copy && alert.status === 'pending'
  );

  if (quoteAlertsWithoutLlm.length === 0) {
    return { processed: 0, generated: 0, errors: 0 };
  }

  // Group alerts by tweet_id and build contexts
  const quoteAlertContexts = new Map<string, QuoteAlertContext[]>();

  for (const alert of quoteAlertsWithoutLlm) {
    const engagement = await getEngagementById(alert.engagement_id);
    if (!engagement || engagement.action_type !== 'quote') {
      continue;
    }

    const tweetContexts = quoteAlertContexts.get(engagement.tweet_id) || [];
    const account = engagement.account_profile;
    tweetContexts.push({
      alertId: String(alert._id!),
      engagementId: String(engagement._id!),
      tweetId: engagement.tweet_id,
      importanceScore: engagement.importance_score,
      accountProfile: {
        username: account.username,
        name: account.name,
        followers: account.followers,
        verified: account.verified,
        bio: account.bio,
      },
      quoteText: engagement.text,
      timestamp: engagement.timestamp,
    });
    quoteAlertContexts.set(engagement.tweet_id, tweetContexts);
  }

  let generated = 0;
  let errors = 0;

  // Process each tweet's quote contexts
  for (const [tweetId, contexts] of quoteAlertContexts.entries()) {
    try {
      await processQuoteAlertContexts(campaign, tweetId, contexts);
      generated += contexts.length;
    } catch (error) {
      console.error(
        `[QuoteNotifications] Backfill failed for campaign ${campaignId} tweet ${tweetId}:`,
        error
      );
      errors += contexts.length;
    }
  }

  return {
    processed: quoteAlertsWithoutLlm.length,
    generated,
    errors,
  };
}

/**
 * Detect high-importance engagements and queue alerts
 */
export async function detectAndQueueAlerts(campaignId: string): Promise<number> {
  const campaign = await getCampaignById(campaignId);
  
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  
  // Get recent engagements (check all, deduplication handled by alert_history)
  const recentEngagements = await getEngagementsByCampaign(campaignId, {
    limit: 1000,
    sort: 'timestamp',
    min_importance: campaign.alert_preferences.importance_threshold,
  });
  
  // Filter to only new engagements since last check
  // For simplicity, we'll check all recent engagements
  // In production, you might want to track last check time
  
  // Get interval from database (system settings) or environment variable
  // This should match your N8N schedule interval
  const { getScheduleIntervalMinutes } = await import('../models/socap/system-settings');
  const scheduleIntervalMinutes = await getScheduleIntervalMinutes();
  const runBatch = getCurrentRunBatch(scheduleIntervalMinutes);
  // Default alert spacing: 80% of schedule interval (e.g., 4 min for 5-min interval, 16 min for 20-min interval)
  // This ensures alerts from one run are sent before the next run starts
  const defaultAlertSpacing = Math.max(2, Math.floor(scheduleIntervalMinutes * 0.8));
  const alertSpacingMinutes = campaign.alert_preferences.alert_spacing_minutes || defaultAlertSpacing;
  
  let alertsQueued = 0;
  const quoteAlertContexts = new Map<string, QuoteAlertContext[]>();
  
  for (const engagement of recentEngagements) {
    // Check if we've sent an alert for this user/action recently
    const recentAlert = await checkRecentAlert(
      campaignId,
      engagement.user_id,
      engagement.action_type,
      engagement.timestamp,
      campaign.alert_preferences.frequency_window_minutes || 30
    );
    
    if (recentAlert) {
      // Skip - already sent alert recently
      continue;
    }
    
    // Check if importance score meets threshold
    if (engagement.importance_score < campaign.alert_preferences.importance_threshold) {
      continue;
    }
    
    // Calculate scheduled send time (distribute over alert spacing window)
    const baseTime = new Date();
    const randomOffset = Math.random() * alertSpacingMinutes * 60 * 1000; // Random within window
    const scheduledSendTime = new Date(baseTime.getTime() + randomOffset);
    
    // Queue alert - normalize engagement_id to string to ensure
    // consistent deduplication and unique index behavior
    const alert = await createAlert({
      campaign_id: campaignId,
      engagement_id: String(engagement._id!),
      user_id: engagement.user_id,
      action_type: engagement.action_type,
      importance_score: engagement.importance_score,
      run_batch: runBatch,
      scheduled_send_time: scheduledSendTime,
    });
    
    alertsQueued++;

    // Only process quote alerts that don't already have LLM copy
    // This prevents duplicate GPT API calls when detectAndQueueAlerts
    // is called multiple times (e.g., after each engagement job)
    if (engagement.action_type === 'quote' && engagement._id && !alert.llm_copy) {
      const tweetContexts = quoteAlertContexts.get(engagement.tweet_id) || [];
      const account = engagement.account_profile;
      tweetContexts.push({
        alertId: String(alert._id!),
        engagementId: String(engagement._id),
        tweetId: engagement.tweet_id,
        importanceScore: engagement.importance_score,
        accountProfile: {
          username: account.username,
          name: account.name,
          followers: account.followers,
          verified: account.verified,
          bio: account.bio,
        },
        quoteText: engagement.text,
        timestamp: engagement.timestamp,
      });
      quoteAlertContexts.set(engagement.tweet_id, tweetContexts);
    }
  }

  for (const [tweetId, contexts] of quoteAlertContexts.entries()) {
    await processQuoteAlertContexts(campaign, tweetId, contexts);
  }
  
  return alertsQueued;
}

/**
 * Get current run batch identifier (rounded to interval)
 * Interval is configurable via System Settings UI (/socap/settings) or SOCAP_SCHEDULE_INTERVAL_MINUTES env var (default: 30 minutes)
 */
function getCurrentRunBatch(intervalMinutes: number = 30): string {
  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = Math.floor(minutes / intervalMinutes) * intervalMinutes;
  const rounded = new Date(now);
  rounded.setMinutes(roundedMinutes, 0, 0);
  return rounded.toISOString();
}

interface QuoteAlertContext {
  alertId: string;
  engagementId: string;
  tweetId: string;
  importanceScore: number;
  accountProfile: {
    username: string;
    name: string;
    followers: number;
    verified: boolean;
    bio?: string;
  };
  quoteText?: string;
  timestamp: Date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function processQuoteAlertContexts(
  campaign: Campaign,
  tweetId: string,
  contexts: QuoteAlertContext[]
): Promise<void> {
  if (contexts.length === 0) {
    return;
  }

  const tweet = await getTweetByTweetId(tweetId);
  if (!tweet) {
    return;
  }

  // Safety check: Filter out contexts where alerts already have LLM copy
  // This prevents duplicate GPT API calls if alerts somehow get into contexts with LLM copy
  const { getAlertQueueCollection } = await import('../models/socap/alert-queue');
  const { ObjectId } = await import('mongodb');
  const collection = await getAlertQueueCollection();
  
  // Fetch all alerts at once for efficiency
  const alertIds = contexts.map((ctx) => new ObjectId(ctx.alertId));
  const alerts = await collection
    .find({ _id: { $in: alertIds as any } })
    .toArray();
  
  const alertMap = new Map(alerts.map((a) => [String(a._id), a]));
  const contextsToProcess: QuoteAlertContext[] = [];
  
  for (const ctx of contexts) {
    const alert = alertMap.get(ctx.alertId);
    // Only process if alert exists and doesn't have LLM copy yet
    if (alert && !alert.llm_copy) {
      contextsToProcess.push(ctx);
    } else if (alert?.llm_copy) {
      console.log(
        `[QuoteNotifications] Skipping alert ${ctx.alertId} for engagement ${ctx.engagementId} - already has LLM copy`
      );
    }
  }

  if (contextsToProcess.length === 0) {
    return;
  }

  // Process all contexts together to give LLM full context, but ensure each gets unique notification
  // We can still batch them for efficiency, but each will get its own notification
  const chunks = chunk(contextsToProcess, 10); // Increased batch size since we're not combining

  // Track if we hit rate limit - if so, skip remaining chunks to avoid wasting time
  let rateLimitHit = false;

  for (const group of chunks) {
    // If we hit rate limit in previous chunk, skip remaining
    if (rateLimitHit) {
      console.warn(
        `[QuoteNotifications] Skipping remaining ${chunks.length - chunks.indexOf(group)} chunks for tweet ${tweetId} due to rate limit`
      );
      break;
    }

    const promptPayload = {
      campaignName: campaign.launch_name,
      mainTweet: {
        authorName: tweet.author_name,
        authorUsername: tweet.author_username,
        text: tweet.text,
        url: tweet.tweet_url,
      },
      quotes: group.map((ctx) => ({
        engagementId: ctx.engagementId,
        accountName: ctx.accountProfile.name || ctx.accountProfile.username,
        accountUsername: ctx.accountProfile.username,
        followers: ctx.accountProfile.followers,
        importanceScore: ctx.importanceScore,
        verified: ctx.accountProfile.verified,
        accountBio: ctx.accountProfile.bio,
        quoteText: ctx.quoteText,
        timestampISO: ctx.timestamp.toISOString(),
      })),
    };

    try {
      const suggestions = await generateQuoteNotifications(promptPayload);
      if (!suggestions.length) {
        continue;
      }

      const ctxByEngagement = new Map(group.map((ctx) => [ctx.engagementId, ctx]));

      // Process each suggestion - each should have exactly one engagement_id
      for (const suggestion of suggestions) {
        // Warn if LLM combined multiple engagements (shouldn't happen with new prompt)
        if (suggestion.engagementIds.length > 1) {
          console.warn(
            `[QuoteNotifications] LLM returned multiple engagement_ids in one notification for tweet ${tweetId}. This should not happen with the updated prompt.`
          );
        }

        // Each suggestion should now have exactly one engagement_id (no combining)
        for (const engagementId of suggestion.engagementIds) {
          const matchedContext = ctxByEngagement.get(engagementId);
          
          if (!matchedContext) {
            continue;
          }

          // Each engagement gets its own unique notification - no grouping
          await updateAlertLlmFields(matchedContext.alertId, {
            llm_copy: suggestion.notification,
            llm_sentiment: suggestion.sentiment,
            llm_group_parent_id: null,
            llm_generated_at: new Date(),
          });
        }
      }

      // Verify all engagements got notifications - if not, log warning
      const processedEngagementIds = new Set(
        suggestions.flatMap((s) => s.engagementIds)
      );
      const missingEngagements = group.filter(
        (ctx) => !processedEngagementIds.has(ctx.engagementId)
      );
      
      if (missingEngagements.length > 0) {
        console.warn(
          `[QuoteNotifications] ${missingEngagements.length} engagements did not receive notifications for tweet ${tweetId}`
        );
      }
    } catch (error: any) {
      // Check if this is a rate limit error
      if (error?.isRateLimit || (error?.status === 429) || (error?.code === 'rate_limit_exceeded')) {
        rateLimitHit = true;
        console.warn(
          `[QuoteNotifications] OpenAI rate limit hit for campaign ${campaign._id} tweet ${tweetId}. Skipping remaining quote notifications.`
        );
        // Don't throw - just skip remaining chunks
        break;
      }
      
      // For other errors, log but continue processing other chunks
      console.error(
        `[QuoteNotifications] Failed to generate notifications for campaign ${campaign._id} tweet ${tweetId}:`,
        error
      );
    }
  }
}

