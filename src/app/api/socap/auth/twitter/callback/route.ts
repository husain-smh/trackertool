/**
 * Twitter OAuth Callback Route
 * 
 * Handles the callback from Twitter after user authorization.
 * 
 * Query parameters from Twitter:
 * - code: Authorization code
 * - state: CSRF protection state
 * 
 * Flow:
 * 1. Verify state matches
 * 2. Exchange code for tokens
 * 3. Fetch user info
 * 4. Store tokens in database
 * 5. Redirect to success page with username
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  retrieveOAuthState,
  exchangeCodeForTokens,
  fetchTwitterUserInfo,
} from '@/lib/socap/twitter-oauth';
import { upsertClientOAuth } from '@/lib/models/socap/client-oauth';

// Helper to build absolute URL
function buildAbsoluteUrl(baseUrl: string, path: string): string {
  return path.startsWith('http') ? path : `${baseUrl}${path}`;
}

export async function GET(request: NextRequest) {
  // Get base URL for redirects
  const baseUrl = request.nextUrl.origin;
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Handle OAuth errors from Twitter
    if (error) {
      console.error('[OAuth Callback] Twitter error:', error, errorDescription);
      const errorPath = process.env.TWITTER_OAUTH_ERROR_URL || '/socap/auth/error';
      const errorUrl = buildAbsoluteUrl(baseUrl, errorPath);
      return NextResponse.redirect(
        `${errorUrl}?error=${encodeURIComponent(errorDescription || error || 'Authorization failed')}`
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return NextResponse.json(
        { success: false, error: 'Missing code or state parameter' },
        { status: 400 }
      );
    }

    // Retrieve OAuth state (validates and removes it)
    const stateData = retrieveOAuthState(state);
    if (!stateData) {
      console.error('[OAuth Callback] Invalid or expired state:', state);
      const errorPath = process.env.TWITTER_OAUTH_ERROR_URL || '/socap/auth/error';
      const errorUrl = buildAbsoluteUrl(baseUrl, errorPath);
      return NextResponse.redirect(
        `${errorUrl}?error=${encodeURIComponent('Invalid or expired authorization request. Please try again.')}`
      );
    }

    const { codeVerifier, clientId } = stateData;

    // Exchange authorization code for tokens
    console.log(`[OAuth Callback] Exchanging code for tokens for client: ${clientId}...`);
    const tokens = await exchangeCodeForTokens(code, codeVerifier);

    // Fetch user info to get X user ID and username
    console.log(`[OAuth Callback] Fetching user info...`);
    const userInfo = await fetchTwitterUserInfo(tokens.accessToken);

    // Store tokens in database
    console.log(`[OAuth Callback] Storing tokens for ${clientId} (X: @${userInfo.username})...`);
    await upsertClientOAuth({
      client_id: clientId,
      x_user_id: userInfo.id,
      x_username: userInfo.username,
      x_name: userInfo.name,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      scopes: tokens.scopes,
    });

    console.log(`[OAuth Callback] ✅ Successfully authorized client ${clientId} as @${userInfo.username}`);

    // Redirect to success page with username info
    const successPath = process.env.TWITTER_OAUTH_SUCCESS_URL || '/socap/auth/success';
    const successUrl = buildAbsoluteUrl(baseUrl, successPath);
    return NextResponse.redirect(
      `${successUrl}?username=${encodeURIComponent(userInfo.username)}&name=${encodeURIComponent(userInfo.name)}`
    );
  } catch (error) {
    console.error('[OAuth Callback] Error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Redirect to error page
    const errorPath = process.env.TWITTER_OAUTH_ERROR_URL || '/socap/auth/error';
    const errorUrl = buildAbsoluteUrl(baseUrl, errorPath);
    return NextResponse.redirect(
      `${errorUrl}?error=${encodeURIComponent(errorMessage)}`
    );
  }
}
