import { NextRequest, NextResponse } from 'next/server';
import { getTweet } from '@/lib/models/tweets';
import { sendSlackWebhook } from '@/lib/slack-webhook';

type TargetChannel = 'creative' | 'client';

function resolveSlackBotToken(): string | null {
  // Support multiple env var names so local setup is painless.
  // Prefer explicit Slack names, but fall back to the user's current `bot_token`.
  return (
    process.env.IL_SLACK_BOT_TOKEN ||
    process.env.SLACK_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.bot_token ||
    null
  );
}

function resolveSlackChannelId(): string | null {
  return process.env.IL_SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL_ID || null;
}

async function sendSlackBotMessage(args: {
  token: string;
  channelId: string;
  text: string;
  buttonText?: string;
  buttonUrl?: string;
}): Promise<{ ok: true; ts?: string } | { ok: false; error: string; details?: unknown }> {
  const { token, channelId, text, buttonText, buttonUrl } = args;

  const blocks: unknown[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
  ];

  if (buttonText && buttonUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: buttonText },
          url: buttonUrl,
        },
      ],
    });
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    return { ok: false, error: `Slack API HTTP ${res.status}`, details: json ?? (await res.text().catch(() => null)) };
  }
  if (!json?.ok) {
    return { ok: false, error: `Slack API error: ${json?.error || 'unknown_error'}`, details: json };
  }

  return { ok: true, ts: json.ts };
}

function resolveWebhook(target: TargetChannel): string | null {
  // Allow a single shared webhook for quick setup (creative channel).
  if (target === 'creative') {
    return process.env.IL_SLACK_WEBHOOK_CREATIVE || process.env.IL_SLACK_WEBHOOK || null;
  }
  // Client channel should be explicitly configured.
  return process.env.IL_SLACK_WEBHOOK_CLIENT || null;
}

/**
 * POST /api/tweets/:tweetId/notifications/send-slack
 *
 * Sends an edited draft to Slack via webhook.
 * If a webhook is not configured, it falls back to Slack bot token + channelId (chat.postMessage).
 *
 * Env vars:
 * - IL_SLACK_WEBHOOK_CREATIVE (or IL_SLACK_WEBHOOK): creative directors channel
 * - IL_SLACK_WEBHOOK_CLIENT: client-facing channel
 * - IL_SLACK_BOT_TOKEN (or SLACK_BOT_TOKEN / BOT_TOKEN / bot_token): bot token for chat.postMessage
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;
    const body = await request.json();

    const target = (body?.target as TargetChannel | undefined) || 'creative';
    const text = body?.text as string | undefined;
    const channelId = body?.channelId as string | undefined;
    const buttonText = body?.buttonText as string | undefined;
    const buttonUrl = body?.buttonUrl as string | undefined;

    if (target !== 'creative' && target !== 'client') {
      return NextResponse.json(
        { success: false, error: 'Invalid target. Use "creative" or "client".' },
        { status: 400 }
      );
    }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'text is required' }, { status: 400 });
    }

    const tweet = await getTweet(tweetId);
    if (!tweet) {
      return NextResponse.json({ success: false, error: 'Tweet not found' }, { status: 404 });
    }

    const webhookUrl = resolveWebhook(target);
    const trimmedText = text.trim();

    // 1) Preferred: webhook (simple, fixed channel)
    if (webhookUrl) {
      const result = await sendSlackWebhook(webhookUrl, {
        text: trimmedText,
      });

      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: `Slack webhook failed: ${result.status}`, details: result.bodyText },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        data: { tweetId, target, mode: 'webhook' as const },
      });
    }

    // 2) Fallback: bot token + channelId (flexible, can target any channel the bot is in)
    const token = resolveSlackBotToken();
    if (!token) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Slack is not configured. Set IL_SLACK_WEBHOOK_CREATIVE/CLIENT OR set a bot token (IL_SLACK_BOT_TOKEN / SLACK_BOT_TOKEN / BOT_TOKEN / bot_token).',
        },
        { status: 400 }
      );
    }
    const resolvedChannelId = (channelId || resolveSlackChannelId() || '').trim();
    if (!resolvedChannelId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'channelId is required when using bot token. Provide it in the request body OR set IL_SLACK_CHANNEL_ID / SLACK_CHANNEL_ID. Invite the bot to that channel first.',
        },
        { status: 400 }
      );
    }

    const autoButtonUrl = tweet.tweet_url || `https://x.com/i/web/status/${tweetId}`;
    const botResult = await sendSlackBotMessage({
      token,
      channelId: resolvedChannelId,
      text: trimmedText,
      buttonText: buttonText?.trim() || 'View tweet',
      buttonUrl: (buttonUrl?.trim() || autoButtonUrl).trim(),
    });

    if (!botResult.ok) {
      return NextResponse.json(
        { success: false, error: botResult.error, details: botResult.details },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { tweetId, target, mode: 'bot' as const, ts: botResult.ts ?? null },
    });
  } catch (error) {
    console.error('Error sending tweet Slack notification:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to send Slack message',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

