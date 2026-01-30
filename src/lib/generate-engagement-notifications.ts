import OpenAI from 'openai';

export type SentimentLabel = 'positive' | 'neutral' | 'critical';

export type EngagementForNotification = {
  key: string; // stable key we define (e.g. "quote:123" or "reply:456")
  action_type: 'quote' | 'reply';
  user_id: string;
  account: {
    username: string;
    name: string;
    followers: number;
    verified: boolean;
    bio?: string;
  };
  engagement_tweet_id?: string;
  engagement_tweet_url?: string;
  text?: string;
  timestampISO?: string;
};

export type EngagementNotificationSuggestion = {
  key: string;
  notification: string;
  sentiment: SentimentLabel;
};

export type EngagementNotificationPrompt = {
  mainTweet: {
    id: string;
    url: string;
    authorName?: string;
    authorUsername?: string;
    text?: string;
  };
  engagements: EngagementForNotification[];
};

const openAiKey = process.env.OPENAIAPIKEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

function stripMarkdownCodeFences(input: string): string {
  // Handles:
  // ```json
  // { ... }
  // ```
  // and plain ``` ... ```
  const s = input.trim();
  if (!s.startsWith('```')) return s;
  // Remove first fence line and last fence.
  const withoutFirstLine = s.replace(/^```[a-zA-Z0-9_-]*\s*\r?\n/, '');
  return withoutFirstLine.replace(/\r?\n```\s*$/, '').trim();
}

function removeTrailingCommas(jsonLike: string): string {
  // Turns JSON-with-trailing-commas into valid JSON:
  // { "a": 1, } -> { "a": 1 }
  // [1,2,] -> [1,2]
  return jsonLike.replace(/,\s*([}\]])/g, '$1');
}

function extractFirstJsonValue(rawInput: string): string {
  const raw = stripMarkdownCodeFences(rawInput);
  const firstObj = raw.indexOf('{');
  const firstArr = raw.indexOf('[');
  let start = -1;
  let open: '{' | '[' | null = null;

  if (firstObj === -1 && firstArr === -1) {
    throw new Error('LLM response did not contain JSON');
  }
  if (firstObj === -1 || (firstArr !== -1 && firstArr < firstObj)) {
    start = firstArr;
    open = '[';
  } else {
    start = firstObj;
    open = '{';
  }

  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === open) depth++;
    if (ch === close) depth--;

    if (depth === 0) {
      return raw.slice(start, i + 1).trim();
    }
  }

  // If we got here, braces/brackets were unbalanced. Fall back to original raw.
  return raw.slice(start).trim();
}

function extractJsonObject(raw: string): unknown {
  const jsonSegment = extractFirstJsonValue(raw);
  try {
    return JSON.parse(jsonSegment);
  } catch {
    // Common “almost JSON” failures from LLMs.
    const repaired = removeTrailingCommas(jsonSegment);
    const parsed = JSON.parse(repaired) as unknown;
    return parsed;
  }
}

function safeSlice(input: string | undefined, maxChars: number): string | undefined {
  const s = typeof input === 'string' ? input.trim() : '';
  if (!s) return undefined;
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildPrompt(payload: EngagementNotificationPrompt): string {
  // Keep prompts compact so the model is less likely to produce invalid JSON.
  // (We also use Structured Outputs, but smaller prompts = fewer failures + cheaper.)
  const compactPayload: EngagementNotificationPrompt = {
    mainTweet: {
      ...payload.mainTweet,
      text: safeSlice(payload.mainTweet.text, 900),
    },
    engagements: payload.engagements.map((e) => ({
      ...e,
      account: {
        username: e.account.username,
        name: e.account.name,
        followers: e.account.followers,
        verified: e.account.verified,
        // bio is helpful sometimes, but it's a big token sink; keep it short.
        bio: safeSlice(e.account.bio, 220),
      },
      text: safeSlice(e.text, 700),
    })),
  };

  return `
You are an assistant that composes concise, high-signal Twitter-native notifications about important quote tweets and replies.

INPUT (JSON):
${JSON.stringify(compactPayload, null, 2)}

REQUIREMENTS:
1. Return JSON ONLY. Do not include explanations, markdown, or any text outside JSON.
2. Output format: a JSON object: { "items": [...] } where items is an array with EXACTLY one object per input engagement.
3. CRITICAL: Do NOT combine multiple engagements into one notification.
4. Each output object must be:
   {
     "key": "<exactly the same key from input>",
     "notification": "<a specific, unique, Twitter-native sentence>",
     "sentiment": "positive|neutral|critical"
   }
5. Each notification MUST be unique and specific to that engagement:
   - Mention the account name or username
   - Include specific details from their quote/reply text (what they said / asked / criticized / supported)
6. Stay under 240 characters per notification.
7. Always include the main tweet URL ONCE at the end of each notification.
8. If an engagement has missing text, write a conservative notification that does NOT invent content.
   Example: "X (@y) replied to your post. <url>"
9. Sentiment definition:
   - positive: supportive/enthusiastic
   - critical: questioning/negative
   - neutral: informational/factual
10. VOICE / POV (IMPORTANT):
   - Write in first person addressed to the tweet author.
   - Use "your post" / "your tweet" (NOT "the client", "the client's post", or "clients").
   - Keep it a little cool, tech-savvy, and Twitter-native. No corporate jargon.
`.trim();
}

export async function generateEngagementNotifications(
  payload: EngagementNotificationPrompt
): Promise<EngagementNotificationSuggestion[]> {
  if (!openai) {
    console.warn('[EngagementNotifications] OPENAIAPIKEY not set. Skipping generation.');
    return [];
  }

  const prompt = buildPrompt(payload);

  // NOTE: current system prompt (as requested):
  // "You generate one unique notification per engagement. You never invent facts. You always respond with JSON only."
  const systemPrompt =
    'You generate one unique notification per engagement. You never invent facts. You always respond with JSON only.';

  // Retry once on parse failures. This prevents one malformed model response from killing the whole batch.
  let raw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: attempt === 0 ? 0.4 : 0.2,
      // Needs to be high enough to fit ~N notifications + JSON overhead,
      // otherwise the response can get truncated mid-string and become invalid JSON.
      max_tokens: 2400,
      // Structured Outputs: force valid JSON in the shape we expect.
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'engagement_notification_suggestions',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    key: { type: 'string' },
                    notification: { type: 'string' },
                    sentiment: { type: 'string', enum: ['positive', 'neutral', 'critical'] },
                  },
                  required: ['key', 'notification', 'sentiment'],
                },
              },
            },
            required: ['items'],
          },
        },
      },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    raw = completion.choices[0].message.content?.trim() || '';
    try {
      const parsed = extractJsonObject(raw) as
        | { items?: Array<{ key?: string; notification?: string; sentiment?: SentimentLabel }> }
        | Array<{ key?: string; notification?: string; sentiment?: SentimentLabel }>;

      // Be tolerant if the model returns the array directly.
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
      return items
        .filter(
          (item): item is Required<typeof item> =>
            typeof item.key === 'string' &&
            item.key.trim().length > 0 &&
            typeof item.notification === 'string' &&
            item.notification.trim().length > 0 &&
            (item.sentiment === 'positive' || item.sentiment === 'neutral' || item.sentiment === 'critical')
        )
        .map((item) => ({
          key: item.key.trim(),
          notification: item.notification.trim(),
          sentiment: item.sentiment,
        }));
    } catch (e) {
      // If the model still returns something unparsable, retry once with stricter settings.
      if (attempt === 0) continue;
      console.error('[EngagementNotifications] Failed to parse model JSON:', e);
      console.error('[EngagementNotifications] Raw model output (truncated):', raw.slice(0, 1200));
      return [];
    }
  }

  // Unreachable, but keeps TS happy.
  return [];
}

