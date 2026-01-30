/**
 * Social Capital X OAuth Callback Route
 *
 * Handles the callback from X after user authorization.
 * Stores encrypted tokens keyed by `client_id`.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForTokens,
  fetchTwitterUserInfo,
  OAUTH_STATE_COOKIE_NAME,
  retrieveOAuthState,
  unsealOAuthStateCookie,
} from '@/lib/x-oauth';
import { upsertXOAuth } from '@/lib/models/x-oauth';

function buildAbsolute(baseUrl: string, path: string): string {
  return path.startsWith('http') ? path : `${baseUrl}${path}`;
}

function isSafeReturnTo(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('://');
}

export async function GET(request: NextRequest) {
  const baseUrl = request.nextUrl.origin;

  try {
    const sp = request.nextUrl.searchParams;
    const code = sp.get('code');
    const state = sp.get('state');
    const error = sp.get('error');
    const errorDescription = sp.get('error_description');

    if (error) {
      const msg = errorDescription || error || 'Authorization failed';
      console.warn('[idlab-x-oauth] callback returned error from X', {
        origin: baseUrl,
        error,
        errorDescription,
      });
      const errorUrl = buildAbsolute(baseUrl, '/auth/x/error');
      return NextResponse.redirect(`${errorUrl}?error=${encodeURIComponent(msg)}`);
    }

    if (!code || !state) {
      return NextResponse.json({ success: false, error: 'Missing code or state parameter' }, { status: 400 });
    }

    const stateData =
      retrieveOAuthState(state) ||
      unsealOAuthStateCookie(request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value, state);
    if (!stateData) {
      console.warn('[idlab-x-oauth] missing/expired state', {
        origin: baseUrl,
        hasStateCookie: request.cookies.has(OAUTH_STATE_COOKIE_NAME),
      });
      const errorUrl = buildAbsolute(baseUrl, '/auth/x/error');
      return NextResponse.redirect(
        `${errorUrl}?error=${encodeURIComponent(
          'Invalid or expired authorization request. This usually means the callback URL domain does not match where you started the flow, or the server restarted. Please try again.'
        )}`
      );
    }

    const { codeVerifier, clientId, returnTo } = stateData;

    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    const userInfo = await fetchTwitterUserInfo(tokens.accessToken);

    await upsertXOAuth({
      client_id: clientId,
      x_user_id: userInfo.id,
      x_username: userInfo.username,
      x_name: userInfo.name,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      scopes: tokens.scopes,
    });

    const safeReturnTo = returnTo && isSafeReturnTo(returnTo) ? returnTo : undefined;
    const successUrl = buildAbsolute(baseUrl, '/auth/x/success');
    const qp = new URLSearchParams({
      username: userInfo.username,
      name: userInfo.name,
    });
    if (safeReturnTo) qp.set('return_to', safeReturnTo);

    const res = NextResponse.redirect(`${successUrl}?${qp.toString()}`);
    // Clear one-time cookie if present (best-effort).
    if (request.cookies.has(OAUTH_STATE_COOKIE_NAME)) {
      res.cookies.set({
        name: OAUTH_STATE_COOKIE_NAME,
        value: '',
        path: '/api/auth/x/callback',
        maxAge: 0,
      });
    }
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[idlab-x-oauth] callback failed', { origin: baseUrl, message: msg });
    const errorUrl = buildAbsolute(baseUrl, '/auth/x/error');
    return NextResponse.redirect(`${errorUrl}?error=${encodeURIComponent(msg)}`);
  }
}

