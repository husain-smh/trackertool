export type SlackWebhookPayload = {
  text: string;
  blocks?: unknown[];
  unfurl_links?: boolean;
  unfurl_media?: boolean;
};

export async function sendSlackWebhook(
  webhookUrl: string,
  payload: SlackWebhookPayload
): Promise<{ ok: true } | { ok: false; status: number; bodyText: string }> {
  if (!webhookUrl || typeof webhookUrl !== 'string') {
    throw new Error('Slack webhook URL missing');
  }
  if (!payload || typeof payload.text !== 'string' || payload.text.trim().length === 0) {
    throw new Error('Slack payload text is required');
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      unfurl_links: false,
      unfurl_media: false,
      ...payload,
      text: payload.text.trim(),
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, bodyText: await res.text() };
  }
  return { ok: true };
}

