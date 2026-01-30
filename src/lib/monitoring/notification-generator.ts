/**
 * Notification Generator - Generates notification drafts for engagements
 * Uses LLM for contextual copy on quotes/replies
 * Uses templates for retweets/likes
 */

import OpenAI from 'openai';
import { MonitoringEngagement } from '../models/monitoring-engagements';

export interface TweetContext {
  tweetId: string;
  tweetUrl: string;
  authorUsername?: string;
  tweetText?: string;
}

export interface NotificationDraft {
  generatedText: string;
  sentiment?: 'positive' | 'neutral' | 'critical';
}

const openAiKey = process.env.OPENAIAPIKEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

/**
 * Generate notification for a retweet (template-based)
 */
function generateRetweetNotification(
  engager: MonitoringEngagement,
  context: TweetContext
): NotificationDraft {
  const name = engager.name || engager.username;
  const username = engager.username;
  const followers = engager.followers.toLocaleString();
  const score = engager.importance_score;

  const text = [
    `Retweet: *${name}* (@${username}) retweeted your tweet`,
    `${followers} followers | Importance: ${score}`,
    context.tweetUrl,
  ].join('\n');

  return { generatedText: text, sentiment: 'positive' };
}

/**
 * Generate notification for a like (template-based)
 */
function generateLikeNotification(
  engager: MonitoringEngagement,
  context: TweetContext
): NotificationDraft {
  const name = engager.name || engager.username;
  const username = engager.username;
  const followers = engager.followers.toLocaleString();
  const score = engager.importance_score;

  const text = [
    `Like: *${name}* (@${username}) liked your tweet`,
    `${followers} followers | Importance: ${score}`,
    context.tweetUrl,
  ].join('\n');

  return { generatedText: text, sentiment: 'positive' };
}

/**
 * Generate notification for a reply using LLM
 */
async function generateReplyNotification(
  engager: MonitoringEngagement,
  context: TweetContext
): Promise<NotificationDraft> {
  const name = engager.name || engager.username;
  const username = engager.username;
  const followers = engager.followers.toLocaleString();
  const score = engager.importance_score;
  const replyText = engager.engagement_text?.slice(0, 280) || '';
  const engagementUrl = engager.engagement_url || context.tweetUrl;

  // If no OpenAI or no reply text, use template
  if (!openai || !replyText) {
    const text = [
      `Reply: *${name}* (@${username}) replied to your tweet`,
      `${followers} followers | Importance: ${score}`,
      engagementUrl,
    ].join('\n');

    return { generatedText: text, sentiment: 'neutral' };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You write brief Slack notifications about Twitter replies. Keep notifications under 200 characters for the main message. Be concise and Twitter-native. Return JSON only.`,
        },
        {
          role: 'user',
          content: `Generate a notification for this reply:

Replier: ${name} (@${username})
Followers: ${followers}
Importance Score: ${score}
Reply Text: "${replyText}"

Return JSON: {"notification": "...", "sentiment": "positive|neutral|critical"}

The notification should mention what they said briefly. End with the engagement URL.
Engagement URL: ${engagementUrl}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content?.trim() || '';
    const parsed = JSON.parse(raw) as { notification?: string; sentiment?: string };

    if (parsed.notification) {
      return {
        generatedText: parsed.notification,
        sentiment: (parsed.sentiment as 'positive' | 'neutral' | 'critical') || 'neutral',
      };
    }
  } catch (e) {
    console.error('[notification-generator] LLM error for reply:', e);
  }

  // Fallback to template
  const snippet = replyText.length > 100 ? replyText.slice(0, 97) + '...' : replyText;
  const text = [
    `Reply: *${name}* (@${username}) replied to your tweet`,
    `"${snippet}"`,
    `${followers} followers | Importance: ${score}`,
    engagementUrl,
  ].join('\n');

  return { generatedText: text, sentiment: 'neutral' };
}

/**
 * Generate notification for a quote using LLM
 */
async function generateQuoteNotification(
  engager: MonitoringEngagement,
  context: TweetContext
): Promise<NotificationDraft> {
  const name = engager.name || engager.username;
  const username = engager.username;
  const followers = engager.followers.toLocaleString();
  const score = engager.importance_score;
  const quoteText = engager.engagement_text?.slice(0, 280) || '';
  const engagementUrl = engager.engagement_url || context.tweetUrl;
  const quoteViews = engager.quote_metrics?.viewCount?.toLocaleString() || 'N/A';

  // If no OpenAI or no quote text, use template
  if (!openai || !quoteText) {
    const text = [
      `Quote: *${name}* (@${username}) quoted your tweet`,
      `${followers} followers | ${quoteViews} views on quote`,
      engagementUrl,
    ].join('\n');

    return { generatedText: text, sentiment: 'neutral' };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You write brief Slack notifications about Twitter quote tweets. Keep notifications under 200 characters for the main message. Be concise and Twitter-native. Return JSON only.`,
        },
        {
          role: 'user',
          content: `Generate a notification for this quote tweet:

Quoter: ${name} (@${username})
Followers: ${followers}
Quote Views: ${quoteViews}
Importance Score: ${score}
Quote Text: "${quoteText}"

Return JSON: {"notification": "...", "sentiment": "positive|neutral|critical"}

The notification should mention what they said briefly. End with the engagement URL.
Engagement URL: ${engagementUrl}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0].message.content?.trim() || '';
    const parsed = JSON.parse(raw) as { notification?: string; sentiment?: string };

    if (parsed.notification) {
      return {
        generatedText: parsed.notification,
        sentiment: (parsed.sentiment as 'positive' | 'neutral' | 'critical') || 'neutral',
      };
    }
  } catch (e) {
    console.error('[notification-generator] LLM error for quote:', e);
  }

  // Fallback to template
  const snippet = quoteText.length > 100 ? quoteText.slice(0, 97) + '...' : quoteText;
  const text = [
    `Quote: *${name}* (@${username}) quoted your tweet`,
    `"${snippet}"`,
    `${followers} followers | ${quoteViews} views on quote`,
    engagementUrl,
  ].join('\n');

  return { generatedText: text, sentiment: 'neutral' };
}

/**
 * Generate notification draft for an engagement
 */
export async function generateNotificationDraft(
  engager: MonitoringEngagement,
  context: TweetContext
): Promise<NotificationDraft> {
  switch (engager.action_type) {
    case 'retweet':
      return generateRetweetNotification(engager, context);
    case 'like':
      return generateLikeNotification(engager, context);
    case 'reply':
      return generateReplyNotification(engager, context);
    case 'quote':
      return generateQuoteNotification(engager, context);
    default:
      throw new Error(`Unknown action type: ${engager.action_type}`);
  }
}

/**
 * Generate notification drafts for multiple engagements
 */
export async function generateNotificationDrafts(
  engagers: MonitoringEngagement[],
  context: TweetContext
): Promise<Map<string, NotificationDraft>> {
  const results = new Map<string, NotificationDraft>();

  // Process in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < engagers.length; i += batchSize) {
    const batch = engagers.slice(i, i + batchSize);
    const promises = batch.map(async (engager) => {
      try {
        const draft = await generateNotificationDraft(engager, context);
        return { id: engager._id?.toString() || `${engager.user_id}-${engager.action_type}`, draft };
      } catch (e) {
        console.error(`[notification-generator] Error generating for ${engager.username}:`, e);
        return null;
      }
    });

    const batchResults = await Promise.all(promises);
    for (const result of batchResults) {
      if (result) {
        results.set(result.id, result.draft);
      }
    }
  }

  return results;
}
