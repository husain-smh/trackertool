/**
 * Twitter/X OAuth 2.0 Helper Functions
 * 
 * Implements OAuth 2.0 with PKCE (Proof Key for Code Exchange) for the
 * three-legged authentication flow required to access the Liking Users API.
 * 
 * Flow:
 * 1. Generate PKCE codes (code_verifier, code_challenge)
 * 2. Redirect user to Twitter authorization URL
 * 3. Handle callback with authorization code
 * 4. Exchange code for access_token + refresh_token
 * 5. Use tokens to call Twitter API
 * 6. Refresh tokens when they expire
 */

import crypto from 'crypto';
import {
  updateClientOAuthTokens,
  updateClientOAuthStatus,
  getDecryptedRefreshToken,
  getClientOAuthById,
  decryptToken,
  updateClientOAuthLastUsed,
} from '../models/socap/client-oauth';

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

// ===== Configuration =====

const TWITTER_AUTH_URL = 'https://x.com/i/oauth2/authorize';
const TWITTER_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const TWITTER_USER_ME_URL = 'https://api.x.com/2/users/me';
const TWITTER_LIKING_USERS_URL = 'https://api.x.com/2/tweets';

// Required scopes for fetching liking users
export const REQUIRED_SCOPES = [
  'tweet.read',
  'users.read',
  'like.read',
  'offline.access', // Required for refresh tokens
];

// ===== PKCE Helper Functions =====

/**
 * Base64URL encoding (different from regular Base64)
 * - Replace + with -
 * - Replace / with _
 * - Remove = padding
 */
function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a random code verifier (43-128 characters)
 */
export function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

/**
 * Generate code challenge from verifier (SHA-256 hash, base64url encoded)
 */
export function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(
    crypto.createHash('sha256').update(verifier).digest()
  );
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ===== OAuth State Storage =====
// Uses a simple in-memory store with TTL for OAuth state
// In production, you might want to use Redis or a database collection

interface OAuthStateData {
  codeVerifier: string;
  clientId: string;
  expiresAt: number;
}

const oauthStateStore = new Map<string, OAuthStateData>();

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of oauthStateStore.entries()) {
    if (value.expiresAt < now) {
      oauthStateStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Store OAuth state temporarily (expires in 10 minutes)
 */
export function storeOAuthState(state: string, data: Omit<OAuthStateData, 'expiresAt'>): void {
  oauthStateStore.set(state, {
    ...data,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Retrieve and remove OAuth state
 */
export function retrieveOAuthState(state: string): OAuthStateData | null {
  const data = oauthStateStore.get(state);
  if (!data) {
    return null;
  }
  
  // Check if expired
  if (data.expiresAt < Date.now()) {
    oauthStateStore.delete(state);
    return null;
  }
  
  // Remove after retrieval (one-time use)
  oauthStateStore.delete(state);
  return data;
}

// ===== Authorization URL =====

export interface AuthorizationUrlParams {
  clientId: string;
}

export interface AuthorizationUrlResult {
  url: string;
  state: string;
  codeVerifier: string;
}

/**
 * Generate the Twitter authorization URL for a client.
 */
export function generateAuthorizationUrl(params: AuthorizationUrlParams): AuthorizationUrlResult {
  // Support both naming conventions:
  // - SOCAP:   TWITTER_OAUTH_*
  // - IDLabs:  IDLABS_TWITTER_OAUTH_*
  const twitterClientId = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_ID', 'TWITTER_OAUTH_CLIENT_ID');
  const callbackUrl = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CALLBACK_URL', 'TWITTER_OAUTH_CALLBACK_URL');
  
  // Generate PKCE codes
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  // Generate state for CSRF protection
  const state = generateState();
  
  // Store state and verifier for callback
  storeOAuthState(state, {
    codeVerifier,
    clientId: params.clientId,
  });
  
  // Build authorization URL
  const urlParams = new URLSearchParams({
    response_type: 'code',
    client_id: twitterClientId,
    redirect_uri: callbackUrl,
    scope: REQUIRED_SCOPES.join(' '),
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  const url = `${TWITTER_AUTH_URL}?${urlParams.toString()}`;
  
  return {
    url,
    state,
    codeVerifier,
  };
}

// ===== Token Exchange =====

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: string[];
}

/**
 * Exchange authorization code for access and refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenExchangeResult> {
  const clientId = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_ID', 'TWITTER_OAUTH_CLIENT_ID');
  const clientSecret = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_SECRET', 'TWITTER_OAUTH_CLIENT_SECRET');
  const callbackUrl = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CALLBACK_URL', 'TWITTER_OAUTH_CALLBACK_URL');
  
  // Create Basic Auth header (client_id:client_secret in base64)
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(TWITTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${auth}`,
    },
    body: new URLSearchParams({
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl,
      code_verifier: codeVerifier,
    }),
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.access_token) {
    console.error('Token exchange failed:', data);
    throw new Error(data.error_description || data.error || 'Failed to exchange code for tokens');
  }
  
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scopes: (data.scope || '').split(' '),
  };
}

// ===== Token Refresh =====

/**
 * Refresh access token using refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenExchangeResult> {
  const clientId = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_ID', 'TWITTER_OAUTH_CLIENT_ID');
  const clientSecret = requireEnvWithFallback('IDLABS_TWITTER_OAUTH_CLIENT_SECRET', 'TWITTER_OAUTH_CLIENT_SECRET');
  
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(TWITTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${auth}`,
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.access_token) {
    console.error('Token refresh failed:', data);
    throw new Error(data.error_description || data.error || 'Failed to refresh token');
  }
  
  return {
    accessToken: data.access_token,
    // Twitter may return a new refresh token or keep the old one
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
    scopes: (data.scope || '').split(' '),
  };
}

// ===== User Info =====

export interface TwitterUserInfo {
  id: string;
  username: string;
  name: string;
}

/**
 * Fetch the authenticated user's info using their access token.
 */
export async function fetchTwitterUserInfo(accessToken: string): Promise<TwitterUserInfo> {
  const response = await fetch(TWITTER_USER_ME_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.data) {
    console.error('Failed to fetch user info:', data);
    throw new Error(data.error || 'Failed to fetch user info');
  }
  
  return {
    id: data.data.id,
    username: data.data.username,
    name: data.data.name,
  };
}

// ===== Get Valid Access Token =====

/**
 * Get a valid access token for a client, refreshing if necessary.
 * Returns null if no OAuth or refresh fails.
 */
export async function getValidAccessToken(clientId: string): Promise<string | null> {
  const oauth = await getClientOAuthById(clientId);
  
  if (!oauth || oauth.status !== 'active') {
    return null;
  }
  
  const now = Date.now();
  const expiresAt = oauth.token_expires_at.getTime();
  const fiveMinutes = 5 * 60 * 1000;
  
  // Check if token needs refresh (expires within 5 minutes)
  if (now + fiveMinutes >= expiresAt) {
    console.log(`[TwitterOAuth] Access token for ${clientId} expires soon, refreshing...`);
    
    try {
      const refreshToken = decryptToken(oauth.refresh_token_encrypted);
      const newTokens = await refreshAccessToken(refreshToken);
      
      // Update tokens in database
      await updateClientOAuthTokens(
        clientId,
        newTokens.accessToken,
        newTokens.refreshToken,
        newTokens.expiresIn
      );
      
      console.log(`[TwitterOAuth] Successfully refreshed tokens for ${clientId}`);
      return newTokens.accessToken;
    } catch (error) {
      console.error(`[TwitterOAuth] Failed to refresh token for ${clientId}:`, error);
      
      // Mark as expired so we don't keep trying
      await updateClientOAuthStatus(clientId, 'expired');
      return null;
    }
  }
  
  // Token is still valid, decrypt and return
  try {
    const accessToken = decryptToken(oauth.access_token_encrypted);
    await updateClientOAuthLastUsed(clientId);
    return accessToken;
  } catch (error) {
    console.error(`[TwitterOAuth] Failed to decrypt access token for ${clientId}:`, error);
    return null;
  }
}

// ===== Liking Users API =====

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

/**
 * Fetch users who liked a specific tweet.
 * 
 * IMPORTANT: Due to Twitter API privacy restrictions, you can ONLY see likes
 * on tweets authored by the authenticated user (the client).
 */
export async function fetchLikingUsers(
  tweetId: string,
  accessToken: string,
  options?: {
    maxResults?: number;
    paginationToken?: string;
  }
): Promise<LikingUsersResponse> {
  const maxResults = options?.maxResults || 100;
  
  const params = new URLSearchParams({
    'max_results': String(maxResults),
    'user.fields': 'created_at,description,public_metrics,verified',
  });
  
  if (options?.paginationToken) {
    params.set('pagination_token', options.paginationToken);
  }
  
  const url = `${TWITTER_LIKING_USERS_URL}/${tweetId}/liking_users?${params.toString()}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  
  // Handle rate limits
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || '60';
    const error = new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
    (error as any).retryAfter = parseInt(retryAfter, 10);
    (error as any).isRateLimit = true;
    throw error;
  }
  
  const data = await response.json();
  
  if (!response.ok) {
    console.error('Failed to fetch liking users:', data);
    throw new Error(data.detail || data.title || 'Failed to fetch liking users');
  }
  
  // Empty result (no likes, or privacy restriction)
  if (!data.data) {
    return {
      users: [],
      resultCount: 0,
    };
  }
  
  const users: LikingUser[] = data.data.map((user: any) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    description: user.description,
    created_at: user.created_at,
    public_metrics: user.public_metrics,
    verified: user.verified,
  }));
  
  return {
    users,
    nextToken: data.meta?.next_token,
    resultCount: data.meta?.result_count || users.length,
  };
}

/**
 * Fetch ALL liking users for a tweet (handles pagination).
 * 
 * Rate limit: 75 requests per 15 minutes
 */
export async function fetchAllLikingUsers(
  tweetId: string,
  accessToken: string,
  options?: {
    maxPages?: number;
    delayBetweenPages?: number; // ms
  }
): Promise<LikingUser[]> {
  const maxPages = options?.maxPages || 10; // Default: up to 1000 users
  const delayMs = options?.delayBetweenPages || 200; // Be gentle with rate limits
  
  const allUsers: LikingUser[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;
  
  while (pageCount < maxPages) {
    const response = await fetchLikingUsers(tweetId, accessToken, {
      maxResults: 100,
      paginationToken: nextToken,
    });
    
    allUsers.push(...response.users);
    pageCount++;
    
    console.log(`[TwitterOAuth] Fetched page ${pageCount} of liking users: ${response.users.length} users`);
    
    // Check if there are more pages
    if (!response.nextToken || response.resultCount === 0) {
      break;
    }
    
    nextToken = response.nextToken;
    
    // Rate limit delay
    if (pageCount < maxPages && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return allUsers;
}
