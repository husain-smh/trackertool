import OpenAI from 'openai';
import type { AIReport } from './generate-ai-report';
import type { Tweet, Engager } from './models/tweets';

export type TweetSlackDraft = {
  id: string;
  label: string;
  message: string;
};

export type TweetSlackDraftInput = {
  tweet: Pick<Tweet, 'tweet_id' | 'tweet_url' | 'author_name' | 'author_username' | 'metrics' | 'total_engagers'>;
  stats?: {
    total: number;
    above_10k: number;
    replied: number;
    retweeted: number;
    quoted: number;
    verified: number;
    avg_importance_score: number;
    max_importance_score: number;
  };
  aiReport?: Pick<AIReport, 'narrative' | 'structured_stats' | 'notable_people'>;
  topEngagers?: Array<Pick<Engager, 'username' | 'name' | 'followers' | 'verified' | 'replied' | 'retweeted' | 'quoted' | 'importance_score'>>;
};

const openAiKey = process.env.OPENAIAPIKEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response did not contain a JSON array');
  }
  const jsonSegment = raw.slice(start, end + 1);
  return JSON.parse(jsonSegment);
}

function buildPrompt(input: TweetSlackDraftInput): string {
  const payload = {
    tweet: {
      tweet_id: input.tweet.tweet_id,
      tweet_url: input.tweet.tweet_url,
      author_name: input.tweet.author_name,
      author_username: input.tweet.author_username,
      metrics: input.tweet.metrics ?? null,
      total_engagers: input.tweet.total_engagers,
    },
    stats: input.stats ?? null,
    ai_report: input.aiReport
      ? {
          // Narrative can be long; include a capped excerpt to stay within tokens.
          narrative_excerpt: (input.aiReport.narrative || '').slice(0, 1600),
          structured_stats: input.aiReport.structured_stats,
          notable_people: input.aiReport.notable_people,
        }
      : null,
    top_engagers: (input.topEngagers ?? []).slice(0, 12),
  };

  return `
You are a senior creative strategist writing Slack-ready notifications for a creative director team.

INPUT (JSON):
${JSON.stringify(payload, null, 2)}

TASK:
Generate 3 distinct Slack message drafts that a creative director would be proud to send.

REQUIREMENTS:
1. Output JSON ONLY (no prose). Output must be an array of objects: [{ "id": "...", "label": "...", "message": "..." }, ...]
2. Create EXACTLY 3 drafts.
3. Each message must be specific to this tweet + its engagement report. Do not use generic templates.
4. Each message should be short enough for Slack (aim < 700 characters).
5. Use ONLY the provided data. Do not invent names, numbers, firms, or content.
6. Include the tweet URL in each message (once).
7. Draft styles:
   - draft 1: "Client-ready highlight" (polished, concise, confident)
   - draft 2: "Creative director angle" (more punchy/insightful, suggests a narrative or hook)
   - draft 3: "Ultra-short headline + bullets" (1 headline line + 2–3 bullets max)

NOTES:
- If ai_report is missing, fall back to stats/top_engagers/metrics only and say "Engagement snapshot" (no narrative claims).
`.trim();
}

export async function generateTweetSlackDrafts(
  input: TweetSlackDraftInput
): Promise<TweetSlackDraft[]> {
  if (!openai) {
    console.warn('[TweetSlackDrafts] OPENAIAPIKEY not set. Skipping generation.');
    return [];
  }

  const prompt = buildPrompt(input);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.6,
    max_tokens: 900,
    messages: [
      {
        role: 'system',
        content:
          'You write high-signal Slack notifications for creative directors. You are specific, concise, and you NEVER invent facts. You always respond with JSON only.',
      },
      { role: 'user', content: prompt },
    ],
  });

  const raw = completion.choices[0].message.content?.trim() || '[]';
  const parsed = extractJsonArray(raw) as Array<{
    id?: string;
    label?: string;
    message?: string;
  }>;

  const drafts = parsed
    .filter(
      (d): d is Required<typeof d> =>
        typeof d.id === 'string' &&
        d.id.trim().length > 0 &&
        typeof d.label === 'string' &&
        d.label.trim().length > 0 &&
        typeof d.message === 'string' &&
        d.message.trim().length > 0
    )
    .map((d) => ({
      id: d.id.trim(),
      label: d.label.trim(),
      message: d.message.trim(),
    }));

  // Hard guarantee: return at most 3, even if model misbehaves.
  return drafts.slice(0, 3);
}

