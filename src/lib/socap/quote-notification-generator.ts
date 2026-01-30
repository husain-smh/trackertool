import OpenAI from 'openai';

type SentimentLabel = 'positive' | 'neutral' | 'critical';

export interface QuotePromptTweetContext {
  authorName: string;
  authorUsername: string;
  text?: string;
  url?: string;
}

export interface QuotePromptQuote {
  engagementId: string;
  accountName: string;
  accountUsername: string;
  followers: number;
  importanceScore: number;
  verified: boolean;
  quoteText?: string;
  accountBio?: string;
  timestampISO: string;
}

export interface QuoteNotificationSuggestion {
  engagementIds: string[];
  notification: string;
  sentiment: SentimentLabel;
}

export interface QuoteNotificationPrompt {
  campaignName: string;
  mainTweet: QuotePromptTweetContext;
  quotes: QuotePromptQuote[];
}

const openAiKey = process.env.OPENAIAPIKEY;
const openai = openAiKey
  ? new OpenAI({
      apiKey: openAiKey,
    })
  : null;

function buildPrompt(payload: QuoteNotificationPrompt): string {
  const instructions = `
You are an assistant that composes concise, high-signal notifications about important quote tweets.

INPUT (JSON):
${JSON.stringify(payload, null, 2)}

REQUIREMENTS:
1. Read the main tweet context and each quote carefully.
2. Return JSON ONLY. Do not include explanations.
3. CRITICAL: Generate EXACTLY ONE unique notification per quote/engagement. DO NOT combine multiple quotes into one notification.
4. Output format (array with one object per quote - each object must have exactly ONE engagement_id):
[
  {
    "engagement_ids": ["id1"],
    "notification": "Specific, unique notification mentioning the account name/username and key details from their quote text.",
    "sentiment": "positive|neutral|critical"
  },
  {
    "engagement_ids": ["id2"],
    "notification": "Different specific notification for the second account with their unique quote details.",
    "sentiment": "positive|neutral|critical"
  }
]
5. IMPORTANT: Each "engagement_ids" array must contain EXACTLY ONE ID. Never put multiple engagement IDs in a single notification object.
6. Each notification MUST be unique and specific to that engager:
   - Mention the account's name or username
   - Include specific details from their quote text (what they said, their stance, key points)
   - Highlight unique aspects of their response (agreement, criticism, questions, insights, etc.)
   - Reference specific topics or themes from their quote
7. Make notifications highly specific and contextual - avoid generic templates. Each should reflect what that particular engager actually said.
8. Stay under 240 characters per notification.
9. Sentiment should reflect the quote tone toward the original tweet (positive = supportive/enthusiastic, critical = questioning/negative, neutral = factual/informational).
10. If multiple accounts quote the same tweet, each must have a distinctly different notification highlighting their unique perspective or comment.

EXAMPLE:
If Account A says "This is revolutionary!" and Account B says "Interesting but needs more data", generate:
- "Account A (@usernameA) quote-tweeted your post, calling it revolutionary and highlighting its impact."
- "Account B (@usernameB) quote-tweeted your post, noting it's interesting but requesting more supporting data."

NOT:
- "Account A and Account B quote-tweeted your post." (too generic, combines accounts)
`;

  return instructions.trim();
}

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response did not contain a JSON array');
  }
  const jsonSegment = raw.slice(start, end + 1);
  return JSON.parse(jsonSegment);
}

/**
 * Check if an error is an OpenAI rate limit error
 */
function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as any;
    // Check for OpenAI rate limit indicators
    if (err.status === 429 || err.code === 'rate_limit_exceeded') {
      return true;
    }
    // Check error message for rate limit keywords
    if (err.message && typeof err.message === 'string') {
      const msg = err.message.toLowerCase();
      return (
        msg.includes('rate limit') ||
        msg.includes('429') ||
        msg.includes('requests per day')
      );
    }
  }
  return false;
}

export async function generateQuoteNotifications(
  payload: QuoteNotificationPrompt
): Promise<QuoteNotificationSuggestion[]> {
  if (!openai) {
    console.warn('[QuoteNotifications] OPENAIAPIKEY not set. Skipping generation.');
    return [];
  }

  const prompt = buildPrompt(payload);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content:
            'You generate unique, specific notifications for each quote tweet engagement. Each notification must be distinct and highlight what that particular engager said. Always respond with JSON array containing one notification object per engagement.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const raw = completion.choices[0].message.content?.trim() || '[]';

    const parsed = extractJsonArray(raw) as Array<{
      engagement_ids?: string[];
      notification?: string;
      sentiment?: SentimentLabel;
    }>;

    return parsed
      .filter(
        (item): item is Required<typeof item> =>
          Array.isArray(item.engagement_ids) &&
          item.engagement_ids.length > 0 &&
          typeof item.notification === 'string' &&
          !!item.notification.trim() &&
          (item.sentiment === 'positive' || item.sentiment === 'neutral' || item.sentiment === 'critical')
      )
      .map((item) => ({
        engagementIds: item.engagement_ids!,
        notification: item.notification!.trim(),
        sentiment: item.sentiment!,
      }));
  } catch (error) {
    // If rate limited, throw a special error that callers can detect
    if (isRateLimitError(error)) {
      const rateLimitError = new Error('OpenAI rate limit exceeded');
      (rateLimitError as any).isRateLimit = true;
      (rateLimitError as any).originalError = error;
      throw rateLimitError;
    }
    // Re-throw other errors
    throw error;
  }
}

