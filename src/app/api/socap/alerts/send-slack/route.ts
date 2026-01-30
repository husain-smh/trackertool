import { NextRequest, NextResponse } from 'next/server';
import { getAlertById } from '@/lib/models/socap/alert-queue';
import { getCampaignById } from '@/lib/models/socap/campaigns';
import { getEngagementById } from '@/lib/models/socap/engagements';

/**
 * POST /api/socap/alerts/send-slack
 *
 * Stub endpoint used by the UI "Send on Slack" button.
 * It does NOT actually call Slack (for now) – instead it builds the payload
 * you would send, logs it, and returns it so you can see exactly what
 * the notification would look like.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const alertId = body.alertId as string | undefined;

    if (!alertId) {
      return NextResponse.json(
        { success: false, error: 'alertId is required' },
        { status: 400 }
      );
    }

    const alert = await getAlertById(alertId);
    if (!alert) {
      return NextResponse.json(
        { success: false, error: 'Alert not found' },
        { status: 404 }
      );
    }

    const campaign = await getCampaignById(alert.campaign_id);
    const engagement = await getEngagementById(alert.engagement_id);

    if (!campaign || !engagement) {
      return NextResponse.json(
        { success: false, error: 'Campaign or engagement not found for this alert' },
        { status: 404 }
      );
    }

    const actionText =
      ({
        retweet: 'retweeted',
        reply: 'replied to',
        quote: 'quote-tweeted',
      } as Record<string, string>)[engagement.action_type] || 'engaged with';

    let notificationText = alert.llm_copy || null;

    if (!notificationText && alert.llm_group_parent_id) {
      const parentAlert = await getAlertById(alert.llm_group_parent_id);
      if (parentAlert?.llm_copy) {
        notificationText = parentAlert.llm_copy;
      }
    }

    if (!notificationText) {
      const profile = engagement.account_profile || {};
      const name = profile.name || profile.username || 'Someone';
      const username = profile.username || '';
      const campaignName = campaign.launch_name || 'your campaign';
      notificationText = `${name}${username ? ` (@${username})` : ''} ${actionText} your post for "${campaignName}".`;
    }

    const slackPayload = {
      text: notificationText,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 High-importance Engagement',
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: notificationText,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Campaign:*\n${campaign.launch_name}`,
            },
            {
              type: 'mrkdwn',
              text: `*Account:*\n@${engagement.account_profile.username} (${engagement.account_profile.name})`,
            },
            {
              type: 'mrkdwn',
              text: `*Action:*\n${actionText} your tweet`,
            },
            {
              type: 'mrkdwn',
              text: `*Importance Score:*\n${alert.importance_score}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Categories:* ${engagement.account_categories.join(', ')}`,
          },
        },
      ],
    };

    // In the real integration, you would POST this payload to the Slack webhook URL.
    console.log('SOCAP Slack alert preview payload:', JSON.stringify(slackPayload, null, 2));

    return NextResponse.json({
      success: true,
      message: 'Slack alert preview generated (not actually sent)',
      data: {
        alert,
        campaign,
        engagement,
        slackPayload,
      },
    });
  } catch (error) {
    console.error('Error generating Slack alert preview:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate Slack alert preview',
      },
      { status: 500 }
    );
  }
}


