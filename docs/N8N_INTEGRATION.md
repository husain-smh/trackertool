# N8N Integration Guide - Twitter Ranker System

## Overview

This document explains how to integrate N8N workflows with the Twitter Ranker system. The system ranks tweet engagers by importance based on who follows them from your list of important people.

## System Architecture

```
N8N Workflow → Fetch Twitter Data → Send to Next.js API → MongoDB (twitter_ranker)
                                                         ↓
                                                  Inverse Index Built
                                                         ↓
                                              Fast O(1) Ranking Lookups
```

## API Endpoints

### Base URL
```
Development: http://localhost:3000
Production: https://your-domain.com
```

---

## 1. Admin Endpoints

### 1.1 Add Important Person
**Endpoint:** `POST /api/ranker/admin/important-person`

**Purpose:** Add one or more people to the important people list (supports comma-separated usernames)

**Request Body (Single User):**
```json
{
  "username": "elonmusk"
}
```

**Request Body (Multiple Users - Comma-separated):**
```json
{
  "username": "elonmusk, naval, sama"
}
```

**Note:** Only username is required. N8N will provide user_id and name during the first following sync.

**Response (Success - Single User):**
```json
{
  "success": true,
  "message": "Processed 1 username(s): 1 added, 0 failed",
  "summary": {
    "total": 1,
    "added": 1,
    "failed": 0
  },
  "results": [
    {
      "username": "elonmusk",
      "success": true,
      "message": "@elonmusk added successfully"
    }
  ]
}
```

**Response (Success - Multiple Users):**
```json
{
  "success": true,
  "message": "Processed 3 username(s): 3 added, 0 failed",
  "summary": {
    "total": 3,
    "added": 3,
    "failed": 0
  },
  "results": [
    {
      "username": "elonmusk",
      "success": true,
      "message": "@elonmusk added successfully"
    },
    {
      "username": "naval",
      "success": true,
      "message": "@naval added successfully"
    },
    {
      "username": "sama",
      "success": true,
      "message": "@sama added successfully"
    }
  ]
}
```

**Response (Partial Success - Some Duplicates):**
```json
{
  "success": true,
  "message": "Processed 3 username(s): 2 added, 1 failed",
  "summary": {
    "total": 3,
    "added": 2,
    "failed": 1
  },
  "results": [
    {
      "username": "elonmusk",
      "success": true,
      "message": "@elonmusk added successfully"
    },
    {
      "username": "naval",
      "success": false,
      "message": "@naval already exists",
      "error": "Duplicate entry"
    },
    {
      "username": "sama",
      "success": true,
      "message": "@sama added successfully"
    }
  ]
}
```

**Status Codes:**
- `200`: All users added successfully
- `207`: Partial success (some failed, some succeeded)
- `500`: All failed

---

### 1.2 Remove Important Person
**Endpoint:** `DELETE /api/ranker/admin/important-person?username=elonmusk`

**Purpose:** Deactivate a person from the important people list

**Response (Success):**
```json
{
  "success": true,
  "message": "Important person deactivated successfully"
}
```

---

### 1.3 List Important People
**Endpoint:** `GET /api/ranker/admin/important-people?page=1&limit=20`

**Purpose:** Get paginated list of all important people

**Query Parameters:**
- `page` (optional): Page number, default: 1
- `limit` (optional): Items per page (1-100), default: 20

**Response:**
```json
{
  "success": true,
  "data": {
    "people": [
      {
        "username": "elonmusk",
        "user_id": "44196397",
        "name": "Elon Musk",
        "following_count": 523,
        "last_synced": "2025-11-05T09:15:00.000Z",
        "is_active": true
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "total_pages": 3
    }
  }
}
```

---

### 1.4 Get Sync Status
**Endpoint:** `GET /api/ranker/admin/sync-status`

**Purpose:** Get sync status for all important people

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "total_people": 45,
      "synced_people": 38,
      "unsynced_people": 7,
      "oldest_sync": "2025-10-28T10:30:00.000Z",
      "newest_sync": "2025-11-05T09:15:00.000Z"
    },
    "people": [
      {
        "username": "elonmusk",
        "user_id": "44196397",
        "name": "Elon Musk",
        "last_synced": "2025-11-05T09:15:00.000Z",
        "following_count": 523,
        "sync_status": "synced"
      },
      {
        "username": "naval",
        "user_id": "745273",
        "name": "Naval",
        "last_synced": null,
        "following_count": 0,
        "sync_status": "never_synced"
      }
    ]
  }
}
```

---

### 1.5 Sync Person (Trigger N8N Sync)
**Endpoint:** `POST /api/ranker/admin/sync-person`

**Purpose:** Manually trigger sync for one or more important people (calls N8N webhook, supports comma-separated usernames)

**Request Body (Single User):**
```json
{
  "username": "elonmusk"
}
```

**Request Body (Multiple Users - Comma-separated):**
```json
{
  "username": "elonmusk, naval, sama"
}
```

**Response (Success - Single User):**
```json
{
  "success": true,
  "message": "Processed 1 username(s): 1 succeeded, 0 failed",
  "summary": {
    "total": 1,
    "succeeded": 1,
    "failed": 0
  },
  "results": [
    {
      "username": "elonmusk",
      "success": true,
      "message": "Successfully synced @elonmusk",
      "following_count": 523,
      "synced_at": "2025-11-09T12:30:00.000Z"
    }
  ]
}
```

**Response (Success - Multiple Users):**
```json
{
  "success": true,
  "message": "Processed 3 username(s): 3 succeeded, 0 failed",
  "summary": {
    "total": 3,
    "succeeded": 3,
    "failed": 0
  },
  "results": [
    {
      "username": "elonmusk",
      "success": true,
      "message": "Successfully synced @elonmusk",
      "following_count": 523,
      "synced_at": "2025-11-09T12:30:00.000Z"
    },
    {
      "username": "naval",
      "success": true,
      "message": "Successfully synced @naval",
      "following_count": 156,
      "synced_at": "2025-11-09T12:30:15.000Z"
    },
    {
      "username": "sama",
      "success": true,
      "message": "Successfully synced @sama",
      "following_count": 289,
      "synced_at": "2025-11-09T12:30:30.000Z"
    }
  ]
}
```

**Response (Partial Success):**
```json
{
  "success": true,
  "message": "Processed 3 username(s): 2 succeeded, 1 failed",
  "summary": {
    "total": 3,
    "succeeded": 2,
    "failed": 1
  },
  "results": [
    {
      "username": "elonmusk",
      "success": true,
      "message": "Successfully synced @elonmusk",
      "following_count": 523,
      "synced_at": "2025-11-09T12:30:00.000Z"
    },
    {
      "username": "unknown_user",
      "success": false,
      "message": "Person not found in important people list",
      "error": "Not found in database"
    },
    {
      "username": "sama",
      "success": true,
      "message": "Successfully synced @sama",
      "following_count": 289,
      "synced_at": "2025-11-09T12:30:30.000Z"
    }
  ]
}
```

**Status Codes:**
- `200`: All syncs succeeded
- `207`: Partial success (some failed, some succeeded)
- `500`: All failed

**Note:** This endpoint calls the N8N webhook at `https://mdhusainil.app.n8n.cloud/webhook/getFollowing` for each username and updates the following index.

---

## 2. Sync Following Data (N8N → Next.js)

### 2.1 Sync Following List
**Endpoint:** `POST /api/ranker/sync/following`

**Purpose:** Receive following data from N8N and update the inverse index

**⚠️ CRITICAL:** This is the main endpoint N8N workflows should POST to

**Request Body:**
```json
{
  "username": "elonmusk",
  "user_id": "44196397",
  "name": "Elon Musk",
  "following_list": [
    {
      "username": "naval",
      "user_id": "745273",
      "name": "Naval"
    },
    {
      "username": "pmarca",
      "user_id": "5426052",
      "name": "Marc Andreessen"
    },
    {
      "username": "sama",
      "user_id": "160655046",
      "name": "Sam Altman"
    }
  ]
}
```

**Field Descriptions:**
- `username` (required): Twitter username of the important person (without @)
- `user_id` (required): Twitter user ID of the important person
- `name` (required): Display name of the important person
- `following_list` (required): Array of users this important person follows
  - Each user must have: `username`, `user_id`
  - `name` is optional (will default to username if not provided)

**Note:** When syncing, N8N should provide user_id and name. This enriches the person record that was initially created with just the username.

**Response (Success):**
```json
{
  "success": true,
  "message": "Following data synced successfully",
  "data": {
    "username": "elonmusk",
    "synced_at": "2025-11-05T10:30:00.000Z",
    "following_count": 523,
    "processed": 523
  }
}
```

**Response (Error - Person Not Found):**
```json
{
  "error": "This user is not in the important people list or is inactive"
}
```

**What Happens During Sync:**
1. Validates the important person exists in the system
2. Removes old following relationships for this person
3. Adds new relationships to the inverse index
4. Recalculates importance scores for all affected users
5. Updates `last_synced` timestamp and `following_count`

---

## 3. Rank Engagers

### 3.1 Rank Tweet Engagers
**Endpoint:** `POST /api/ranker/rank-engagers`

**Purpose:** Rank a list of tweet engagers by their importance score

**Supported Request Formats:**

#### Format 1: Object Format (Direct API Calls)
```json
{
  "tweet_id": "1234567890123456789",
  "engagers": [
    {
      "username": "Legacy_Compass",
      "userId": "1429826188990627849",
      "name": "Masculine Revival",
      "bio": "Reviving The Warrior Spirit In Men.",
      "followers": 33819,
      "verified": false,
      "replied": true,
      "retweeted": true,
      "quoted": false
    },
    {
      "username": "user2",
      "userId": "222222",
      "name": "User Two",
      "bio": "Tech enthusiast",
      "followers": 1200,
      "verified": true,
      "replied": false,
      "retweeted": true,
      "quoted": false
    }
  ]
}
```

#### Format 2: N8N Array Format (Recommended for n8n)
Use `{{ $input.all() }}` in your HTTP Request node to send all items at once:

```json
[
  {
    "sheetdata": [{
      "tweet_url": "https://x.com/username/status/1234567890123456789",
      "author_name": "John Doe",
      "spreadsheetId": "..."
    }]
  },
  {
    "username": "Legacy_Compass",
    "userId": "1429826188990627849",
    "name": "Masculine Revival",
    "bio": "Reviving The Warrior Spirit In Men.",
    "followers": 33819,
    "verified": false,
    "replied": true,
    "retweeted": true,
    "quoted": false
  },
  {
    "username": "user2",
    "userId": "222222",
    "name": "User Two",
    "bio": "Tech enthusiast",
    "followers": 1200,
    "verified": true,
    "replied": false,
    "retweeted": true,
    "quoted": false
  }
]
```

**N8N Setup:**
- First item must contain `sheetdata` with `tweet_url`
- Tweet ID is automatically extracted from the URL
- Remaining items are the engager objects
- In your HTTP Request node JSON field, use: `{{ $input.all() }}`

**Field Descriptions:**
- `username` (required): Twitter username
- `userId` (required): Twitter user ID (camelCase)
- `name` (required): Display name
- `bio` (optional): User bio
- `followers` (optional): Follower count
- `verified` (optional): Verification status
- `replied` (optional): Did they reply to the tweet?
- `retweeted` (optional): Did they retweet?
- `quoted` (optional): Did they quote tweet?

**Response:**
```json
{
  "success": true,
  "message": "Engagers ranked successfully",
  "data": {
    "tweet_id": "1234567890123456789",
    "ranked_engagers": [
      {
        "username": "Legacy_Compass",
        "userId": "1429826188990627849",
        "name": "Masculine Revival",
        "bio": "Reviving The Warrior Spirit In Men.",
        "followers": 33819,
        "verified": false,
        "replied": true,
        "retweeted": true,
        "quoted": false,
        "importance_score": 15,
        "followed_by": [
          {
            "username": "elonmusk",
            "user_id": "44196397",
            "name": "Elon Musk"
          },
          {
            "username": "naval",
            "user_id": "745273",
            "name": "Naval"
          }
        ]
      },
      {
        "username": "user2",
        "userId": "222222",
        "name": "User Two",
        "bio": "Tech enthusiast",
        "followers": 1200,
        "verified": true,
        "replied": false,
        "retweeted": true,
        "quoted": false,
        "importance_score": 3,
        "followed_by": [
          {
            "username": "pmarca",
            "user_id": "5426052",
            "name": "Marc Andreessen"
          }
        ]
      }
    ],
    "statistics": {
      "total_engagers": 3,
      "engagers_with_score": 2,
      "engagers_without_score": 1,
      "max_score": 15,
      "avg_score": 6.0
    },
    "analyzed_at": "2025-11-05T10:30:00.000Z"
  }
}
```

**Performance:** This is an O(1) lookup operation thanks to the inverse index design!

**Note:** All engager metadata (bio, followers, verified, engagement types) is preserved in the response for future filtering/sorting capabilities.

---

## N8N Workflow Examples

### Example 1: Sync Important Person's Following List

**Workflow Steps:**
1. **HTTP Request** - Call Twitter API to get following list for important person
   - Method: GET
   - URL: `https://api.twitter.com/2/users/:user_id/following`
   - Authentication: Bearer Token

2. **Code Node** - Transform Twitter API response to our format
```javascript
const followingList = $input.first().json.data.map(user => ({
  username: user.username,
  user_id: user.id,
  name: user.name
}));

return {
  username: "elonmusk",
  user_id: "44196397",
  following_list: followingList
};
```

3. **HTTP Request** - Send to Next.js sync endpoint
   - Method: POST
   - URL: `http://localhost:3000/api/ranker/sync/following`
   - Body: Use output from previous node
   - Headers: `Content-Type: application/json`

---

### Example 2: Rank Tweet Engagers

**Workflow Steps:**
1. **HTTP Request** - Fetch tweet engagers from Twitter API
   - Get quote tweets, replies, likes, retweets for a specific tweet

2. **Code Node** - Extract unique engagers with rich metadata
```javascript
const engagers = $input.first().json.data.map(engagement => ({
  username: engagement.user.username,
  userId: engagement.user.id,  // Note: camelCase
  name: engagement.user.name,
  bio: engagement.user.description,
  followers: engagement.user.public_metrics?.followers_count,
  verified: engagement.user.verified,
  replied: engagement.type === 'replied',
  retweeted: engagement.type === 'retweeted',
  quoted: engagement.type === 'quoted'
}));

// Remove duplicates based on userId
const unique = [...new Map(engagers.map(e => [e.userId, e])).values()];

return {
  tweet_id: "1234567890123456789",
  engagers: unique
};
```

3. **HTTP Request** - Send to ranking endpoint
   - Method: POST
   - URL: `http://localhost:3000/api/ranker/rank-engagers`
   - Body: Use output from previous node

4. **Process Results** - Do something with ranked engagers
   - Export to Google Sheets
   - Send notification
   - Store in database

---

## Rate Limiting Considerations

### Twitter API Rate Limits
- **Following endpoint:** 15 requests per 15 minutes per user
- **User lookup:** 900 requests per 15 minutes per app

### Recommended N8N Schedule for Syncing
```
Weekly sync schedule:
- Saturday/Sunday: Low activity days
- Stagger syncs: 1 person every minute
- With 45 important people: ~45 minutes total
- Respects rate limits: Only 45 requests total
```

### N8N Workflow Settings
```json
{
  "settings": {
    "executionTimeout": 3600,
    "saveExecutionProgress": true,
    "saveManualExecutions": true
  },
  "nodes": {
    "Loop": {
      "batchSize": 1,
      "sleep": 60000
    }
  }
}
```

---

## Database Collections

### Collection: `important_people`
```javascript
{
  _id: ObjectId,
  username: "elonmusk",        // Unique index
  user_id: "44196397",         // Unique index
  name: "Elon Musk",
  following_count: 523,
  last_synced: ISODate("2025-11-05T09:15:00.000Z"),
  is_active: true,             // Index
  created_at: ISODate,
  updated_at: ISODate
}
```

### Collection: `following_index` (The Inverse Index)
```javascript
{
  _id: ObjectId,
  followed_username: "naval",           // Index
  followed_user_id: "745273",          // Unique index
  followed_by: [                       // Array of important people who follow this user
    {
      username: "elonmusk",
      user_id: "44196397",
      name: "Elon Musk"
    },
    {
      username: "pmarca",
      user_id: "5426052",
      name: "Marc Andreessen"
    }
  ],
  importance_score: 2,                 // Index (descending), equals followed_by.length
  updated_at: ISODate
}
```

### Collection: `engagement_rankings` (Cache)
```javascript
{
  _id: ObjectId,
  tweet_id: "1234567890123456789",    // Index
  ranked_engagers: [...],              // Full ranked list with scores
  analyzed_at: ISODate                 // Index (descending)
}
```

---

## Testing Checklist

### 1. Manual Testing via Admin UI
1. Visit `http://localhost:3000/ranker`
2. Add an important person
3. Verify they appear in the table

### 2. Test Sync Endpoint
```bash
curl -X POST http://localhost:3000/api/ranker/sync/following \
  -H "Content-Type: application/json" \
  -d '{
    "username": "elonmusk",
    "user_id": "44196397",
    "following_list": [
      {"username": "naval", "user_id": "745273", "name": "Naval"},
      {"username": "pmarca", "user_id": "5426052", "name": "Marc Andreessen"}
    ]
  }'
```

### 3. Test Ranking Endpoint
```bash
curl -X POST http://localhost:3000/api/ranker/rank-engagers \
  -H "Content-Type: application/json" \
  -d '{
    "tweet_id": "123456789",
    "engagers": [
      {
        "username": "naval",
        "userId": "745273",
        "name": "Naval",
        "followers": 500000,
        "verified": true,
        "replied": true,
        "retweeted": false,
        "quoted": false
      },
      {
        "username": "randomuser",
        "userId": "999999",
        "name": "Random User",
        "followers": 100,
        "verified": false,
        "replied": false,
        "retweeted": true,
        "quoted": false
      }
    ]
  }'
```

Expected: naval has importance_score > 0, randomuser has score = 0. All metadata is preserved in the response.

---

## Environment Variables

Add to your `.env.local`:
```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/
```

The system will automatically create the `twitter_ranker` database.

---

## Troubleshooting

### Issue: "Person not found in important people list"
**Solution:** Add the person via Admin UI or POST to `/api/ranker/admin/important-person` first

### Issue: Importance score is always 0
**Solution:** Make sure you've synced following data for at least one important person

### Issue: Sync taking too long
**Solution:** Check following_count - if someone follows 100k+ people, sync will take time. Consider filtering the following list in N8N.

### Issue: Duplicate key error
**Solution:** Person already exists. Use different username/user_id or delete the existing one first.

---

## Next Steps

1. **Create N8N Workflow** - Use examples above to build your sync workflow
2. **Schedule Weekly Sync** - Set up cron trigger in N8N for Saturday/Sunday
3. **Add Important People** - Populate your list via Admin UI
4. **Run First Sync** - Manually trigger N8N workflow to sync following data
5. **Start Ranking** - Use the rank-engagers endpoint to analyze tweets

---

## Support

For issues or questions, check:
- MongoDB connection in `.env.local`
- N8N webhook URLs are accessible
- Twitter API credentials are valid
- Rate limits not exceeded

**System is ready to use!** 🚀

