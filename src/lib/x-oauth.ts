/**
 * Social Capital X OAuth + Liking Users helpers (official X API).
 *
 * This is a focused module used by the tweet engagement page to:
 * - generate OAuth authorization URLs (PKCE)
 * - exchange/refresh tokens
 * - fetch liking users via /2/tweets/:id/liking_users
 */

import crypto from 'crypto';
import {
  decryptToken,
  getXOAuthByClientId,
  updateXOAuthLastUsed,
  updateXOAuthStatus,
  updateXOAuthTokens,
} from './models/x-oauth';

// ===== Config =====

const X_AUTH_URL = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const X_USER_ME_URL = 'https://api.x.com/2/users/me';
const X_TWEETS_URL = 'https://api.x.com/2/tweets';

export const REQUIRED_SCOPES = ['tweet.read', 'users.read', 'like.read', 'offline.access'];

/**
 * Short-lived cookie used to persist PKCE state across server instances.
 * This avoids "state missing/expired" when running behind load balancers
 * or serverless platforms (where in-memory Maps are not shared).
 */
export const OAUTH_STATE_COOKIE_NAME = 'idlab_x_oauth_state';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} environment variable is not set`);
  return v;
}

function getEnvWithFallback(primary: string, fallback: string): string {
  return process.env[primary] || process.env[fallback] || '';
}

function requireEnvWithFallback(primary: string, fallback: string): string {
  const v = getEnvWithFallback(primary, fallback);
  if (!v) {
    throw new Error(`${primary} (or ${fallback}) environment variable is not set`);
  }
  return v;
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(Buffer.from(value, 'utf8'));
}

function getOAuthStateSigningKey(): Buffer {
  // Preferred explicit secret (any string).
  const secret = process.env.OAUTH_STATE_SECRET;
  if (secret) return Buffer.from(secret, 'utf8');

  // Fallback: reuse encryption key (hex) if present.
  const encKey = process.env.OAUTH_ENCRYPTION_KEY;
  if (encKey) {
    if (encKey.length !== 64) {
      throw new Error('OAUTH_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(encKey, 'hex');
  }

  throw new Error('OAUTH_STATE_SECRET (or OAUTH_ENCRYPTION_KEY) environment variable is not set');
}

// ===== PKCE helpers =====

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function generateCodeVerifier(): string {
  return base64UrlEncode(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ===== Temporary OAuth state store (10 min TTL) =====

interface OAuthStateData {
  codeVerifier: string;
  clientId: string;
  returnTo?: string;
  expiresAt: number;
}

const oauthStateStore = new Map<string, OAuthStateData>();

setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (data.expiresAt < now) oauthStateStore.delete(state);
  }
}, 5 * 60 * 1000);

function storeOAuthState(state: string, data: Omit<OAuthStateData, 'expiresAt'>): void {
  oauthStateStore.set(state, { ...data, expiresAt: Date.now() + 10 * 60 * 1000 });
}

export function retrieveOAuthState(state: string): Omit<OAuthStateData, 'expiresAt'> | null {
  const data = oauthStateStore.get(state);
  if (!data) return null;
  if (data.expiresAt < Date.now()) {
    oauthStateStore.delete(state);
    return null;
  }
  oauthStateStore.delete(state);
  const { expiresAt: _expiresAt, ...rest } = data;
  return rest;
}

/**
 * Seal OAuth state into a signed, compact cookie payload.
 * Format: base64url(json).base64url(hmacSHA256(payload))
 */
export function sealOAuthStateCookie(data: {
  state: string;
  codeVerifier: string;
  clientId: string;
  returnTo?: string;
  ttlMs?: number;
}): string {
  const ttlMs = data.ttlMs ?? 10 * 60 * 1000;
  const payload = {
    state: data.state,
    codeVerifier: data.codeVerifier,
    clientId: data.clientId,
    returnTo: data.returnTo,
    expiresAt: Date.now() + ttlMs,
  };

  const payloadB64 = base64UrlEncodeString(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getOAuthStateSigningKey()).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

export function unsealOAuthStateCookie(
  cookieValue: string | undefined,
  expectedState: string
): { codeVerifier: string; clientId: string; returnTo?: string } | null {
  if (!cookieValue) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  try {
    const expectedSig = crypto.createHmac('sha256', getOAuthStateSigningKey()).update(payloadB64).digest();
    const expectedSigB64 = base64UrlEncode(expectedSig);
    // Constant-ish time compare (small strings, but avoids obvious timing issues)
    if (expectedSigB64.length !== sigB64.length) return null;
    let mismatch = 0;
    for (let i = 0; i < expectedSigB64.length; i++) mismatch |= expectedSigB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
    if (mismatch !== 0) return null;

    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed = JSON.parse(json) as {
      state: string;
      codeVerifier: string;
      clientId: string;
      returnTo?: string;
      expiresAt: number;
    };

    if (!parsed || parsed.state !== expectedState) return null;
    if (typeof parsed.expiresAt !== 'number' || parsed.expiresAt < Date.now()) return null;
    if (!parsed.codeVerifier || !parsed.clientId) return null;

    return { codeVerifier: parsed.codeVerifier, clientId: parsed.clientId, returnTo: parsed.returnTo };
  } catch {
    return null;
  }
}

// ===== Authorization URL =====

export function generateAuthorizationUrl(params: {
  clientId: string;
  returnTo?: string;
}): { url: string; state: string; codeVerifier: string } {
  // Prefer Social Capital-specific env vars, fallback to shared ones (SOCAP)
  const clientIdEnv = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_ID', 'TWITTER_OAUTH_CLIENT_ID');
  const callbackUrl = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CALLBACK_URL', 'TWITTER_OAUTH_CALLBACK_URL');

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  storeOAuthState(state, {
    codeVerifier,
    clientId: params.clientId,
    returnTo: params.returnTo,
  });

  const qp = new URLSearchParams({
    response_type: 'code',
    client_id: clientIdEnv,
    redirect_uri: callbackUrl,
    scope: REQUIRED_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${X_AUTH_URL}?${qp.toString()}`,
    state,
    codeVerifier,
  };
}

// ===== Token exchange/refresh =====

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenExchangeResult> {
  const clientId = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_ID', 'TWITTER_OAUTH_CLIENT_ID');
  const clientSecret = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_SECRET', 'TWITTER_OAUTH_CLIENT_SECRET');
  const callbackUrl = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CALLBACK_URL', 'TWITTER_OAUTH_CALLBACK_URL');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to exchange code for tokens');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scopes: (data.scope || '').split(' ').filter(Boolean),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenExchangeResult> {
  const clientId = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_ID', 'TWITTER_OAUTH_CLIENT_ID');
  const clientSecret = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_SECRET', 'TWITTER_OAUTH_CLIENT_SECRET');

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${auth}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to refresh token');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
    scopes: (data.scope || '').split(' ').filter(Boolean),
  };
}

export interface TwitterUserInfo {
  id: string;
  username: string;
  name: string;
}

export async function fetchTwitterUserInfo(accessToken: string): Promise<TwitterUserInfo> {
  const response = await fetch(X_USER_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok || !data.data) {
    throw new Error(data.error || 'Failed to fetch user info');
  }
  return {
    id: data.data.id,
    username: data.data.username,
    name: data.data.name,
  };
}

/**
 * Returns a valid access token for the given client_id, refreshing if needed.
 * Returns null if OAuth is missing or refresh fails.
 */
export async function getValidAccessToken(clientId: string): Promise<string | null> {
  const oauth = await getXOAuthByClientId(clientId);
  if (!oauth || oauth.status !== 'active') return null;

  const now = Date.now();
  const expiresAt = oauth.token_expires_at.getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (now + fiveMinutes >= expiresAt) {
    try {
      const refreshToken = decryptToken(oauth.refresh_token_encrypted);
      const newTokens = await refreshAccessToken(refreshToken);
      await updateXOAuthTokens(clientId, newTokens.accessToken, newTokens.refreshToken, newTokens.expiresIn);
      return newTokens.accessToken;
    } catch (e) {
      await updateXOAuthStatus(clientId, 'expired');
      return null;
    }
  }

  try {
    const accessToken = decryptToken(oauth.access_token_encrypted);
    await updateXOAuthLastUsed(clientId);
    return accessToken;
  } catch {
    return null;
  }
}

// ===== Liking Users API (official X API) =====

export interface LikingUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  created_at?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
  verified?: boolean;
}

export interface LikingUsersResponse {
  users: LikingUser[];
  nextToken?: string;
  resultCount: number;
}

export async function fetchLikingUsers(
  tweetId: string,
  accessToken: string,
  options?: { maxResults?: number; paginationToken?: string }
): Promise<LikingUsersResponse> {
  const maxResults = options?.maxResults ?? 100;
  const qp = new URLSearchParams({
    max_results: String(maxResults),
    'user.fields': 'created_at,description,public_metrics,verified',
  });
  if (options?.paginationToken) qp.set('pagination_token', options.paginationToken);

  const url = `${X_TWEETS_URL}/${tweetId}/liking_users?${qp.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '60';
    const err = new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
    (err as any).isRateLimit = true;
    (err as any).retryAfter = parseInt(retryAfter, 10);
    throw err;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || data.title || 'Failed to fetch liking users');
  }

  if (!data.data) {
    return { users: [], resultCount: 0 };
  }

  const users: LikingUser[] = data.data.map((u: any) => ({
    id: u.id,
    username: u.username,
    name: u.name,
    description: u.description,
    created_at: u.created_at,
    public_metrics: u.public_metrics,
    verified: u.verified,
  }));

  return {
    users,
    nextToken: data.meta?.next_token,
    resultCount: data.meta?.result_count ?? users.length,
  };
}

