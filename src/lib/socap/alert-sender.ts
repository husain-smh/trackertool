import { getPendingAlerts, markAlertAsSent, markAlertAsSkipped } from '../models/socap/alert-queue';
import { getCampaignById } from '../models/socap/campaigns';
import { createAlertHistory, roundToHour } from '../models/socap/alert-history';
import { getEngagementById } from '../models/socap/engagements';

/**
 * Send alerts via configured channels
 */
export async function sendAlerts(limit: number = 50): Promise<{
  sent: number;
  skipped: number;
  errors: number;
}> {
  const stats = {
    sent: 0,
    skipped: 0,
    errors: 0,
  };
  
  // Get pending alerts ready to send
  const pendingAlerts = await getPendingAlerts(limit);
  
  for (const alert of pendingAlerts) {
    try {
      const campaign = await getCampaignById(alert.campaign_id);
      
      if (!campaign) {
        await markAlertAsSkipped(alert._id!, 'Campaign not found');
        stats.skipped++;
        continue;
      }
      
      // Get engagement details
      const engagement = await getEngagementById(alert.engagement_id);
      
      if (!engagement) {
        await markAlertAsSkipped(alert._id!, 'Engagement not found');
        stats.skipped++;
        continue;
      }
      
      // Send via configured channels
      const channels = campaign.alert_preferences.channels || [];
      let sent = false;
      
      for (const channel of channels) {
        try {
          if (channel === 'slack') {
            await sendSlackAlert(campaign, engagement, alert);
            sent = true;
          } else if (channel === 'email') {
            await sendEmailAlert(campaign, engagement, alert);
            sent = true;
          }
        } catch (error) {
          console.error(`Error sending ${channel} alert:`, error);
          // Continue to next channel
        }
      }
      
      if (sent) {
        // Mark as sent and record in history
        await markAlertAsSent(alert._id!);
        
        // Record in alert history for deduplication
        for (const channel of channels) {
          await createAlertHistory({
            campaign_id: alert.campaign_id,
            user_id: alert.user_id,
            action_type: alert.action_type,
            timestamp_hour: roundToHour(engagement.timestamp),
            sent_at: new Date(),
            channel: channel as 'slack' | 'email',
          });
        }
        
        stats.sent++;
      } else {
        await markAlertAsSkipped(alert._id!, 'No channels configured or all failed');
        stats.skipped++;
      }
    } catch (error) {
      console.error(`Error processing alert ${alert._id}:`, error);
      stats.errors++;
    }
  }
  
  return stats;
}

/**
 * Build a client-facing, single-sentence notification summary.
 * Example: "Robert Scoble (@Scobleizer) retweeted your post for \"SOCAP Launch\"."
 */
function buildNotificationText(
  campaign: any,
  engagement: any,
  alert: any,
  actionText: string
): string {
  const profile = engagement.account_profile || {};
  const name = profile.name || profile.username || 'Someone';
  const username = profile.username || '';
  const campaignName = campaign.launch_name || 'your campaign';

  // Client-facing: no importance score, just a clear human sentence
  return `${name}${username ? ` (@${username})` : ''} ${actionText} your post for "${campaignName}".`;
}

/**
 * Send Slack alert
 */
async function sendSlackAlert(
  campaign: any,
  engagement: any,
  alert: any
): Promise<void> {
  const webhookUrl = process.env.SOCAP_SLACK_WEBHOOK || campaign.alert_preferences.slack_webhook;
  
  if (!webhookUrl) {
    throw new Error('Slack webhook URL not configured');
  }
  
  const actionText = ({
    retweet: 'retweeted',
    reply: 'replied to',
    quote: 'quote-tweeted',
  } as Record<string, string>)[engagement.action_type] || 'engaged with';

  // Use LLM-generated notification if available, otherwise fall back to basic template
  const notificationText = alert.llm_copy 
    ? alert.llm_copy 
    : buildNotificationText(campaign, engagement, alert, actionText);

  // Add sentiment emoji if LLM-generated
  const sentimentEmoji = alert.llm_sentiment === 'positive' ? '✅' 
    : alert.llm_sentiment === 'critical' ? '⚠️' 
    : alert.llm_sentiment === 'neutral' ? 'ℹ️' 
    : '🚨';

  const headerText = alert.llm_copy 
    ? `${sentimentEmoji} ${alert.llm_sentiment ? alert.llm_sentiment.toUpperCase() : 'High-importance'} Engagement`
    : '🚨 High-importance Engagement';

  const message = {
    // This is what the client will primarily see in Slack
    text: notificationText,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerText,
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
  
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
  
  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status}`);
  }
}

/**
 * Send Email alert
 */
async function sendEmailAlert(
  campaign: any,
  engagement: any,
  alert: any
): Promise<void> {
  const emailTo = campaign.client_info.email;
  
  if (!emailTo) {
    throw new Error('Client email not configured');
  }
  
  const actionText = ({
    retweet: 'retweeted',
    reply: 'replied to',
    quote: 'quote-tweeted',
  } as Record<string, string>)[engagement.action_type] || 'engaged with';

  // Use LLM-generated notification if available
  const notificationText = alert.llm_copy 
    ? alert.llm_copy 
    : buildNotificationText(campaign, engagement, alert, actionText);

  const sentimentEmoji = alert.llm_sentiment === 'positive' ? '✅' 
    : alert.llm_sentiment === 'critical' ? '⚠️' 
    : alert.llm_sentiment === 'neutral' ? 'ℹ️' 
    : '🚨';

  const headerText = alert.llm_copy 
    ? `${sentimentEmoji} ${alert.llm_sentiment ? alert.llm_sentiment.toUpperCase() : 'High-importance'} Engagement`
    : '🚨 High-importance Engagement Detected';

  const subject = alert.llm_copy 
    ? `${sentimentEmoji} ${alert.llm_sentiment ? alert.llm_sentiment.toUpperCase() : 'Engagement'}: @${engagement.account_profile.username}`
    : `🚨 High-importance engagement: @${engagement.account_profile.username}`;
  
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        .field { margin-bottom: 15px; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; }
        .footer { margin-top: 20px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>${headerText}</h2>
        </div>
        <div class="content">
          <div class="field">
            <span class="label">Notification:</span>
            <span class="value">${notificationText}</span>
          </div>
          <div class="field">
            <span class="label">Campaign:</span>
            <span class="value">${campaign.launch_name}</span>
          </div>
          <div class="field">
            <span class="label">Account:</span>
            <span class="value">@${engagement.account_profile.username} (${engagement.account_profile.name})</span>
          </div>
          <div class="field">
            <span class="label">Action:</span>
            <span class="value">${actionText} your tweet</span>
          </div>
          <div class="field">
            <span class="label">Importance Score:</span>
            <span class="value">${alert.importance_score}</span>
          </div>
          <div class="field">
            <span class="label">Categories:</span>
            <span class="value">${engagement.account_categories?.join(', ') || 'N/A'}</span>
          </div>
          <div class="field">
            <span class="label">Time:</span>
            <span class="value">${new Date(engagement.timestamp).toLocaleString()}</span>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated alert from SOCAP Campaign Monitoring System.</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  const textBody = `
${headerText}

Notification: ${notificationText}

Campaign: ${campaign.launch_name}
Account: @${engagement.account_profile.username} (${engagement.account_profile.name})
Action: ${actionText} your tweet
Importance Score: ${alert.importance_score}
Categories: ${engagement.account_categories?.join(', ') || 'N/A'}
Time: ${new Date(engagement.timestamp).toLocaleString()}

This is an automated alert from SOCAP Campaign Monitoring System.
  `.trim();
  
  // Try to use environment variable for email service
  // Support multiple email services
  const emailService = process.env.EMAIL_SERVICE || 'console';
  
  if (emailService === 'console' || !process.env.EMAIL_API_KEY) {
    // Fallback to console logging if no email service configured
    console.log('Email alert (not sent - no email service configured):', {
      to: emailTo,
      subject,
      body: textBody,
    });
    return;
  }
  
  // SendGrid
  if (emailService === 'sendgrid' && process.env.SENDGRID_API_KEY) {
    const sendgridUrl = 'https://api.sendgrid.com/v3/mail/send';
    const response = await fetch(sendgridUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: emailTo }],
          subject: subject,
        }],
        from: {
          email: process.env.EMAIL_FROM || 'noreply@socap.com',
          name: 'SOCAP Campaign Monitor',
        },
        content: [
          {
            type: 'text/plain',
            value: textBody,
          },
          {
            type: 'text/html',
            value: htmlBody,
          },
        ],
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SendGrid API error: ${response.status} - ${errorText}`);
    }
    return;
  }
  
  // AWS SES (via SMTP or API)
  if (emailService === 'ses' && process.env.AWS_SES_REGION) {
    // For AWS SES, you'd typically use AWS SDK
    // This is a simplified version - in production, use @aws-sdk/client-ses
    console.log('AWS SES email sending not fully implemented - use AWS SDK');
    throw new Error('AWS SES integration requires AWS SDK setup');
  }
  
  // Generic SMTP
  if (emailService === 'smtp' && process.env.SMTP_HOST) {
    // For SMTP, you'd use nodemailer
    // This is a placeholder - install nodemailer and configure
    console.log('SMTP email sending not fully implemented - install nodemailer');
    throw new Error('SMTP integration requires nodemailer package');
  }
  
  // If no service matches, log
  console.warn(`Email service "${emailService}" not fully configured. Email not sent.`);
}


