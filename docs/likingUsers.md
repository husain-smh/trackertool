# Twitter/X API: Fetching Liking Users with OAuth 2.0 (Three-Legged Flow)

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Understanding OAuth 2.0 Three-Legged Flow](#understanding-oauth-20-three-legged-flow)
4. [Project Setup](#project-setup)
5. [Step-by-Step Implementation](#step-by-step-implementation)
6. [Token Management](#token-management)
7. [Fetching Liking Users](#fetching-liking-users)
8. [Complete Code Reference](#complete-code-reference)
9. [Important Limitations](#important-limitations)
10. [Troubleshooting](#troubleshooting)

---

## Overview

This document explains how to:
1. Authenticate a **third-party user** (not just yourself) using Twitter/X's **OAuth 2.0 with PKCE** (three-legged flow)
2. Obtain and manage access/refresh tokens
3. Use those tokens to call the **Liking Users API** (`/2/tweets/:id/liking_users`)

### What is Three-Legged OAuth?

Three-legged OAuth involves **three parties**:
1. **Your Application** (the client)
2. **Twitter/X** (the authorization server)
3. **The User** (the resource owner who grants permission)

The user is redirected to Twitter, logs in, grants permission, and is redirected back to your app with an authorization code.

---

## Prerequisites

### 1. Twitter Developer Account & App

1. Go to [developer.twitter.com](https://developer.twitter.com)
2. Create a project and an app
3. In your app settings, configure:
   - **App Type**: Set to "Web App" (required for OAuth 2.0 with confidential client)
   - **Callback URL**: `http://localhost:3000/callback` (for local development)
   - **Client ID**: Found in "Keys and Tokens" section
   - **Client Secret**: Generate in "Keys and Tokens" section

### 2. Required Scopes/Permissions

For fetching liking users, you need these OAuth 2.0 scopes:
- `tweet.read` - Read tweets
- `users.read` - Read user information
- `like.read` - Read likes (required for liking_users endpoint)
- `offline.access` - Get refresh token (for long-lived access)

### 3. Environment Variables

Create a `.env` file:

```env
TWITTER_CLIENT_ID=your_client_id_here
TWITTER_CLIENT_SECRET=your_client_secret_here
CALLBACK_URL=http://localhost:3000/callback
SESSION_SECRET=any_random_string_for_session_encryption
PORT=3000
```

### 4. Dependencies

```json
{
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.21.0",
    "express-session": "^1.18.1",
    "node-fetch": "^2.7.0"
  }
}
```

Install with: `npm install`

---

## Understanding OAuth 2.0 Three-Legged Flow

### Flow Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   USER      │     │  YOUR APP   │     │  TWITTER/X  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │ 1. Click "Login"  │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 2. Generate PKCE  │
       │                   │    codes & state  │
       │                   │                   │
       │ 3. Redirect to Twitter               │
       │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ >│
       │                   │                   │
       │ 4. User logs in & │                   │
       │    authorizes app │                   │
       │──────────────────────────────────────>│
       │                   │                   │
       │ 5. Twitter redirects back with CODE  │
       │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
       │                   │                   │
       │                   │ 6. Exchange CODE  │
       │                   │    for TOKENS     │
       │                   │──────────────────>│
       │                   │                   │
       │                   │ 7. Receive        │
       │                   │    access_token & │
       │                   │    refresh_token  │
       │                   │<──────────────────│
       │                   │                   │
       │ 8. User is now    │                   │
       │    authenticated! │                   │
       │<──────────────────│                   │
```

### What is PKCE?

**PKCE** (Proof Key for Code Exchange) adds extra security:

1. **Code Verifier**: A random string (43-128 characters)
2. **Code Challenge**: SHA-256 hash of the verifier, base64url encoded

When exchanging the authorization code, you prove you're the same app that started the flow by providing the original code verifier.

---

## Project Setup

### File Structure

```
twitter-oauth-test/
├── server.js          # Main Express server
├── package.json       # Dependencies
├── .env               # Environment variables (DO NOT COMMIT)
├── tokens.json        # Stored tokens (auto-generated, DO NOT COMMIT)
└── likingUsers.md     # This documentation
```

---

## Step-by-Step Implementation

### Step 1: Initialize Express Server with Session

```javascript
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();

// Session middleware - stores PKCE codes and tokens temporarily
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

app.use(express.json());
```

**Why sessions?** We need to store:
- The PKCE code verifier (generated before redirect, needed after callback)
- The state parameter (for CSRF protection)
- The access token (after authentication)

---

### Step 2: PKCE Helper Functions

```javascript
// Base64URL encoding (different from regular Base64!)
// - Replace + with -
// - Replace / with _
// - Remove = padding
function base64URLEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Generate a random 32-byte string for code verifier
function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}

// Generate code challenge = SHA256 hash of verifier, base64url encoded
function generateCodeChallenge(verifier) {
  return base64URLEncode(
    crypto.createHash('sha256').update(verifier).digest()
  );
}
```

**Example Output:**
- Code Verifier: `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`
- Code Challenge: `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`

---

### Step 3: Initiate OAuth Flow (Authorization Request)

When user clicks "Connect Twitter Account", redirect them to Twitter's authorization page:

```javascript
app.get('/auth/twitter', (req, res) => {
  // Step 3a: Generate PKCE codes
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  // Step 3b: Generate random state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');

  // Step 3c: Store in session (we need these after callback)
  req.session.codeVerifier = codeVerifier;
  req.session.state = state;

  // Step 3d: Build authorization URL
  const params = new URLSearchParams({
    response_type: 'code',                    // We want an authorization code
    client_id: process.env.TWITTER_CLIENT_ID,
    redirect_uri: process.env.CALLBACK_URL,   // Where Twitter sends user back
    scope: 'tweet.read users.read like.read offline.access',  // Permissions
    state: state,                             // CSRF protection
    code_challenge: codeChallenge,            // PKCE challenge
    code_challenge_method: 'S256'             // SHA-256 method
  });

  // Step 3e: Redirect user to Twitter
  const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;
  res.redirect(authUrl);
});
```

**The Authorization URL looks like:**
```
https://x.com/i/oauth2/authorize?
  response_type=code&
  client_id=YOUR_CLIENT_ID&
  redirect_uri=http://localhost:3000/callback&
  scope=tweet.read%20users.read%20like.read%20offline.access&
  state=abc123...&
  code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
  code_challenge_method=S256
```

---

### Step 4: Handle Callback & Exchange Code for Tokens

After user authorizes, Twitter redirects to your callback URL with `code` and `state` parameters:

```
http://localhost:3000/callback?code=AUTH_CODE_HERE&state=STATE_HERE
```

Handle this callback:

```javascript
app.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  // Step 4a: Verify state matches (CSRF protection)
  if (state !== req.session.state) {
    return res.send('State mismatch! Possible CSRF attack.');
  }

  try {
    // Step 4b: Create Basic Auth header (client_id:client_secret in base64)
    const auth = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString('base64');

    // Step 4c: Exchange authorization code for tokens
    const tokenResponse = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`  // Client credentials
      },
      body: new URLSearchParams({
        code: code,                              // The authorization code
        grant_type: 'authorization_code',        // Grant type
        redirect_uri: process.env.CALLBACK_URL,  // Must match original
        code_verifier: req.session.codeVerifier  // PKCE proof
      })
    });

    const tokenData = await tokenResponse.json();

    // Step 4d: Store tokens
    if (tokenData.access_token) {
      req.session.accessToken = tokenData.access_token;
      req.session.refreshToken = tokenData.refresh_token;
      req.session.tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);

      // Optional: Save to file for persistence
      fs.writeFileSync('tokens.json', JSON.stringify({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + (tokenData.expires_in * 1000)
      }, null, 2));
      
      res.redirect('/');
    } else {
      res.send('Error: ' + JSON.stringify(tokenData));
    }
  } catch (error) {
    res.send('Error: ' + error.message);
  }
});
```

**Token Response Example:**
```json
{
  "token_type": "bearer",
  "expires_in": 7200,
  "access_token": "ACCESS_TOKEN_HERE",
  "refresh_token": "REFRESH_TOKEN_HERE",
  "scope": "tweet.read users.read like.read offline.access"
}
```

**Important Notes:**
- `access_token`: Valid for 2 hours (7200 seconds)
- `refresh_token`: Used to get new access tokens without re-authentication
- `expires_in`: Seconds until access token expires

---

## Token Management

### Why Refresh Tokens?

Access tokens expire after **2 hours**. Instead of making users re-authenticate, use the refresh token to get a new access token silently.

### Refresh Token Function

```javascript
async function refreshAccessToken(refreshToken) {
  try {
    // Create Basic Auth header
    const auth = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString('base64');

    const response = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token'  // Different grant type!
      })
    });

    const tokenData = await response.json();
    
    if (tokenData.access_token) {
      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken,
        expiresAt: Date.now() + (tokenData.expires_in * 1000)
      };
    } else {
      throw new Error('Failed to refresh: ' + JSON.stringify(tokenData));
    }
  } catch (error) {
    throw new Error('Token refresh error: ' + error.message);
  }
}
```

### Middleware to Auto-Refresh Tokens

This middleware checks if the token is expired and refreshes it automatically:

```javascript
async function ensureValidToken(req, res, next) {
  // Check if user is authenticated
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Check if token is expired (refresh 5 minutes before expiration)
  const expiresAt = req.session.tokenExpiresAt || 0;
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt && (now + fiveMinutes) >= expiresAt) {
    // Token expired or about to expire
    if (req.session.refreshToken) {
      try {
        console.log('🔄 Refreshing expired access token...');
        const newTokens = await refreshAccessToken(req.session.refreshToken);
        
        // Update session
        req.session.accessToken = newTokens.accessToken;
        req.session.refreshToken = newTokens.refreshToken;
        req.session.tokenExpiresAt = newTokens.expiresAt;

        // Update tokens.json file
        fs.writeFileSync('tokens.json', JSON.stringify({
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          expiresAt: newTokens.expiresAt
        }, null, 2));
        
        console.log('✅ Tokens refreshed and saved');
      } catch (error) {
        console.error('❌ Failed to refresh token:', error.message);
        req.session.destroy();
        return res.status(401).json({ 
          error: 'Token expired and refresh failed. Please re-authenticate.',
          requiresReauth: true 
        });
      }
    } else {
      req.session.destroy();
      return res.status(401).json({ 
        error: 'Token expired and no refresh token. Please re-authenticate.',
        requiresReauth: true 
      });
    }
  }

  next();
}
```

---

## Fetching Liking Users

### The API Endpoint

**Endpoint:** `GET https://api.x.com/2/tweets/:id/liking_users`

**Required:**
- Valid access token with `like.read` scope
- Tweet ID

### Implementation

```javascript
app.get('/api/liking-users', ensureValidToken, async (req, res) => {
  const { tweetId } = req.query;
  
  if (!tweetId) {
    return res.status(400).json({ error: 'Tweet ID required' });
  }

  try {
    const response = await fetch(
      `https://api.x.com/2/tweets/${tweetId}/liking_users?max_results=100&user.fields=created_at,description,public_metrics`,
      {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`
        }
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `max_results` | Number of users to return (1-100) | `100` |
| `user.fields` | Additional user data to include | `created_at,description,public_metrics` |
| `pagination_token` | For getting next page of results | (from previous response) |

### Example Response

```json
{
  "data": [
    {
      "id": "12345678",
      "name": "John Doe",
      "username": "johndoe",
      "description": "Developer and coffee enthusiast",
      "created_at": "2020-01-15T10:30:00.000Z",
      "public_metrics": {
        "followers_count": 1500,
        "following_count": 300,
        "tweet_count": 5000
      }
    }
  ],
  "meta": {
    "result_count": 1,
    "next_token": "TOKEN_FOR_NEXT_PAGE"
  }
}
```

### Getting a Tweet ID

A Tweet ID is the numeric ID in a tweet URL:

```
https://x.com/username/status/1234567890123456789
                              ^^^^^^^^^^^^^^^^^^^
                              This is the Tweet ID
```

---

## Complete Code Reference

### Full server.js

See the `server.js` file in this directory for the complete implementation.

### Running the Application

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file with your credentials

3. Start the server:
   ```bash
   npm start
   ```

4. Open http://localhost:3000

5. Click "Connect Twitter Account"

6. Authorize the app on Twitter

7. Enter a Tweet ID to fetch liking users

---

## Important Limitations

### ⚠️ Privacy Restriction

**You can only see likes on tweets that YOU (the authenticated user) authored.**

This is a Twitter/X privacy policy enforcement. If you try to fetch liking users for someone else's tweet, you'll get:

```json
{
  "meta": {
    "result_count": 0
  }
}
```

**Solution:** The authenticated user must enter Tweet IDs of their OWN tweets.

### Rate Limits

| Endpoint | App Rate Limit | User Rate Limit |
|----------|----------------|-----------------|
| `/2/tweets/:id/liking_users` | 75 requests / 15 min | 75 requests / 15 min |

### Token Expiration

| Token Type | Lifetime |
|------------|----------|
| Access Token | 2 hours |
| Refresh Token | 6 months (if `offline.access` scope) |

---

## Troubleshooting

### Error: "State mismatch"

**Cause:** Session expired or cookies not working
**Fix:** Clear browser cookies, restart server

### Error: "invalid_request - Value passed for code was invalid"

**Cause:** Authorization code already used or expired
**Fix:** Start OAuth flow again from beginning

### Error: "401 Unauthorized" on API calls

**Causes:**
1. Access token expired → Should auto-refresh
2. Refresh token invalid → Re-authenticate
3. Missing Bearer prefix in header

### Empty results (result_count: 0)

**Cause:** Privacy restriction - can only see likes on own tweets
**Fix:** Use Tweet IDs from the authenticated user's own tweets

### Error: "Rate limit exceeded"

**Fix:** Wait 15 minutes before making more requests

---

## Security Best Practices

1. **Never commit `.env` file** - Add to `.gitignore`
2. **Never commit `tokens.json`** - Add to `.gitignore`
3. **Use HTTPS in production** - Set `cookie: { secure: true }`
4. **Store tokens securely** - Use encrypted database in production
5. **Validate all inputs** - Sanitize Tweet IDs before API calls

---

## Summary

### The Complete Flow

1. **User clicks "Connect"** → Your app generates PKCE codes and state
2. **Redirect to Twitter** → User sees authorization page
3. **User authorizes** → Twitter redirects to your callback with `code`
4. **Exchange code for tokens** → Send code + code_verifier to token endpoint
5. **Store tokens** → Save access_token and refresh_token
6. **Make API calls** → Use `Authorization: Bearer ACCESS_TOKEN`
7. **Token expires?** → Use refresh_token to get new access_token
8. **Fetch liking users** → Call `/2/tweets/:id/liking_users` with valid token

### Key Endpoints

| Purpose | Endpoint |
|---------|----------|
| Authorization | `https://x.com/i/oauth2/authorize` |
| Token Exchange | `https://api.x.com/2/oauth2/token` |
| Liking Users | `https://api.x.com/2/tweets/:id/liking_users` |
| User Info | `https://api.x.com/2/users/me` |

---

*Last updated: December 2024*
