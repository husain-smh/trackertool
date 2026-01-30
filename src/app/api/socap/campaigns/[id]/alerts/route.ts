import { NextRequest, NextResponse } from 'next/server';
import { getAlertsByCampaign } from '@/lib/models/socap/alert-queue';
import { getEngagementById } from '@/lib/models/socap/engagements';
import { getAlertHistoryByCampaign } from '@/lib/models/socap/alert-history';
import { getTweetsByCampaign } from '@/lib/models/socap/tweets';
import { getCampaignById } from '@/lib/models/socap/campaigns';

/**
 * GET /api/socap/campaigns/[id]/alerts
 *
 * Returns queued alerts and recent alert history for a campaign.
 * This is used purely for visualization/debugging of alert formation,
 * spacing, and timing in the SOCAP UI.
 *
 * Note: In Next.js 15 route handlers, `params` is async and must be awaited.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await context.params;

    // CRITICAL: First verify that the campaign exists (not deleted)
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json(
        {
          success: false,
          error: 'Campaign not found',
        },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') as 'pending' | 'sent' | 'skipped' | null;

    // Fetch alerts for this campaign (default: all statuses, up to 200 for UI)
    const alerts = await getAlertsByCampaign(campaignId, {
      status: status ?? undefined,
      limit: 200,
    });

    // Fetch campaign tweets to validate that engagements reference tweets from this campaign
    const campaignTweets = await getTweetsByCampaign(campaignId);
    const campaignTweetIds = new Set(campaignTweets.map((t) => t.tweet_id));

    // Attach engagement details to each alert so the UI can render
    // IMPORTANT: Filter out alerts where the engagement doesn't belong to this campaign
    // This prevents showing alerts for tweets from other campaigns due to data inconsistencies
    const alertWithDetails = await Promise.all(
      alerts.map(async (alert) => {
        const engagement = await getEngagementById(alert.engagement_id);
        return {
          ...alert,
          engagement,
        };
      })
    );

    // Filter out alerts where engagement is missing, belongs to a different campaign,
    // or references a tweet that doesn't belong to this campaign or belongs to a deleted campaign
    const filteredAlerts = await Promise.all(
      alertWithDetails.map(async (alert) => {
        if (!alert.engagement) {
          // Log missing engagements for debugging but don't show them
          console.warn(
            `[Alerts API] Alert ${alert._id} references missing engagement ${alert.engagement_id}`
          );
          return null;
        }
        if (alert.engagement.campaign_id !== campaignId) {
          // Log mismatched campaign_ids for debugging
          console.warn(
            `[Alerts API] Alert ${alert._id} has engagement ${alert.engagement_id} with campaign_id ${alert.engagement.campaign_id}, but requested campaign is ${campaignId}`
          );
          return null;
        }
        
        // CRITICAL: Verify that the engagement's tweet_id actually belongs to this campaign
        // This prevents showing quote tweets that quote tweets from other campaigns
        if (!campaignTweetIds.has(alert.engagement.tweet_id)) {
          console.warn(
            `[Alerts API] Alert ${alert._id} has engagement ${alert.engagement_id} with tweet_id ${alert.engagement.tweet_id}, but this tweet does not belong to campaign ${campaignId}`
          );
          return null;
        }
        
        // Note: If campaignTweetIds.has() returns true, the tweet belongs to the current campaign
        // We already verified the campaign exists at the start, so no need for additional checks
        
        return alert;
      })
    );

    // Filter out null values (filtered alerts)
    const validAlerts = filteredAlerts.filter((alert): alert is NonNullable<typeof alert> => alert !== null);

    // Also fetch recent alert history so we can see what actually went out
    const history = await getAlertHistoryByCampaign(campaignId, 100);

    return NextResponse.json({
      success: true,
      data: {
        alerts: validAlerts,
        history,
      },
    });
  } catch (error) {
    console.error('Error fetching SOCAP alerts for campaign:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch alerts for campaign',
      },
      { status: 500 }
    );
  }
}


