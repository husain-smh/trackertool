/**
 * User About API integration for fetching accurate location data
 * API: https://api.twitterapi.io/twitter/user_about
 * 
 * This endpoint provides accurate location data (account_based_in) which is
 * more reliable than the user-provided location field.
 */

import { getTwitterApiKey, type TwitterApiKeyType } from '../config/twitter-api-config';
import { TwitterApiError } from '../external-api';
import https from 'node:https';
import { URL } from 'node:url';

export interface UserAboutResponse {
  status: 'success' | 'error';
  msg?: string;
  data?: {
    id: string;
    name: string;
    userName: string;
    createdAt: string;
    isBlueVerified: boolean;
    protected: boolean;
    about_profile?: {
      account_based_in?: string;
      location_accurate?: boolean;
      learn_more_url?: string;
      affiliate_username?: string;
      source?: string;
      username_changes?: {
        count?: string;
        last_changed_at_msec?: string;
      };
    };
    affiliates_highlighted_label?: any;
    identity_profile_labels_highlighted_label?: any;
  };
}

type CloudflareDnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ name?: string; type?: number; TTL?: number; data?: string }>;
};

function isLikelyIpv4(value: string): boolean {
  // Basic IPv4 check; good enough for DoH JSON results.
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
    msg.includes('unable to verify the first certificate') ||
    msg.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')
  );
}

function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function httpsGetText(inputUrl: string, opts: { headers: Record<string, string>; timeoutMs: number; lookupIp?: string | null }) {
  const u = new URL(inputUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const lookup =
        opts.lookupIp && isLikelyIpv4(opts.lookupIp)
          ? ((_: string, optionsOrCb: any, maybeCb?: any) => {
              // Node's lookup signature is overloaded:
              // - (hostname, options, callback)
              // - (hostname, callback)
              const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
              const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
              if (typeof cb !== 'function') {
                throw new Error('lookup callback missing');
              }

              // https.request internally calls dns.lookup with { all: true } in many cases.
              // In that mode, the callback signature is (err, addresses[]) not (err, address, family).
              if (options?.all) {
                cb(null, [{ address: opts.lookupIp, family: 4 }]);
                return;
              }

              cb(null, opts.lookupIp, 4);
            }) // Force IPv4 to the resolved IP
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
          // If lookupIp is provided, we bypass the system resolver (helps when local DNS is sinkholed).
          lookup,
          // Keep SNI/host verification tied to the original hostname.
          servername: u.hostname,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({ statusCode: res.statusCode ?? 0, body });
          });
        },
      );

      req.on('error', reject);
      req.end();
    });

    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch user about information including accurate location data
 * 
 * @param username - The Twitter username (without @)
 * @param retries - Number of retries (default: 2)
 * @param keyType - Which API key to use: 'monitor' (dedicated) or 'shared' (batch operations)
 * @returns UserAboutResponse with account_based_in location data
 */
export async function fetchUserAbout(
  username: string,
  retries: number = 2,
  keyType: TwitterApiKeyType = 'shared'
): Promise<UserAboutResponse> {
  const apiKey = getTwitterApiKey(keyType);
  
  if (!apiKey) {
    throw new TwitterApiError(
      'Twitter API key is not configured. Set TWITTER_API_KEY_MONITOR, TWITTER_API_KEY_SHARED, or TWITTER_API_KEY.',
      500,
      false
    );
  }
  
  // Remove @ if present
  const cleanUsername = username.replace(/^@/, '');
  
  const apiUrl = process.env.TWITTER_API_URL || 'https://api.twitterapi.io';
  const url = `${apiUrl}/twitter/user_about?userName=${encodeURIComponent(cleanUsername)}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      };

      const u = new URL(url);
      const lookupIp =
        preferDohForTwitterApiIo && u.hostname === 'api.twitterapi.io'
          ? await resolveAWithCloudflareDoh(u.hostname)
          : null;

      // First try system DNS (fast path). If TLS verification fails (common with DNS sinkholes),
      // fall back once to Cloudflare DoH to resolve the real IP and retry.
      const resp = await httpsGetText(url, { headers, timeoutMs: 30000, lookupIp: lookupIp || undefined });
      if (resp.statusCode === 0) {
        throw new Error('Empty response from HTTPS request');
      }

      // If we got a TLS verification error, try DoH-based lookup (only for the expected host).
      // Note: httpsGetText throws on network/TLS errors, so this block is mostly a second line of defense.

      // Handle different HTTP status codes
      if (resp.statusCode === 429) {
        // Rate limit - retryable but wait a bit
        if (attempt < retries) {
          const backoffDelay = Math.pow(2, attempt + 1) * 1000; // Exponential backoff: 2s, 4s, 8s
          console.warn(`[user-about] Rate limited (429), backing off ${backoffDelay}ms before retry ${attempt + 1}/${retries}`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        throw new TwitterApiError(
          'Twitter API rate limit exceeded. Please try again later.',
          429,
          true,
          undefined,
          { operation: 'fetchUserAbout', retryAfter: 60 }
        );
      }
      
      if (resp.statusCode === 404) {
        // User not found - not retryable
        throw new TwitterApiError(
          `User @${cleanUsername} not found. They may have been deleted or suspended.`,
          404,
          false
        );
      }
      
      if (resp.statusCode === 401 || resp.statusCode === 403) {
        // Authentication error - not retryable
        throw new TwitterApiError(
          'Twitter API authentication failed. Please check your API key.',
          resp.statusCode,
          false
        );
      }
      
      if (resp.statusCode === 402) {
        // Payment required - credits exhausted
        const errorData = safeJsonParse<any>(resp.body || '{}', {});
        const message = (errorData as any)?.message || 'Twitter API credits exhausted';
        throw new TwitterApiError(
          `Twitter API credits insufficient: ${message}. Please recharge your account.`,
          402,
          false
        );
      }
      
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        // Other HTTP errors
        const errorText = resp.body || 'Unknown error';
        throw new TwitterApiError(
          `Twitter API responded with status ${resp.statusCode}: ${errorText}`,
          resp.statusCode,
          resp.statusCode >= 500 // Server errors are retryable
        );
      }
      
      const data: UserAboutResponse = safeJsonParse<UserAboutResponse>(resp.body || '{}', { status: 'error', msg: 'Invalid JSON response from Twitter API' });
      
      if (data.status === 'error') {
        // API returned error status
        const errorMessage = data.msg || 'Twitter API returned an error';
        const normalized = errorMessage.trim().toLowerCase();

        // Some providers return "user not found" as a successful HTTP response with an error payload.
        // Treat that as a real 404 so callers can mark the user as processed and avoid infinite re-tries.
        if (
          normalized === 'user not found' ||
          normalized.includes('user not found') ||
          normalized.includes('not found')
        ) {
          throw new TwitterApiError(errorMessage, 404, false);
        }

        throw new TwitterApiError(errorMessage, 400, false);
      }
      
      if (!data.data) {
        throw new TwitterApiError(
          `No user data found for @${cleanUsername}`,
          404,
          false
        );
      }
      
      return data;
    } catch (error) {
      const err = error as any;
      const debugContext = {
        operation: 'fetchUserAbout',
        username: cleanUsername,
        keyType,
        attempt: attempt + 1,
        retries,
        url,
        errorName: err?.name,
        errorMessage: err?.message,
        // Node 18+/20+ may attach a `cause` for network/TLS/DNS failures.
        errorCause: err?.cause instanceof Error ? err.cause.message : err?.cause,
      };

      // If it's a TwitterApiError and not retryable, throw immediately
      if (error instanceof TwitterApiError && !error.isRetryable) {
        throw error;
      }

      // Special case: local DNS sinkholes / MITM often break TLS verification.
      // We can usually fix this by bypassing system DNS via Cloudflare DoH (no admin needed).
      if (isTlsCertVerifyError(error)) {
        try {
          const u = new URL(url);
          if (u.hostname === 'api.twitterapi.io') {
            preferDohForTwitterApiIo = true;
            const ip = await resolveAWithCloudflareDoh(u.hostname);
            if (ip) {
              const headers = {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json',
              };
              const resp = await httpsGetText(url, { headers, timeoutMs: 30000, lookupIp: ip });

              if (resp.statusCode >= 200 && resp.statusCode < 300) {
                const data: UserAboutResponse = safeJsonParse<UserAboutResponse>(
                  resp.body || '{}',
                  { status: 'error', msg: 'Invalid JSON response from Twitter API' },
                );
                if (data?.status === 'success' && data.data) return data;
              }
            }
          }
        } catch {
          // Fall through to normal retry handling below.
        }
      }
      
      // If it's a timeout or network error, retry if attempts remain
      const netCode = err?.cause?.code ?? err?.code;
      const isNetworkError =
        (error instanceof Error && error.name === 'AbortError') ||
        isTlsCertVerifyError(error) ||
        ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(String(netCode || ''));

      if (isNetworkError) {
        if (attempt < retries) {
          const backoffDelay = Math.pow(2, attempt + 1) * 1000;
          console.warn(
            `[user-about] Network error on attempt ${attempt + 1}, backing off ${backoffDelay}ms before retry`,
            debugContext,
          );
          // Log the original error object for full details (stack/cause) WITHOUT leaking API keys.
          console.warn('[user-about] Network error (raw)', error);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
          continue;
        }
        console.warn('[user-about] Network error (final, no retries left)', debugContext);
        console.warn('[user-about] Network error (raw, final)', error);
        throw new TwitterApiError(
          'Network error: Failed to connect to Twitter API',
          0,
          true
        );
      }
      
      // If it's a retryable error and we have attempts left, retry
      if (error instanceof TwitterApiError && error.isRetryable && attempt < retries) {
        const backoffDelay = Math.pow(2, attempt + 1) * 1000;
        console.warn(
          `[user-about] Retryable error on attempt ${attempt + 1}, backing off ${backoffDelay}ms before retry`,
          debugContext,
        );
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      
      // Re-throw if we've exhausted retries or it's not retryable
      throw error instanceof TwitterApiError
        ? error
        : new TwitterApiError(
            error instanceof Error ? error.message : 'Failed to fetch user about from external API',
            500,
            true
          );
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw new TwitterApiError('Failed to fetch user about after retries', 500, false);
}

/**
 * Extract account_based_in location from user about response
 * 
 * @param response - UserAboutResponse from API
 * @returns The account_based_in location string, or undefined if not available
 */
export function extractAccountBasedIn(response: UserAboutResponse): string | undefined {
  return response.data?.about_profile?.account_based_in;
}

