/**
 * Social Capital X OAuth Authorization Route
 *
 * Query params:
 * - client_id: X username (without @) that will authorize (tweet author)
 * - return_to (optional): path to return the user after success (e.g. /tweets/123)
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateAuthorizationUrl, OAUTH_STATE_COOKIE_NAME, sealOAuthStateCookie } from '@/lib/x-oauth';

function isSafeReturnTo(value: string): boolean {
  // Only allow same-site relative paths.
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('://');
}

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;

  try {
    const sp = request.nextUrl.searchParams;
    const clientId = sp.get('client_id');
    const returnToRaw = sp.get('return_to') || undefined;
    const returnTo = returnToRaw && isSafeReturnTo(returnToRaw) ? returnToRaw : undefined;

    if (!clientId) {
      return NextResponse.json({ success: false, error: 'client_id query parameter is required' }, { status: 400 });
    }

    // Basic validation (X usernames are typically [A-Za-z0-9_], max 15)
    const usernameRegex = /^[a-zA-Z0-9_]{1,30}$/;
    if (!usernameRegex.test(clientId)) {
      return NextResponse.json({ success: false, error: 'Invalid client_id format' }, { status: 400 });
    }

    const { url, state, codeVerifier } = generateAuthorizationUrl({ clientId, returnTo });
    const res = NextResponse.redirect(url);

    // Persist state across instances (serverless/load-balanced environments).
    // This prevents false "expired" when callback hits a different server process.
    res.cookies.set({
      name: OAUTH_STATE_COOKIE_NAME,
      value: sealOAuthStateCookie({ state, codeVerifier, clientId, returnTo }),
      httpOnly: true,
      sameSite: 'lax',
      secure: baseUrl.startsWith('https://'),
      path: '/api/auth/x/callback',
      maxAge: 10 * 60, // seconds
    });

    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const errorUrl = `${baseUrl}/auth/x/error?error=${encodeURIComponent(message)}`;
    return NextResponse.redirect(errorUrl);
  }
}

