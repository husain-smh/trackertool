#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import { getTwitterApiConfig } from '../src/lib/config/twitter-api-config';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * Send DM Campaign Script
 * 
 * Usage:
 *   npx tsx scripts/send-dm-campaign.ts --users <users-file> [--messages <messages-file>] [--dry-run]
 * 
 * Requirements:
 *   - .env with:
 *     - TWITTER_API_KEY
 *     - TWITTER_LOGIN_COOKIES (from /twitter/user_login_v2)
 *     - TWITTER_PROXY (http://user:pass@ip:port)
 *   - Reachout messages.txt (default) or specified file
 *   - List of usernames/URLs in a text file
 */

const ARGS = process.argv.slice(2);
const USERS_FILE_IDX = ARGS.indexOf('--users');
const MESSAGES_FILE_IDX = ARGS.indexOf('--messages');
const DRY_RUN = ARGS.includes('--dry-run');
const HELP = ARGS.includes('--help') || ARGS.includes('-h');

const USERS_FILE = USERS_FILE_IDX !== -1 ? ARGS[USERS_FILE_IDX + 1] : null;
const MESSAGES_FILE = MESSAGES_FILE_IDX !== -1 ? ARGS[MESSAGES_FILE_IDX + 1] : 'Reachout messages.txt';

// Configuration constants
const DEFAULT_MIN_DELAY_MS = 30000; // Minimum 30 seconds
const DEFAULT_MAX_DELAY_MS = 120000; // Maximum 2 minutes
const JITTER_FACTOR = 0.2; // 20% jitter

function ts(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function parseArgValue(name: string): string | null {
  const idx = ARGS.indexOf(name);
  if (idx !== -1 && ARGS[idx + 1]) return String(ARGS[idx + 1]);

  const byEq = ARGS.find((a) => a.startsWith(`${name}=`));
  if (byEq) return String(byEq.split('=').slice(1).join('=') || '');

  return null;
}

function parseIntArg(name: string, fallback: number): number {
  const raw = parseArgValue(name);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function applyJitter(ms: number, jitterFactor: number): number {
  const jf = Math.max(0, Math.min(0.9, jitterFactor));
  const delta = ms * jf;
  const jitter = (Math.random() * 2 - 1) * delta; // [-delta, +delta]
  return Math.max(0, Math.round(ms + jitter));
}

function printHelpAndExit(exitCode: number): never {
  const msg = [
    'Twitter DM Campaign Script',
    '',
    'Usage:',
    '  npx tsx scripts/send-dm-campaign.ts --users <users-file> [--messages <messages-file>] [--dry-run]',
    '',
    'Required env (.env):',
    '  - TWITTER_API_KEY (or TWITTER_API_KEY_SHARED / TWITTER_API_KEY_MONITOR via config)',
    '  - TWITTER_LOGIN_COOKIES  (from /twitter/user_login_v2)',
    '  - TWITTER_PROXY          (http://username:password@ip:port)',
    '',
    'Control knobs (optional):',
    `  --minDelayMs <ms>     Delay between DMs (min). Default: ${DEFAULT_MIN_DELAY_MS}`,
    `  --maxDelayMs <ms>     Delay between DMs (max). Default: ${DEFAULT_MAX_DELAY_MS}`,
    `  --timeoutMs <ms>      Per-request timeout. Default: config.requestTimeout (from twitter-api-config)`,
    `  --maxRetries <n>       Retries for transient failures (429/5xx/network). Default: config.maxRetries`,
    `  --retryDelayMs <ms>   Base delay for retries (used with backoff). Default: config.retryDelay`,
    `  --jitter <0..0.9>     Random jitter applied to sleep interval. Default: ${JITTER_FACTOR}`,
    '',
    'Notes:',
    '  - Script is sequential (no concurrency).',
    '  - It resolves user IDs via /twitter/user/info then sends DMs via /twitter/send_dm_to_user.',
    '  - If your network has certificate/DNS issues, it automatically falls back to DoH+forced IP (secure).',
  ].join('\n');

  console.log(msg);
  process.exit(exitCode);
}

type RuntimeOpts = {
  minDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  jitter: number;
};

// Initialized in main() before any network calls.
let runtime: RuntimeOpts = {
  minDelayMs: DEFAULT_MIN_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  timeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 2000,
  jitter: JITTER_FACTOR,
};

type CloudflareDnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ name?: string; type?: number; TTL?: number; data?: string }>;
};

function isLikelyIpv4(value: string): boolean {
  if (!value) return false;
  const parts = value.trim().split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

let cachedDohA: { hostname: string; ip: string; expiresAtMs: number } | null = null;
let preferDohForTwitterApiIo = false;
async function resolveAWithCloudflareDoh(hostname: string): Promise<string | null> {
  // Cache for 10 minutes to avoid per-request DoH overhead.
  const now = Date.now();
  if (cachedDohA && cachedDohA.hostname === hostname && cachedDohA.expiresAtMs > now) {
    return cachedDohA.ip;
  }

  const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const res = await fetch(dohUrl, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as CloudflareDnsJsonResponse | null;
  const answers = Array.isArray(json?.Answer) ? json!.Answer! : [];
  const ips = answers
    .filter((a) => a?.type === 1 && typeof a?.data === 'string')
    .map((a) => String(a.data).trim())
    .filter(isLikelyIpv4);

  const ip = ips[0] ?? null;
  if (ip) {
    cachedDohA = { hostname, ip, expiresAtMs: now + 10 * 60 * 1000 };
  }
  return ip;
}

function isTlsCertVerifyError(err: any): boolean {
  const code = err?.cause?.code ?? err?.code;
  const msg = String(err?.cause?.message ?? err?.message ?? '');
  return (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    msg.includes('unable to verify the first certificate') ||
    msg.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE') ||
    msg.includes('Could not establish trust relationship') ||
    msg.includes('self signed certificate')
  );
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function httpsRequestText(inputUrl: string, opts: {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  timeoutMs: number;
  body?: string;
  lookupIp?: string | null;
}): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const u = new URL(inputUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const result = await new Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }>(
      (resolve, reject) => {
        const lookup =
          opts.lookupIp && isLikelyIpv4(opts.lookupIp)
            ? ((_: string, optionsOrCb: any, maybeCb?: any) => {
                const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
                const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
                if (typeof cb !== 'function') {
                  throw new Error('lookup callback missing');
                }
                if (options?.all) {
                  cb(null, [{ address: opts.lookupIp, family: 4 }]);
                  return;
                }
                cb(null, opts.lookupIp, 4);
              })
            : undefined;

        const req = https.request(
          {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port ? Number(u.port) : undefined,
            path: `${u.pathname}${u.search}`,
            method: opts.method,
            headers: opts.headers,
            signal: controller.signal,
            lookup,
            // Keep SNI/host verification tied to the original hostname.
            servername: u.hostname,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
            res.on('end', () => {
              const body = Buffer.concat(chunks).toString('utf8');
              resolve({ statusCode: res.statusCode ?? 0, body, headers: res.headers as any });
            });
          },
        );

        req.on('error', reject);
        if (opts.method === 'POST' && typeof opts.body === 'string') {
          req.write(opts.body);
        }
        req.end();
      },
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestJsonWithTlsFallback(inputUrl: string, opts: {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  timeoutMs: number;
  body?: string;
  maxRetries: number;
  retryDelayMs: number;
}): Promise<{ statusCode: number; json: any; rawText: string; headers: Record<string, string | string[] | undefined> }> {
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    try {
      const u = new URL(inputUrl);
      const lookupIp =
        preferDohForTwitterApiIo && u.hostname === 'api.twitterapi.io'
          ? await resolveAWithCloudflareDoh(u.hostname)
          : null;

      // Fast path (system DNS).
      let resp = await httpsRequestText(inputUrl, {
        method: opts.method,
        headers: opts.headers,
        timeoutMs: opts.timeoutMs,
        body: opts.body,
        lookupIp: lookupIp || undefined,
      });

      // Handle 429 / 5xx with backoff (retryable).
      if (resp.statusCode === 429 || resp.statusCode >= 500) {
        if (attempt < opts.maxRetries) {
          const retryAfterRaw = resp.headers?.['retry-after'];
          const retryAfterStr = Array.isArray(retryAfterRaw) ? retryAfterRaw[0] : retryAfterRaw;
          const retryAfter = parseInt(String(retryAfterStr || '0'), 10);
          const backoff = Math.pow(2, attempt + 1) * 1000;
          const waitMs = Math.max(opts.retryDelayMs, retryAfter > 0 ? retryAfter * 1000 : 0, backoff);
          await sleep(waitMs);
          continue;
        }
      }

      // If TLS verification fails, try DoH+forced IP for api.twitterapi.io.
      // NOTE: We do NOT disable TLS verification (no rejectUnauthorized=false).
      const json = safeJsonParse<any>(resp.body || '{}', {});
      return { statusCode: resp.statusCode, json, rawText: resp.body || '', headers: resp.headers };
    } catch (error) {
      // Special case: local DNS sinkholes / MITM often break TLS verification.
      if (isTlsCertVerifyError(error)) {
        try {
          const u = new URL(inputUrl);
          if (u.hostname === 'api.twitterapi.io') {
            preferDohForTwitterApiIo = true;
            const ip = await resolveAWithCloudflareDoh(u.hostname);
            if (ip) {
              const resp = await httpsRequestText(inputUrl, {
                method: opts.method,
                headers: opts.headers,
                timeoutMs: opts.timeoutMs,
                body: opts.body,
                lookupIp: ip,
              });
              const json = safeJsonParse<any>(resp.body || '{}', {});
              return { statusCode: resp.statusCode, json, rawText: resp.body || '', headers: resp.headers };
            }
          }
        } catch {
          // fall through to retry below
        }
      }

      const err = error as any;
      const netCode = err?.cause?.code ?? err?.code;
      const isNetworkish =
        (error instanceof Error && error.name === 'AbortError') ||
        isTlsCertVerifyError(error) ||
        ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(String(netCode || ''));

      if (attempt < opts.maxRetries && isNetworkish) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        await sleep(Math.max(opts.retryDelayMs, backoff));
        continue;
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error('Retries exhausted');
}

function getLoginCookies(): string {
  const cookies = process.env.TWITTER_LOGIN_COOKIES;
  if (!cookies) {
    throw new Error('TWITTER_LOGIN_COOKIES not found in environment variables. Please set it using cookies from /twitter/user_login_v2.');
  }
  return cookies;
}

function getProxy(): string {
  const proxy = process.env.TWITTER_PROXY;
  if (!proxy) {
    throw new Error('TWITTER_PROXY not found in environment variables. Format: http://username:password@ip:port');
  }
  return proxy;
}

function parseUsername(input: string): string {
  // Handle full URLs like https://x.com/username or https://twitter.com/username
  try {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      return parts[0];
    }
  } catch (e) {
    // Not a URL, assume username
  }
  return input.replace('@', '').trim();
}

async function getUserId(username: string): Promise<string | null> {
  const config = getTwitterApiConfig();
  if (!config.apiKey) {
    throw new Error('TWITTER_API_KEY not configured.');
  }

  const url = new URL(`${config.apiUrl}/twitter/user/info`);
  url.searchParams.set('userName', username);

  console.log(`[${ts()}] 🔍 Resolving User ID for @${username}...`);

  try {
    const headers = {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    };

    const resp = await requestJsonWithTlsFallback(url.toString(), {
      method: 'GET',
      headers,
      timeoutMs: runtime.timeoutMs,
      maxRetries: runtime.maxRetries,
      retryDelayMs: runtime.retryDelayMs,
    });

    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      console.error(
        `[${ts()}] ❌ Failed to fetch user info for @${username}. Status: ${resp.statusCode} Body: ${resp.rawText}`
      );
      return null;
    }

    const data = resp.json as any;
    // Check various possible locations for ID in response (adjust based on actual API response if needed)
    const id = data?.data?.id || data?.id || data?.user?.id;
    
    if (!id) {
      console.error(`[${ts()}] ❌ User ID not found in response for @${username}.`);
      return null;
    }

    return String(id);
  } catch (error) {
    console.error(`[${ts()}] ❌ Error fetching user info for @${username}:`, error);
    return null;
  }
}

async function sendDm(userId: string, username: string, message: string): Promise<boolean> {
  const config = getTwitterApiConfig();
  const cookies = getLoginCookies();
  const proxy = getProxy();

  const url = `${config.apiUrl}/twitter/send_dm_to_user`;

  if (DRY_RUN) {
    console.log(`[${ts()}] 🧪 [DRY RUN] Would send DM to @${username} (${userId}): "${message.substring(0, 50)}..."`);
    return true;
  }

  console.log(`[${ts()}] 📨 Sending DM to @${username} (${userId})...`);

  try {
    const body = {
      login_cookies: cookies,
      user_id: userId,
      text: message,
      proxy: proxy,
    };

    const headers = {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    };

    const resp = await requestJsonWithTlsFallback(url, {
      method: 'POST',
      headers,
      timeoutMs: runtime.timeoutMs,
      body: JSON.stringify(body),
      maxRetries: runtime.maxRetries,
      retryDelayMs: runtime.retryDelayMs,
    });

    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      console.error(
        `[${ts()}] ❌ Failed to send DM to @${username}. Status: ${resp.statusCode} Body: ${resp.rawText}`
      );
      return false;
    }

    const data = resp.json as any;
    if (data.status === 'success' || data.message_id) {
        console.log(`[${ts()}] ✅ DM sent successfully to @${username}. ID: ${data.message_id}`);
        return true;
    } else {
        console.error(`[${ts()}] ❌ API returned error for @${username}:`, data);
        return false;
    }

  } catch (error) {
    console.error(`[${ts()}] ❌ Error sending DM to @${username}:`, error);
    return false;
  }
}

async function main() {
  console.log(`[${ts()}] 🚀 Twitter DM Campaign Script`);

  if (HELP) {
    printHelpAndExit(0);
  }
  
  if (!USERS_FILE) {
    console.error('❌ Please provide a users file using --users <file>');
    console.log('Usage: npx tsx scripts/send-dm-campaign.ts --users users.txt [--messages messages.txt]');
    process.exit(1);
  }

  // Runtime knobs (CLI overrides config defaults)
  const config = getTwitterApiConfig();
  runtime = {
    minDelayMs: clampInt(parseIntArg('--minDelayMs', DEFAULT_MIN_DELAY_MS), 0, 24 * 60 * 60 * 1000),
    maxDelayMs: clampInt(parseIntArg('--maxDelayMs', DEFAULT_MAX_DELAY_MS), 0, 24 * 60 * 60 * 1000),
    timeoutMs: clampInt(parseIntArg('--timeoutMs', config.requestTimeout), 1000, 5 * 60 * 1000),
    maxRetries: clampInt(parseIntArg('--maxRetries', config.maxRetries), 0, 10),
    retryDelayMs: clampInt(parseIntArg('--retryDelayMs', config.retryDelay), 0, 5 * 60 * 1000),
    jitter: Math.max(0, Math.min(0.9, Number(parseArgValue('--jitter') ?? JITTER_FACTOR))),
  };

  // Ensure min <= max
  if (runtime.maxDelayMs < runtime.minDelayMs) {
    const tmp = runtime.minDelayMs;
    runtime.minDelayMs = runtime.maxDelayMs;
    runtime.maxDelayMs = tmp;
  }

  // 1. Read Messages
  let messages: string[] = [];
  try {
    const msgContent = fs.readFileSync(MESSAGES_FILE, 'utf-8');
    // Split by double newline or some separator? Assuming one message per line for now or specific separator
    // If messages are multi-line, we need a delimiter. 
    // Assuming simple line-based messages for now, filtering empty lines.
    messages = msgContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    
    if (messages.length === 0) {
      throw new Error('No messages found in file.');
    }
    console.log(`[${ts()}] 📝 Loaded ${messages.length} messages from ${MESSAGES_FILE}`);
  } catch (error) {
    console.error(`[${ts()}] ❌ Failed to read messages file:`, error);
    process.exit(1);
  }

  // 2. Read Users
  let users: string[] = [];
  try {
    const userContent = fs.readFileSync(USERS_FILE, 'utf-8');
    users = userContent.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    console.log(`[${ts()}] 👥 Loaded ${users.length} users from ${USERS_FILE}`);
  } catch (error) {
    console.error(`[${ts()}] ❌ Failed to read users file:`, error);
    process.exit(1);
  }

  // Validate Env
  try {
    getLoginCookies();
    getProxy();
    getTwitterApiConfig().apiKey || (() => { throw new Error('TWITTER_API_KEY missing'); })();
  } catch (e: any) {
    console.error(`[${ts()}] ❌ Configuration Error: ${e.message}`);
    process.exit(1);
  }

  console.log(`[${ts()}] ⏳ Starting campaign...`);
  console.log(
    `[${ts()}] ⚙️  Delay settings: ${Math.round(runtime.minDelayMs / 1000)}s - ${Math.round(runtime.maxDelayMs / 1000)}s (jitter=${runtime.jitter})`
  );
  console.log(`[${ts()}] ⚙️  Retries: maxRetries=${runtime.maxRetries} retryDelayMs=${runtime.retryDelayMs} timeoutMs=${runtime.timeoutMs}`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < users.length; i++) {
    const rawUser = users[i];
    const username = parseUsername(rawUser);

    console.log(`\n--------------------------------------------------`);
    console.log(`[${ts()}] [${i + 1}/${users.length}] Processing: ${rawUser} -> @${username}`);

    // Resolve ID
    const userId = await getUserId(username);
    if (!userId) {
      console.log(`[${ts()}] ⏭️  Skipping @${username} (could not resolve ID)`);
      failCount++;
      continue;
    }

    // Pick Random Message
    const message = messages[Math.floor(Math.random() * messages.length)];

    // Send DM
    const sent = await sendDm(userId, username, message);
    if (sent) {
      successCount++;
    } else {
      failCount++;
    }

    // Wait before next (unless last)
    if (i < users.length - 1) {
      const baseDelay = getRandomDelay(runtime.minDelayMs, runtime.maxDelayMs);
      const delay = applyJitter(baseDelay, runtime.jitter);
      console.log(`[${ts()}] 💤 Sleeping for ${Math.round(delay / 1000)}s...`);
      await sleep(delay);
    }
  }

  console.log(`\n==================================================`);
  console.log(`[${ts()}] 🏁 Campaign Finished`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
