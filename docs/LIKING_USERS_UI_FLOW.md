# Liking Users Feature - UI/UX Flow Guide

## 🎯 Overview

This document explains the **complete user-facing flow** for the liking users feature, including all UI components, buttons, routes, and user interactions.

---

## 📱 Complete User Journey

### **Scenario:** Admin wants to enable liking users tracking for a campaign

---

## Flow 1: Campaign Creation with Liking Users Feature

### **Step 1: Navigate to Campaign Creation Page**

**Route:** `/socap/create`

**Current State:** ✅ Page exists (`src/app/socap/create/page.tsx`)

**What User Sees:**
- Campaign creation form
- Fields for: Launch Name, Client Info, Tweet URLs, Alert Preferences

**What Needs to be Added:** ⚠️

Add a new section **"Advanced Features"** after "Alert Preferences":

```tsx
{/* Advanced Features */}
<div>
  <h2 className="text-xl font-semibold mb-4">Advanced Features</h2>
  <div className="space-y-4">
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <label className="flex items-start">
        <input
          type="checkbox"
          checked={formData.track_liking_users || false}
          onChange={(e) => handleInputChange('track_liking_users', e.target.checked)}
          className="mt-1 mr-3"
        />
        <div>
          <span className="font-medium">Track Liking Users</span>
          <p className="text-sm text-gray-600 mt-1">
            Track users who have liked your main tweets. Requires client to authorize their Twitter account.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            ⚠️ Only works for main tweets authored by the client's Twitter account.
          </p>
        </div>
      </label>
    </div>
  </div>
</div>
```

**Update formData state:**
```tsx
const [formData, setFormData] = useState({
  // ... existing fields
  track_liking_users: false, // Add this
});
```

**Update payload:**
```tsx
const payload = {
  // ... existing fields
  features: {
    track_liking_users: formData.track_liking_users,
  },
};
```

---

### **Step 2: User Checks "Track Liking Users" Checkbox**

**What Happens:**
- Checkbox becomes checked
- User sees informational text about OAuth requirement
- Form is ready to submit

**Visual State:**
```
☑ Track Liking Users
   Track users who have liked your main tweets. Requires client to authorize their Twitter account.
   ⚠️ Only works for main tweets authored by the client's Twitter account.
```

---

### **Step 3: User Fills Form and Clicks "Create Campaign"**

**What Happens:**
1. Form validates all fields
2. POST request sent to `/api/socap/campaigns` with `features.track_liking_users: true`
3. Campaign created in database
4. User redirected to campaign dashboard: `/socap/campaigns/{campaign_id}`

**Current State:** ✅ Backend handles this correctly

---

## Flow 2: Client Authorization (OAuth Flow)

### **Step 1: User Lands on Campaign Dashboard**

**Route:** `/socap/campaigns/{campaign_id}`

**Current State:** ✅ Page exists (`src/app/socap/campaigns/[id]/page.tsx`)

**What Needs to be Added:** ⚠️

Add an **OAuth Status Widget** at the top of the dashboard (if feature is enabled):

```tsx
{/* OAuth Status Widget - Only show if track_liking_users is enabled */}
{campaign.features?.track_liking_users && (
  <OAuthStatusWidget clientEmail={campaign.client_info.email} />
)}
```

**Create New Component:** `src/components/socap/OAuthStatusWidget.tsx`

---

### **Step 2: OAuth Status Widget Checks Authorization Status**

**What Needs to be Created:** ⚠️

**New API Endpoint:** `src/app/api/socap/auth/twitter/status/route.ts`

```typescript
// GET /api/socap/auth/twitter/status?client_email=...
// Returns: { authorized: boolean, username?: string, authorized_at?: Date }
```

**Component Logic:**
```tsx
'use client';

import { useState, useEffect } from 'react';

interface OAuthStatus {
  authorized: boolean;
  username?: string;
  authorized_at?: string;
  status?: 'active' | 'expired' | 'revoked';
}

export default function OAuthStatusWidget({ clientEmail }: { clientEmail: string }) {
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/socap/auth/twitter/status?client_email=${encodeURIComponent(clientEmail)}`)
      .then(res => res.json())
      .then(data => {
        setOAuthStatus(data);
        setLoading(false);
      });
  }, [clientEmail]);

  const handleAuthorize = () => {
    // Redirect to authorization endpoint
    window.location.href = `/api/socap/auth/twitter/authorize?client_email=${encodeURIComponent(clientEmail)}`;
  };

  if (loading) {
    return <div>Checking authorization status...</div>;
  }

  if (!oauthStatus?.authorized) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-yellow-800">Twitter Account Not Connected</h3>
            <p className="text-sm text-yellow-700 mt-1">
              To track liking users, the client needs to authorize their Twitter account.
            </p>
          </div>
          <button
            onClick={handleAuthorize}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Connect Twitter Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-green-800">✓ Twitter Account Connected</h3>
          <p className="text-sm text-green-700 mt-1">
            Connected as: <strong>@{oauthStatus.username}</strong>
            {oauthStatus.authorized_at && (
              <span className="ml-2">
                (Authorized: {new Date(oauthStatus.authorized_at).toLocaleDateString()})
              </span>
            )}
          </p>
        </div>
        <button
          onClick={handleAuthorize}
          className="text-blue-600 hover:underline text-sm"
        >
          Reconnect
        </button>
      </div>
    </div>
  );
}
```

---

### **Step 3: User Clicks "Connect Twitter Account" Button**

**What Happens:**
1. User clicks button
2. Browser navigates to: `/api/socap/auth/twitter/authorize?client_email=client@example.com`
3. **Backend redirects to Twitter/X authorization page**
4. User sees Twitter login/authorization screen

**Current State:** ✅ Backend endpoint exists and works

**Twitter Authorization Page Shows:**
```
┌─────────────────────────────────────┐
│  Authorize [Your App Name]          │
│                                     │
│  This app wants to:                 │
│  • Read tweets                      │
│  • Read user information            │
│  • Read likes                       │
│  • Access offline                   │
│                                     │
│  [Authorize App]  [Cancel]         │
└─────────────────────────────────────┘
```

---

### **Step 4: Client Authorizes on Twitter**

**What Happens:**
1. Client logs into Twitter (if not already)
2. Client clicks "Authorize App"
3. Twitter redirects back to: `/api/socap/auth/twitter/callback?code=...&state=...`
4. **Backend processes callback:**
   - Verifies state (CSRF protection)
   - Exchanges code for tokens
   - Stores encrypted tokens in database
   - Fetches user info
5. User redirected to: `/socap/auth/success`

**Current State:** ✅ Backend callback endpoint exists and works

---

### **Step 5: Success Page**

**Route:** `/socap/auth/success`

**What User Sees:**
```
┌─────────────────────────────────────┐
│         ✓ Authorization Successful! │
│                                     │
│  Your X account has been connected  │
│  successfully.                      │
│                                     │
│  You can now close this window.    │
│  Your account will be used to track │
│  users who have liked your posts.   │
│                                     │
│        [Close Window]               │
└─────────────────────────────────────┘
```

**Current State:** ✅ Page exists (`src/app/socap/auth/success/page.tsx`)

**User Action:** Clicks "Close Window" button → Window closes

---

### **Step 6: User Returns to Campaign Dashboard**

**Route:** `/socap/campaigns/{campaign_id}`

**What User Sees Now:**
- OAuth Status Widget shows: **"✓ Twitter Account Connected"**
- Shows connected username
- Shows authorization date
- "Reconnect" button available

**What Happens Next:**
- Jobs are automatically created (via `/api/socap/workers/trigger`)
- Workers process liking users jobs
- Liking users appear in engagements

---

## Flow 3: Viewing Liking Users

### **Step 1: Navigate to Campaign Dashboard**

**Route:** `/socap/campaigns/{campaign_id}`

**What Needs to be Added:** ⚠️

Add a **"Liking Users"** section in the dashboard:

```tsx
{/* Liking Users Section - Only show if feature enabled */}
{campaign.features?.track_liking_users && (
  <LikingUsersSection campaignId={campaignId} />
)}
```

**Create New Component:** `src/components/socap/LikingUsersSection.tsx`

---

### **Step 2: Liking Users Section**

**What Needs to be Created:** ⚠️

**Component:** `src/components/socap/LikingUsersSection.tsx`

```tsx
'use client';

import { useState, useEffect } from 'react';

interface LikingUser {
  user_id: string;
  username: string;
  name: string;
  followers: number;
  verified: boolean;
  importance_score: number;
  timestamp: string;
}

export default function LikingUsersSection({ campaignId }: { campaignId: string }) {
  const [likingUsers, setLikingUsers] = useState<LikingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'high'>('all');

  useEffect(() => {
    fetch(`/api/socap/campaigns/${campaignId}/engagements?action_type=like`)
      .then(res => res.json())
      .then(data => {
        setLikingUsers(data.engagements || []);
        setLoading(false);
      });
  }, [campaignId]);

  const filteredUsers = filter === 'high' 
    ? likingUsers.filter(u => u.importance_score >= 10)
    : likingUsers;

  const sortedUsers = [...filteredUsers].sort((a, b) => b.importance_score - a.importance_score);

  return (
    <div className="glass rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">
          Liking Users ({likingUsers.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('high')}
            className={`px-4 py-2 rounded ${filter === 'high' ? 'bg-blue-600' : 'bg-zinc-700'}`}
          >
            High Importance (≥10)
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-zinc-400">Loading...</div>
      ) : sortedUsers.length === 0 ? (
        <div className="text-center py-8 text-zinc-400">
          No liking users found yet. Jobs are processing...
        </div>
      ) : (
        <div className="space-y-3">
          {sortedUsers.map((user) => (
            <div
              key={user.user_id}
              className="bg-zinc-800/50 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div>
                  <div className="font-semibold text-white">
                    {user.name}
                    {user.verified && <span className="ml-2 text-blue-400">✓</span>}
                  </div>
                  <div className="text-sm text-zinc-400">@{user.username}</div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {user.followers.toLocaleString()} followers
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-blue-400">
                  {user.importance_score}
                </div>
                <div className="text-xs text-zinc-500">Importance</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 📋 Summary: What Needs to be Built

### ✅ Already Implemented (Backend)
- OAuth authorization endpoint
- OAuth callback endpoint
- Success/Error pages
- Liking users worker
- Job queue integration
- Database models

### ⚠️ Needs to be Built (Frontend)

1. **Campaign Creation Form** (`src/app/socap/create/page.tsx`)
   - Add checkbox for "Track Liking Users"
   - Include `features.track_liking_users` in payload

2. **OAuth Status API Endpoint** (`src/app/api/socap/auth/twitter/status/route.ts`)
   - Check if client has authorized
   - Return status, username, authorization date

3. **OAuth Status Widget** (`src/components/socap/OAuthStatusWidget.tsx`)
   - Show connection status
   - "Connect Twitter Account" button
   - Display connected username

4. **Liking Users Section** (`src/components/socap/LikingUsersSection.tsx`)
   - Display list of liking users
   - Filter by importance score
   - Show user profiles

5. **Campaign Dashboard Updates** (`src/app/socap/campaigns/[id]/page.tsx`)
   - Add OAuth Status Widget (if feature enabled)
   - Add Liking Users Section (if feature enabled)

---

## 🎨 Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  FLOW 1: Campaign Creation                                  │
└─────────────────────────────────────────────────────────────┘

1. User visits /socap/create
   ↓
2. Fills form + checks "Track Liking Users" ☑
   ↓
3. Clicks "Create Campaign"
   ↓
4. Redirected to /socap/campaigns/{id}
   ↓
   ┌─────────────────────────────────────────────────────────┐
   │  FLOW 2: OAuth Authorization                             │
   └─────────────────────────────────────────────────────────┘
   
5. Sees "Twitter Account Not Connected" widget
   ↓
6. Clicks "Connect Twitter Account" button
   ↓
7. Redirected to Twitter authorization page
   ↓
8. Client authorizes app on Twitter
   ↓
9. Redirected to /socap/auth/success
   ↓
10. Clicks "Close Window"
    ↓
11. Returns to /socap/campaigns/{id}
    ↓
12. Sees "✓ Twitter Account Connected" widget
    ↓
    ┌─────────────────────────────────────────────────────────┐
    │  FLOW 3: Viewing Liking Users                           │
    └─────────────────────────────────────────────────────────┘
    
13. Sees "Liking Users" section
    ↓
14. Views list of users who liked tweets
    ↓
15. Can filter by "High Importance"
    ↓
16. Sees user profiles with importance scores
```

---

## 🔗 Key Routes Summary

| Route | Purpose | Status |
|-------|---------|--------|
| `/socap/create` | Create campaign with feature toggle | ⚠️ Needs checkbox |
| `/socap/campaigns/{id}` | Campaign dashboard | ⚠️ Needs widgets |
| `/api/socap/auth/twitter/authorize` | Start OAuth flow | ✅ Exists |
| `/api/socap/auth/twitter/callback` | OAuth callback | ✅ Exists |
| `/api/socap/auth/twitter/status` | Check OAuth status | ⚠️ Needs creation |
| `/socap/auth/success` | OAuth success page | ✅ Exists |
| `/socap/auth/error` | OAuth error page | ✅ Exists |
| `/api/socap/campaigns/{id}/engagements` | Get liking users | ✅ Exists |

---

## 💡 User Experience Tips

### For Admins:
1. **Clear Instructions**: When enabling the feature, show a clear message explaining OAuth requirement
2. **Status Visibility**: Always show OAuth status prominently when feature is enabled
3. **Help Text**: Include tooltips explaining privacy restrictions

### For Clients:
1. **Simple Flow**: Authorization should be one-click → Twitter → Done
2. **Clear Purpose**: Explain why authorization is needed
3. **Reassurance**: Show that tokens are encrypted and secure

### Error Handling:
1. **OAuth Expired**: Show clear message with "Reconnect" button
2. **No OAuth**: Show helpful message with authorization button
3. **Feature Disabled**: Don't show OAuth widget if feature not enabled

---

## 🚀 Next Steps

1. **Add checkbox to campaign creation form**
2. **Create OAuth status API endpoint**
3. **Build OAuth Status Widget component**
4. **Build Liking Users Section component**
5. **Integrate widgets into campaign dashboard**
6. **Test complete flow end-to-end**

---

**Ready to implement? Start with the campaign creation form checkbox, then build the OAuth status widget!** 🎯









