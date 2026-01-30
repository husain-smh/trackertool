/**
 * Twitter OAuth Authorization Route
 * 
 * Initiates the OAuth 2.0 flow for a client.
 * 
 * Query parameters:
 * - client: The client identifier (typically their Twitter username)
 * 
 * Flow:
 * 1. Generate PKCE codes and state
 * 2. Store state temporarily
 * 3. Redirect client to Twitter authorization page
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateAuthorizationUrl } from '@/lib/socap/twitter-oauth';

export async function GET(request: NextRequest) {
  // Get the base URL for redirects
  const baseUrl = request.nextUrl.origin;
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const clientId = searchParams.get('client');

    if (!clientId) {
      return NextResponse.json(
        { success: false, error: 'client query parameter is required' },
        { status: 400 }
      );
    }

    // Validate client_id format (alphanumeric, underscores, hyphens - like Twitter usernames)
    const clientIdRegex = /^[a-zA-Z0-9_-]{1,50}$/;
    if (!clientIdRegex.test(clientId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid client identifier format. Use alphanumeric characters, underscores, or hyphens (1-50 chars).' },
        { status: 400 }
      );
    }

    // Generate authorization URL with PKCE
    const { url } = generateAuthorizationUrl({ clientId });

    // Redirect to Twitter
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[OAuth Authorize] Error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Redirect to error page (use absolute URL)
    const errorPath = process.env.TWITTER_OAUTH_ERROR_URL || '/socap/auth/error';
    const errorUrl = errorPath.startsWith('http') ? errorPath : `${baseUrl}${errorPath}`;
    return NextResponse.redirect(`${errorUrl}?error=${encodeURIComponent(errorMessage)}`);
  }
}
