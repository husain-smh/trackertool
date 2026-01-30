/**
 * Twitter API helpers for the Network Overlap Tool
 * Uses TwitterAPI.io endpoints
 */

import https from 'node:https';
import { URL } from 'node:url';
import { getTwitterApiConfig, type TwitterApiConfig } from '../../src/lib/config/twitter-api-config';
import type { UserInfo, FollowingUser } from './types';

// Force 10 QPS for this script (must be set before getTwitterApiConfig is called)
process.env.TWITTER_QPS_LIMIT = '10';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let nextAvailableTime = 0;
let limiterChain: Promise<void> = Promise.resolve();

function getConfig(): TwitterApiConfig {
  return getTwitterApiConfig('shared');
}

// DoH (DNS over HTTPS) cache for TLS fallback
let cachedDohA: { hostname: string; ip: string; expiresAtMs: number } | null = null;
let preferDohForTwitterApiIo = false;

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

async function resolveAWithCloudflareDoh(hostname: string): Promise<string | null> {
  const now = Date.now();
  if (cachedDohA && cachedDohA.hostname === hostname && cachedDohA.expiresAtMs > now) {
    return cachedDohA.ip;
  }

  const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const res = await fetch(dohUrl, { headers: { accept: 'application/dns-json' } });
  if (!res.ok) return null;

  type DnsResponse = { Answer?: Array<{ type?: number; data?: string }> };
  const json = (await res.json().catch(() => null)) as DnsResponse | null;
  const answers = Array.isArray(json?.Answer) ? json.Answer : [];
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

async function httpsGetText(
  inputUrl: string,
  opts: { headers: Record<string, string>; timeoutMs: number; lookupIp?: string | null }
) {
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
            method: 'GET',
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
        req.end();
      },
    );

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scheduleGlobalRateLimit(): Promise<void> {
  const config = getConfig();
  const qps = Math.max(0, config.qpsLimit || 10);
  if (qps <= 0) return;

  const interval = Math.ceil(1000 / qps);

  let release: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });

  const previous = limiterChain;
  limiterChain = previous.then(() => current);

  await previous;

  const now = Date.now();
  const waitTime = Math.max(0, nextAvailableTime - now);
  nextAvailableTime = Math.max(now, nextAvailableTime) + interval;

  release!();

  if (waitTime > 0) {
    await sleep(waitTime);
  }
}

async function makeApiRequest(url: string, retries = 0): Promise<any> {
  const config = getConfig();
  await scheduleGlobalRateLimit();

  const headers: Record<string, string> = {
    'X-API-Key': config.apiKey,
    'Content-Type': 'application/json',
  };

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.requestTimeout);

    try {
      const u = new URL(url);

      // If we've had TLS issues before with twitterapi.io, use DoH fallback directly
      if (preferDohForTwitterApiIo && u.hostname === 'api.twitterapi.io') {
        const ip = await resolveAWithCloudflareDoh(u.hostname);
        if (ip) {
          const resp = await httpsGetText(url, { headers, timeoutMs: config.requestTimeout, lookupIp: ip });
          clearTimeout(timeoutId);

          if (resp.statusCode === 429) {
            const retryAfter = parseInt(String(resp.headers['retry-after'] || '5'), 10);
            if (attempt < config.maxRetries) {
              console.log(`\n⏳ Rate limited, waiting ${retryAfter}s...`);
              await sleep(retryAfter * 1000);
              continue;
            }
            throw new Error(`Rate limit exceeded after ${config.maxRetries} retries`);
          }

          if (resp.statusCode === 404) {
            throw new Error('User not found');
          }

          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            return safeJsonParse<any>(resp.body || '{}', {});
          }

          throw new Error(`API error (${resp.statusCode}): ${resp.body}`);
        }
      }

      // Standard fetch path
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
        if (attempt < config.maxRetries) {
          console.log(`\n⏳ Rate limited, waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new Error(`Rate limit exceeded after ${config.maxRetries} retries`);
      }

      if (response.status === 404) {
        throw new Error('User not found');
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication error (${response.status})`);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      // If TLS verification fails, try DoH+forced IP for api.twitterapi.io
      if (isTlsCertVerifyError(error)) {
        try {
          const u = new URL(url);
          if (u.hostname === 'api.twitterapi.io') {
            preferDohForTwitterApiIo = true;
            const ip = await resolveAWithCloudflareDoh(u.hostname);
            if (ip) {
              const resp = await httpsGetText(url, { headers, timeoutMs: config.requestTimeout, lookupIp: ip });
              if (resp.statusCode >= 200 && resp.statusCode < 300) {
                return safeJsonParse<any>(resp.body || '{}', {});
              }
              if (resp.statusCode === 404) {
                throw new Error('User not found');
              }
              // Continue to retry logic below on non-2xx
            }
          }
        } catch (tlsErr) {
          // If it's still a "User not found" error, propagate it
          if (tlsErr instanceof Error && tlsErr.message.includes('not found')) {
            throw tlsErr;
          }
          // Otherwise fallthrough to retry below
        }
      }

      const err = error as any;
      const netCode = err?.cause?.code ?? err?.code;
      const isNetworkish =
        (error instanceof Error && error.name === 'AbortError') ||
        isTlsCertVerifyError(error) ||
        ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(String(netCode || ''));

      // Don't retry "not found" errors
      if (error instanceof Error && error.message.includes('not found')) {
        throw error;
      }

      if (attempt < config.maxRetries && isNetworkish) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.log(`\n⚠️ Request failed, retrying (${attempt + 1}/${config.maxRetries})...`);
        await sleep(Math.max(config.retryDelay, backoff));
        continue;
      }

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error('Retries exhausted');
}

/**
 * Fetch user info by username
 */
export async function fetchUserInfo(username: string): Promise<UserInfo> {
  const config = getConfig();
  const url = new URL(`${config.apiUrl}/twitter/user/info`);
  url.searchParams.set('userName', username);

  const response = await makeApiRequest(url.toString());

  // Response can have data at root level or nested under 'data'
  const data = response.data || response;

  if (!data || !data.id) {
    throw new Error(`User @${username} not found`);
  }

  return {
    id: data.id,
    userName: data.userName || data.username,
    name: data.name,
    followers: parseInt(data.followers || '0', 10),
    following: parseInt(data.following || '0', 10),
    description: data.description,
    location: data.location,
    isBlueVerified: data.isBlueVerified,
    createdAt: data.createdAt,
  };
}

/**
 * Fetch who a user follows (their following list) with pagination
 * Handles pagination properly using cursor and has_next_page
 */
export async function fetchFollowings(
  username: string,
  options: {
    maxPages?: number;
    cursor?: string;
    pageSize?: number;
    onProgress?: (fetched: number, page: number) => void;
  } = {}
): Promise<{ followings: FollowingUser[]; hasMore: boolean; nextCursor?: string }> {
  const config = getConfig();
  const maxPages = options.maxPages || 10000;
  const pageSize = options.pageSize || 200; // Max is 200
  const allFollowings: FollowingUser[] = [];
  let currentCursor = options.cursor;
  let pagesFetched = 0;
  let hasMore = true;

  while (hasMore && pagesFetched < maxPages) {
    const url = new URL(`${config.apiUrl}/twitter/user/followings`);
    url.searchParams.set('userName', username);
    url.searchParams.set('pageSize', pageSize.toString());
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    const data = await makeApiRequest(url.toString());
    const followings = data.followings || [];

    for (const following of followings) {
      if (following.id && (following.userName || following.username)) {
        allFollowings.push({
          id: following.id,
          userName: following.userName || following.username,
          name: following.name || '',
          followers: parseInt(following.followers || '0', 10),
          following: parseInt(following.following || '0', 10),
          description: following.description,
        });
      }
    }

    pagesFetched++;
    options.onProgress?.(allFollowings.length, pagesFetched);

    // Check pagination - use both cursor and has_next_page
    const nextCursor = data.next_cursor || data.nextCursor;
    const hasNextPage = data.has_next_page !== undefined ? data.has_next_page : true;

    currentCursor = nextCursor;

    // Stop if: no more data, no cursor, or API says no more pages
    if (followings.length === 0 || !nextCursor || hasNextPage === false) {
      hasMore = false;
    }

    // Rate limit delay between pages
    if (hasMore && pagesFetched < maxPages) {
      await sleep(100); // Small delay between pages (rate limiter handles QPS)
    }
  }

  return {
    followings: allFollowings,
    hasMore,
    nextCursor: currentCursor,
  };
}
