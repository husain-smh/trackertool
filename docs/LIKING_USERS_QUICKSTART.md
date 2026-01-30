# Liking Users Feature - Quick Start Guide

## 🚀 Ready to Use in 5 Minutes

The liking users feature is now **fully implemented and ready to use**. Follow these simple steps:

---

## Prerequisites

### 1. Environment Variables

Add these to your `.env` file (if not already present):

```env
# OAuth Configuration
TWITTER_OAUTH_CLIENT_ID=your_client_id_here
TWITTER_OAUTH_CLIENT_SECRET=your_client_secret_here
TWITTER_OAUTH_CALLBACK_URL=http://localhost:3000/api/socap/auth/twitter/callback
TWITTER_OAUTH_SUCCESS_URL=/socap/auth/success
TWITTER_OAUTH_ERROR_URL=/socap/auth/error

# Encryption Key (generate with command below)
OAUTH_ENCRYPTION_KEY=your_64_hex_character_string_here
```

**Generate encryption key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Twitter Developer App

If you haven't already:
1. Go to https://developer.twitter.com
2. Create an app with OAuth 2.0 enabled
3. Set callback URL to match `.env`
4. Copy Client ID and Secret to `.env`

---

## Usage

### Step 1: Client Authorization

Before a campaign can track liking users, the client must authorize their Twitter account:

**Authorization URL:**
```
http://localhost:3000/api/socap/auth/twitter/authorize?client_email=client@example.com
```

**What happens:**
1. Client is redirected to Twitter
2. Client logs in and authorizes your app
3. Tokens are stored encrypted in database
4. Client is redirected to success page

**Check OAuth status via MongoDB:**
```javascript
db.socap_client_oauth.find({ client_email: "client@example.com" })
```

---

### Step 2: Create Campaign with Feature Enabled

When creating a campaign, add the `features` field:

**API Request:**
```bash
POST /api/socap/campaigns
```

**Request Body:**
```json
{
  "launch_name": "Product Launch Q1 2025",
  "client_info": {
    "name": "Acme Corp",
    "email": "client@example.com"
  },
  "features": {
    "track_liking_users": true
  },
  "maintweets": [
    { "url": "https://twitter.com/acme/status/1234567890" }
  ],
  "influencer_twts": [],
  "investor_twts": [],
  "monitor_window": {
    "start_date": "2025-01-01T00:00:00Z",
    "end_date": "2025-01-31T23:59:59Z"
  },
  "alert_preferences": {
    "importance_threshold": 10,
    "channels": ["slack"]
  }
}
```

**Key Points:**
- ✅ Set `features.track_liking_users: true`
- ✅ Client email must match OAuth authorization
- ✅ Only main tweets will track liking users

---

### Step 3: Enqueue Jobs

Trigger job creation (this happens automatically via N8N, but you can also do it manually):

**API Request:**
```bash
POST /api/socap/workers/trigger
```

**What happens:**
- Creates standard jobs (retweets, replies, quotes, metrics) for all tweets
- **Additionally** creates `liking_users` jobs for main tweets (if feature enabled)

**Check jobs in MongoDB:**
```javascript
db.socap_job_queue.find({ 
  campaign_id: "campaign_id_here",
  job_type: "liking_users"
})
```

---

### Step 4: Process Jobs

Run the worker orchestrator:

**API Request:**
```bash
POST /api/socap/workers/run
```

**Request Body:**
```json
{
  "maxJobs": 100,
  "concurrency": 5
}
```

**What happens:**
1. Worker claims `liking_users` jobs
2. Checks if feature enabled (skips if not)
3. Checks if tweet is main tweet (skips if not)
4. Gets OAuth access token (skips if none)
5. Fetches liking users from Twitter API
6. Processes importance scoring
7. Stores as engagements with `action_type: 'like'`
8. Triggers alert detection

---

### Step 5: View Liking Users

Query engagements with like action type:

**API Request:**
```bash
GET /api/socap/campaigns/{campaign_id}/engagements?action_type=like
```

**MongoDB Query:**
```javascript
db.socap_engagements.find({
  campaign_id: "campaign_id_here",
  action_type: "like"
}).sort({ importance_score: -1 })
```

**Response Example:**
```json
{
  "engagements": [
    {
      "user_id": "98765432",
      "action_type": "like",
      "tweet_category": "main_twt",
      "account_profile": {
        "username": "johndoe",
        "name": "John Doe",
        "followers": 1500,
        "verified": false
      },
      "importance_score": 25,
      "account_categories": ["founders", "developers"],
      "timestamp": "2024-12-20T10:30:00Z"
    }
  ]
}
```

---

## Verification Checklist

After setup, verify everything works:

### ✅ OAuth Setup
```bash
# Check if client OAuth exists
curl http://localhost:3000/api/socap/auth/twitter/authorize?client_email=test@example.com
# Should redirect to Twitter
```

### ✅ Feature Enabled
```javascript
// MongoDB - Check campaign has feature enabled
db.socap_campaigns.findOne({ _id: ObjectId("campaign_id") })
// Should show: features: { track_liking_users: true }
```

### ✅ Jobs Created
```javascript
// MongoDB - Check liking_users jobs exist
db.socap_job_queue.find({ 
  job_type: "liking_users",
  status: "pending"
})
// Should show jobs for main tweets only
```

### ✅ Jobs Processing
```bash
# Trigger workers
curl -X POST http://localhost:3000/api/socap/workers/run \
  -H "Content-Type: application/json" \
  -d '{"maxJobs": 10, "concurrency": 2}'

# Check worker state
db.socap_worker_state.find({ job_type: "liking_users" })
# Should show last_success timestamp
```

### ✅ Engagements Stored
```javascript
// MongoDB - Check engagements created
db.socap_engagements.find({ 
  action_type: "like"
})
// Should show liking users as engagements
```

---

## Troubleshooting

### No Jobs Created

**Problem:** `liking_users` jobs not appearing in queue

**Check:**
1. Is `features.track_liking_users: true` in campaign?
2. Are there any main tweets in the campaign?
3. Did you call `/api/socap/workers/trigger`?

**Solution:**
```javascript
// Check campaign features
db.socap_campaigns.findOne({ _id: ObjectId("campaign_id") })

// Check tweet categories
db.socap_tweets.find({ 
  campaign_id: "campaign_id",
  category: "main_twt"
})
```

---

### Worker Skipping Jobs

**Problem:** Worker processes job but doesn't fetch liking users

**Check logs for:**
- "Liking users tracking not enabled" → Feature not enabled
- "Tweet is not a main tweet" → Tweet category wrong
- "No valid OAuth access token" → Client hasn't authorized

**Solution:**
```javascript
// Check OAuth status
db.socap_client_oauth.findOne({ 
  client_email: "client@example.com"
})
// Should show: status: "active"

// Check worker state for errors
db.socap_worker_state.findOne({ 
  job_type: "liking_users",
  tweet_id: "tweet_id"
})
// Check last_error field
```

---

### Rate Limit Errors

**Problem:** Worker blocked by rate limits

**Symptoms:**
- `blocked_until` field set in worker state
- Error: "Rate limit exceeded"

**Solution:**
- Rate limit is 75 requests / 15 minutes
- Worker will automatically retry after blocked_until time
- Reduce number of main tweets or spread out requests

**Check:**
```javascript
db.socap_worker_state.find({ 
  job_type: "liking_users",
  blocked_until: { $ne: null }
})
```

---

### OAuth Expired

**Problem:** Access token expired and refresh failed

**Symptoms:**
- Worker skips with "No OAuth access token available"
- `status: 'expired'` in client_oauth collection

**Solution:**
Client needs to re-authorize:
```
http://localhost:3000/api/socap/auth/twitter/authorize?client_email=client@example.com
```

---

## Testing Commands

### Full Test Flow

```bash
# 1. Authorize client
open "http://localhost:3000/api/socap/auth/twitter/authorize?client_email=test@example.com"

# 2. Create campaign with feature
curl -X POST http://localhost:3000/api/socap/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "launch_name": "Test Campaign",
    "features": {"track_liking_users": true},
    "client_info": {"name": "Test", "email": "test@example.com"},
    "maintweets": [{"url": "https://twitter.com/user/status/123"}],
    "influencer_twts": [],
    "investor_twts": [],
    "monitor_window": {
      "start_date": "2025-01-01T00:00:00Z",
      "end_date": "2025-01-31T23:59:59Z"
    },
    "alert_preferences": {
      "importance_threshold": 10,
      "channels": ["slack"]
    }
  }'

# 3. Trigger job creation
curl -X POST http://localhost:3000/api/socap/workers/trigger

# 4. Process jobs
curl -X POST http://localhost:3000/api/socap/workers/run \
  -H "Content-Type: application/json" \
  -d '{"maxJobs": 50, "concurrency": 5}'

# 5. Check results
curl http://localhost:3000/api/socap/campaigns/{campaign_id}/engagements?action_type=like
```

---

## MongoDB Queries

### Check Everything

```javascript
// 1. OAuth status
db.socap_client_oauth.find().pretty()

// 2. Campaigns with feature enabled
db.socap_campaigns.find({ 
  "features.track_liking_users": true 
}).pretty()

// 3. Liking users jobs
db.socap_job_queue.find({ 
  job_type: "liking_users" 
}).sort({ created_at: -1 }).limit(10)

// 4. Worker state
db.socap_worker_state.find({ 
  job_type: "liking_users" 
}).sort({ updated_at: -1 }).limit(10)

// 5. Liking users engagements
db.socap_engagements.find({ 
  action_type: "like" 
}).sort({ importance_score: -1 }).limit(20)

// 6. High-importance likers
db.socap_engagements.find({ 
  action_type: "like",
  importance_score: { $gte: 10 }
}).sort({ importance_score: -1 })
```

---

## Production Deployment

### Recommended Setup

1. **N8N Workflow** - Triggers every 30 minutes
   ```
   POST /api/socap/workers/trigger
   ```

2. **Worker Service** - Runs continuously
   ```javascript
   import { WorkerOrchestrator } from './lib/socap/workers/worker-orchestrator';
   const orchestrator = new WorkerOrchestrator(5);
   orchestrator.start();
   ```

3. **Alert Processing** - Runs every 2-3 minutes
   ```
   POST /api/socap/alerts/process
   ```

### Monitoring

Watch these metrics:
- OAuth expiration dates
- Worker blocked_until times
- Rate limit errors
- Job failure rate

---

## Summary

✅ **Setup:** Add env vars, authorize client  
✅ **Enable:** Set `features.track_liking_users: true`  
✅ **Run:** Jobs created and processed automatically  
✅ **View:** Query engagements with `action_type: 'like'`  

**The feature is independent and won't affect existing functionality even if something goes wrong!**

Happy tracking! 🎉
