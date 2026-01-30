#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

import { getRepliesCollection } from '../src/lib/models/socap/replies';
import { calculateImportanceScore } from '../src/lib/socap/engagement-processor';
import { disconnect } from '../src/lib/mongodb';

type CliOptions = {
  campaignId: string;
  batchSize: number;
  maxReplies?: number;
  outputPath?: string;
};

type ReplyRecord = {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    console.error(
      'Usage: npx tsx scripts/reply-narrative-scan.ts --campaign-id <id> [--batch-size 50] [--max-replies 2000] [--output report.json]'
    );
    process.exit(1);
  }

  const batchSize = Number(getArg('batch-size', '50'));
  const maxReplies = getArg('max-replies') ? Number(getArg('max-replies')) : undefined;
  const outputPath = getArg('output');

  return {
    campaignId,
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 50,
    maxReplies: maxReplies && Number.isFinite(maxReplies) ? maxReplies : undefined,
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

function buildLlmPrompt(batch: ReplyRecord[]): string {
  const trimmed = batch.map((q) => ({
    tweet_id: q.tweetId,
    author_username: q.authorUsername,
    text: q.text,
  }));

  return `
You are a strict filter. Input is JSON array of replies. Return tweets that clearly talk about this product in relation to Lovable or Bolt, including: saying it is better/faster, competing with them, an alternative to them, or generally "like Lovable/Bolt". If they mention Lovable/Bolt in this sense (even neutral comparisons), include it. If Lovable/Bolt is not referenced or the connection is unclear, exclude it.

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

async function filterMatchesWithLlm(batch: ReplyRecord[]): Promise<Set<string>> {
  if (!openai) {
    throw new Error('OPENAIAPIKEY not set; cannot run LLM filtering');
  }

  const prompt = buildLlmPrompt(batch);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
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
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      const isRetryable = status === 429 || status === 500 || status === 503;
      if (attempt === maxAttempts || !isRetryable) {
        throw err;
      }
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      console.warn(`[${ts()}] ⚠️ LLM call failed (status ${status}); retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
    }
  }

  return new Set<string>();
}

async function enrichImportance(replies: ReplyRecord[]): Promise<void> {
  for (const r of replies) {
    if (!r.userId) {
      r.importanceScore = 0;
      continue;
    }
    try {
      r.importanceScore = await calculateImportanceScore(r.userId);
    } catch (err) {
      console.warn(`[${ts()}] ⚠️ importance lookup failed for user ${r.userId}: ${String(err)}`);
      r.importanceScore = 0;
    }
  }
}

async function main() {
  const { campaignId, batchSize, maxReplies, outputPath } = parseArgs();

  console.log(`[${ts()}] 🚀 Reply narrative scan starting for campaign ${campaignId}`);

  const collection = await getRepliesCollection();
  const cursor = collection
    .find({ campaign_id: campaignId })
    .sort({ created_at: 1 });

  const dedupReplyIds = new Set<string>();
  const replies: ReplyRecord[] = [];

  for await (const doc of cursor) {
    const replyId = doc.reply_tweet_id;
    if (!replyId || dedupReplyIds.has(replyId)) continue;
    dedupReplyIds.add(replyId);

    replies.push({
      tweetId: replyId,
      parentTweetId: doc.parent_tweet_id,
      text: doc.text || '',
      authorUsername: doc.author?.username || '',
      authorName: doc.author?.name,
      userId: doc.author?.user_id,
      viewCount: typeof doc.metrics?.viewCount === 'number' ? doc.metrics.viewCount : undefined,
      importanceScore: 0,
    });

    if (maxReplies && replies.length >= maxReplies) {
      console.log(`[${ts()}] Reached maxReplies=${maxReplies}, stopping collection.`);
      break;
    }
  }

  console.log(
    `[${ts()}] Loaded ${replies.length} unique replies from DB for campaign ${campaignId} (deduped by tweet_id).`
  );

  if (!replies.length) {
    console.log(`[${ts()}] No replies collected; exiting.`);
    process.exit(0);
  }

  console.log(`[${ts()}] Enriching importance scores from ranker...`);
  await enrichImportance(replies);

  console.log(`[${ts()}] Running LLM filtering in batches of ${batchSize}...`);
  const batches = chunk(replies, batchSize);
  const matchedIds = new Set<string>();

  for (const batch of batches) {
    try {
      const ids = await filterMatchesWithLlm(batch);
      ids.forEach((id) => matchedIds.add(id));
      await sleep(500); // small gap between API calls to reduce rate-limit risk
    } catch (err) {
      console.warn(`[${ts()}] ⚠️ LLM batch failed: ${String(err)}`);
    }
  }

  const matchedReplies = replies.filter((r) => matchedIds.has(r.tweetId));
  const totalViews = matchedReplies.reduce((acc, r) => acc + (r.viewCount || 0), 0);

  matchedReplies.sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));

  const report = {
    campaign_id: campaignId,
    generated_at: ts(),
    scanned_replies: replies.length,
    matched_replies: matchedReplies.length,
    total_views: totalViews,
    matches: matchedReplies.map((r) => ({
      tweet_id: r.tweetId,
      parent_tweet_id: r.parentTweetId,
      author_username: r.authorUsername,
      author_name: r.authorName,
      importance_score: r.importanceScore ?? 0,
      view_count: r.viewCount ?? null,
      url: `https://twitter.com/i/web/status/${r.tweetId}`,
      text: r.text,
    })),
  };

  const outPath =
    outputPath ||
    path.join(process.cwd(), `reply-narrative-report-${campaignId}-${Date.now()}.json`);

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(
    `[${ts()}] ✅ Done. Matches: ${matchedReplies.length}/${replies.length}. Total views: ${totalViews.toLocaleString()}.`
  );
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


