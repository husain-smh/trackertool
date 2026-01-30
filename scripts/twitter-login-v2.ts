#!/usr/bin/env node

/**
 * Twitter Login V2 Helper (twitterapi.io)
 *
 * Purpose:
 * - Prompts for credentials in the terminal (password/TOTP hidden)
 * - Calls POST /twitter/user_login_v2
 * - Prints login_cookie + a copy/paste line for `.env`:
 *     TWITTER_LOGIN_COOKIES="..."
 *
 * Usage:
 *   npx tsx scripts/twitter-login-v2.ts
 *   npx tsx scripts/twitter-login-v2.ts --proxy http://user:pass@ip:port
 *   npx tsx scripts/twitter-login-v2.ts --keyType shared|monitor
 *
 * Required env (.env):
 *   - TWITTER_API_KEY (or TWITTER_API_KEY_SHARED / TWITTER_API_KEY_MONITOR via config)
 * Optional env:
 *   - TWITTER_PROXY (used if --proxy not provided)
 */

import 'dotenv/config';
import readline from 'node:readline';
import https from 'node:https';
import { URL } from 'node:url';
import { getTwitterApiConfig, type TwitterApiKeyType } from '../src/lib/config/twitter-api-config';

function ts(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ARGS = process.argv.slice(2);
const HELP = ARGS.includes('--help') || ARGS.includes('-h');

function parseArgValue(name: string): string | null {
  const idx = ARGS.indexOf(name);
  if (idx !== -1 && ARGS[idx + 1]) return String(ARGS[idx + 1]);
  const byEq = ARGS.find((a) => a.startsWith(`${name}=`));
  if (byEq) return String(byEq.split('=').slice(1).join('=') || '');
  return null;
}

function normalizeKeyType(raw: string | null): TwitterApiKeyType {
  return raw === 'monitor' ? 'monitor' : 'shared';
}

function printHelpAndExit(code: number): never {
  const msg = [
    'Twitter Login V2 Helper (twitterapi.io)',
    '',
    'Usage:',
    '  npx tsx scripts/twitter-login-v2.ts',
    '  npx tsx scripts/twitter-login-v2.ts --proxy http://user:pass@ip:port',
    '  npx tsx scripts/twitter-login-v2.ts --keyType shared|monitor',
    '',
    'What it does:',
    '  - Prompts for user_name, email, password (hidden), optional totp_secret (hidden)',
    '  - Sends POST /twitter/user_login_v2',
    '  - Prints login_cookie and a .env line to copy/paste into TWITTER_LOGIN_COOKIES',
    '',
    'Notes:',
    '  - This script does NOT write secrets to disk.',
    '  - The printed cookie is sensitive. Don’t commit it.',
  ].join('\n');
  console.log(msg);
  process.exit(code);
}

async function promptLine(rl: readline.Interface, label: string): Promise<string> {
  return new Promise((resolve) => rl.question(label, (answer) => resolve(String(answer ?? '').trim())));
}

async function promptHidden(label: string): Promise<string> {
  // Best-effort "hidden" input for terminals that support raw mode.
  // Falls back to visible input if stdin isn't a TTY.
  if (!process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await promptLine(rl, label);
    } finally {
      rl.close();
    }
  }

  return await new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';

    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (ch: string) => {
      const c = String(ch);
      if (c === '\r' || c === '\n') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        resolve(value);
        return;
      }
      // Ctrl+C
      if (c === '\u0003') {
        stdout.write('\n');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.exit(130);
      }
      // Backspace
      if (c === '\u007f' || c === '\b') {
        if (value.length > 0) value = value.slice(0, -1);
        return;
      }
      value += c;
    };

    stdin.on('data', onData);
  });
}

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
  method: 'POST';
  headers: Record<string, string>;
  timeoutMs: number;
  body: string;
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
            method: 'POST',
            headers: opts.headers,
            signal: controller.signal,
            lookup,
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
        req.write(opts.body);
        req.end();
      },
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postJsonWithTlsFallback(inputUrl: string, opts: {
  headers: Record<string, string>;
  timeoutMs: number;
  body: string;
  maxRetries: number;
  retryDelayMs: number;
}): Promise<{ statusCode: number; json: any; rawText: string }> {
  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    try {
      const u = new URL(inputUrl);
      const lookupIp =
        preferDohForTwitterApiIo && u.hostname === 'api.twitterapi.io'
          ? await resolveAWithCloudflareDoh(u.hostname)
          : null;

      const resp = await httpsRequestText(inputUrl, {
        method: 'POST',
        headers: opts.headers,
        timeoutMs: opts.timeoutMs,
        body: opts.body,
        lookupIp: lookupIp || undefined,
      });

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

      return { statusCode: resp.statusCode, json: safeJsonParse<any>(resp.body || '{}', {}), rawText: resp.body || '' };
    } catch (error) {
      if (isTlsCertVerifyError(error)) {
        try {
          const u = new URL(inputUrl);
          if (u.hostname === 'api.twitterapi.io') {
            preferDohForTwitterApiIo = true;
            const ip = await resolveAWithCloudflareDoh(u.hostname);
            if (ip) {
              const resp = await httpsRequestText(inputUrl, {
                method: 'POST',
                headers: opts.headers,
                timeoutMs: opts.timeoutMs,
                body: opts.body,
                lookupIp: ip,
              });
              return { statusCode: resp.statusCode, json: safeJsonParse<any>(resp.body || '{}', {}), rawText: resp.body || '' };
            }
          }
        } catch {
          // fall through
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

function quoteForEnv(value: string): string {
  // .env supports simple quotes; use JSON-string escape for safety.
  return JSON.stringify(String(value ?? ''));
}

async function main(): Promise<void> {
  if (HELP) {
    printHelpAndExit(0);
  }

  const keyType = normalizeKeyType(parseArgValue('--keyType'));
  const config = getTwitterApiConfig(keyType);
  if (!config.apiKey) {
    console.error(
      `[${ts()}] ❌ Missing Twitter API key. Set TWITTER_API_KEY (or TWITTER_API_KEY_SHARED / TWITTER_API_KEY_MONITOR).`
    );
    process.exit(1);
  }

  const proxyFromArg = parseArgValue('--proxy');
  const proxyFromEnv = process.env.TWITTER_PROXY;
  const proxy = String(proxyFromArg || proxyFromEnv || '').trim();
  if (!proxy) {
    console.error(
      `[${ts()}] ❌ Missing proxy. Provide --proxy http://user:pass@ip:port or set TWITTER_PROXY in .env`
    );
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`[${ts()}] 🔐 Twitter Login V2 (credentials are entered locally; not saved)`);

    const user_name = await promptLine(rl, 'Twitter username (without @): ');
    const email = await promptLine(rl, 'Email: ');
    rl.pause(); // avoid double input streams while using raw-mode prompts
    const password = await promptHidden('Password (hidden): ');
    const totp_secret = await promptHidden('TOTP secret (optional, hidden; press Enter to skip): ');
    rl.resume();

    if (!user_name || !email || !password) {
      console.error(`[${ts()}] ❌ user_name, email, and password are required.`);
      process.exit(1);
    }

    const url = `${config.apiUrl}/twitter/user_login_v2`;
    const body: any = { user_name, email, password, proxy };
    if (String(totp_secret || '').trim().length > 0) {
      body.totp_secret = String(totp_secret).trim();
    }

    const headers = {
      'X-API-Key': config.apiKey,
      'Content-Type': 'application/json',
    };

    console.log(`[${ts()}] 🌐 Logging in via twitterapi.io...`);
    const resp = await postJsonWithTlsFallback(url, {
      headers,
      timeoutMs: config.requestTimeout,
      body: JSON.stringify(body),
      maxRetries: config.maxRetries,
      retryDelayMs: config.retryDelay,
    });

    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      console.error(`[${ts()}] ❌ Login HTTP ${resp.statusCode}: ${resp.rawText}`);
      process.exit(1);
    }

    const data = resp.json as any;
    const login_cookie = String(data?.login_cookie || '').trim();
    const status = String(data?.status || '').trim();
    const msg = String(data?.msg || '').trim();

    if (!login_cookie || (status && status !== 'success')) {
      console.error(`[${ts()}] ❌ Login failed. status=${status || 'unknown'} msg=${msg || 'unknown'}`);
      process.exit(1);
    }

    console.log('');
    console.log('✅ Login success. Here is your login_cookie (sensitive):');
    console.log(login_cookie);
    console.log('');
    console.log('📌 Copy/paste into your `.env` (do NOT commit it):');
    console.log(`TWITTER_LOGIN_COOKIES=${quoteForEnv(login_cookie)}`);
    console.log('');
    console.log('Next: you can use v2 endpoints like /twitter/send_dm_to_user with this cookie.');
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`[${ts()}] Fatal Error:`, err);
  process.exit(1);
});

