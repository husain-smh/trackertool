#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

import { getQuoteTweetsCollection } from '../src/lib/models/socap/quote-tweets';
import { calculateImportanceScore } from '../src/lib/socap/engagement-processor';
import { disconnect } from '../src/lib/mongodb';

type CliOptions = {
  campaignId: string;
  batchSize: number;
  maxQuotes?: number;
  outputPath?: string;
};

type QuoteRecord = {
  tweetId: string;
  parentTweetId: string;
  text: string;
  authorUsername: string;
  authorName?: string;
  userId?: string;
  viewCount?: number;
  importanceScore?: number;
};

type LlmMatch = {
  tweet_id: string;
  author_username?: string;
  gist?: string;
};

const openAiKey = process.env.OPENAIAPIKEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

function ts(): string {
  return new Date().toISOString();
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const getArg = (name: string, fallback?: string) => {
    const flag = args.find((a) => a.startsWith(`--${name}=`));
    if (flag) return flag.split('=')[1];
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    return fallback;
  };

  const campaignId = getArg('campaign-id') || getArg('campaignId');
  if (!campaignId) {
    console.error('Usage: npx tsx scripts/narrative-scan.ts --campaign-id <id> [--batch-size 20] [--max-quotes 2000] [--output report.json]');
    process.exit(1);
  }

  const batchSize = Number(getArg('batch-size', '20'));
  const maxQuotes = getArg('max-quotes') ? Number(getArg('max-quotes')) : undefined;
  const outputPath = getArg('output');

  return {
    campaignId,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 20,
    maxQuotes: maxQuotes && Number.isFinite(maxQuotes) ? maxQuotes : undefined,
    outputPath: outputPath ? outputPath : undefined,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function buildLlmPrompt(batch: QuoteRecord[]): string {
  const trimmed = batch.map((q) => ({
    tweet_id: q.tweetId,
    author_username: q.authorUsername,
    text: q.text,
  }));

  return `
You are a strict filter. Input is JSON array of quote tweets. Return tweets that clearly talk about this product in relation to Lovable or Bolt, including: saying it is better/faster, competing with them, an alternative to them, or generally "like Lovable/Bolt". If they mention Lovable/Bolt in this sense (even neutral comparisons), include it. If Lovable/Bolt is not referenced or the connection is unclear, exclude it.

INPUT (JSON):
${JSON.stringify(trimmed, null, 2)}

OUTPUT: JSON array. Each item MUST be:
{ "tweet_id": "<id>", "author_username": "<handle>", "gist": "<very short summary of what they claimed>" }

Rules:
- Return ONLY matching tweets. If none match, return [].
- Do not add or change tweet_ids. Do not invent content.
- Stay concise; gist max ~30 words.
`.trim();
}

function safeParseArray(raw: string): LlmMatch[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LlmMatch[];
  } catch (err) {
    // fallthrough
  }
  // Attempt to extract first JSON array in the string
  const match = raw.match(/\[([\s\S]*)\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed as LlmMatch[];
    } catch (err) {
      // ignore
    }
  }
  return [];
}

async function filterMatchesWithLlm(batch: QuoteRecord[]): Promise<Set<string>> {
  if (!openai) {
    throw new Error('OPENAIAPIKEY not set; cannot run LLM filtering');
  }

  const prompt = buildLlmPrompt(batch);
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'Return JSON array only. Include only tweet_ids that clearly express the target narrative. If none match, return [].',
      },
      { role: 'user', content: prompt },
    ],
  });

  const content = completion.choices[0].message.content?.trim() || '[]';
  const parsed = safeParseArray(content);
  const ids = new Set<string>();
  for (const item of parsed) {
    if (item && typeof item.tweet_id === 'string' && item.tweet_id.trim()) {
      ids.add(item.tweet_id.trim());
    }
  }
  return ids;
}

async function enrichImportance(quotes: QuoteRecord[]): Promise<void> {
  // Compute importance scores one-by-one; small enough for local runs.
  for (const q of quotes) {
    if (!q.userId) {
      q.importanceScore = 0;
      continue;
    }
    try {
      q.importanceScore = await calculateImportanceScore(q.userId);
    } catch (err) {
      console.warn(`[${ts()}] ⚠️ importance lookup failed for user ${q.userId}: ${String(err)}`);
      q.importanceScore = 0;
    }
  }
}

async function main() {
  const { campaignId, batchSize, maxQuotes, outputPath } = parseArgs();

  console.log(`[${ts()}] 🚀 Narrative scan starting for campaign ${campaignId}`);

  const collection = await getQuoteTweetsCollection();
  const cursor = collection
    .find({ campaign_id: campaignId })
    .sort({ created_at: 1 });

  const dedupQuoteIds = new Set<string>(); // across campaign
  const quotes: QuoteRecord[] = [];

  for await (const doc of cursor) {
    const quoteId = doc.quote_tweet_id;
    if (!quoteId || dedupQuoteIds.has(quoteId)) continue;
    dedupQuoteIds.add(quoteId);

    quotes.push({
      tweetId: quoteId,
      parentTweetId: doc.parent_tweet_id,
      text: doc.text || '',
      authorUsername: doc.author?.username || '',
      authorName: doc.author?.name,
      userId: doc.author?.user_id,
      viewCount: typeof doc.metrics?.viewCount === 'number' ? doc.metrics.viewCount : undefined,
      importanceScore: 0,
    });

    if (maxQuotes && quotes.length >= maxQuotes) {
      console.log(`[${ts()}] Reached maxQuotes=${maxQuotes}, stopping collection.`);
      break;
    }
  }

  console.log(
    `[${ts()}] Loaded ${quotes.length} unique quotes from DB for campaign ${campaignId} (deduped by tweet_id).`
  );

  if (!quotes.length) {
    console.log(`[${ts()}] No quotes collected; exiting.`);
    process.exit(0);
  }

  console.log(`[${ts()}] Enriching importance scores from ranker...`);
  await enrichImportance(quotes);

  console.log(`[${ts()}] Running LLM filtering in batches of ${batchSize}...`);
  const batches = chunk(quotes, batchSize);
  const matchedIds = new Set<string>();

  for (const batch of batches) {
    try {
      const ids = await filterMatchesWithLlm(batch);
      ids.forEach((id) => matchedIds.add(id));
    } catch (err) {
      console.warn(`[${ts()}] ⚠️ LLM batch failed: ${String(err)}`);
    }
  }

  const matchedQuotes = quotes.filter((q) => matchedIds.has(q.tweetId));
  const totalViews = matchedQuotes.reduce((acc, q) => acc + (q.viewCount || 0), 0);

  matchedQuotes.sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));

  const report = {
    campaign_id: campaignId,
    generated_at: ts(),
    scanned_quotes: quotes.length,
    matched_quotes: matchedQuotes.length,
    total_views: totalViews,
    matches: matchedQuotes.map((q) => ({
      tweet_id: q.tweetId,
      parent_tweet_id: q.parentTweetId,
      author_username: q.authorUsername,
      author_name: q.authorName,
      importance_score: q.importanceScore ?? 0,
      view_count: q.viewCount ?? null,
      url: `https://twitter.com/i/web/status/${q.tweetId}`,
      text: q.text,
    })),
  };

  const outPath =
    outputPath ||
    path.join(process.cwd(), `narrative-report-${campaignId}-${Date.now()}.json`);

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`[${ts()}] ✅ Done. Matches: ${matchedQuotes.length}/${quotes.length}. Total views: ${totalViews.toLocaleString()}.`);
  console.log(`[${ts()}] Report saved to: ${outPath}`);
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`[${ts()}] ❌ Fatal error:`, err);
    await disconnect();
    process.exit(1);
  });

