# Tweet Monitoring Endpoint Documentation

## Overview

The `social-capital-tool/monitor` module provides a complete system for tracking and recording engagement metrics of specific Tweets over time. It allows users to start monitoring a tweet, which then periodically collects metrics (Likes, Retweets, Replies, Quotes, Views, Bookmarks) and stores them as snapshots. This data is then visualized in a real-time dashboard.

## API Endpoints

### 1. Start Monitoring

Initiates the monitoring process for a specific tweet.

- **Endpoint**: `POST /api/monitor-tweet/start`
- **Description**: Validates the tweet URL, checks for existing active jobs, fetches initial metrics (including quote aggregates), creates a `MonitoringJob`, and stores the first `MetricSnapshot`.

**Request Body:**
```json
{
  "tweetUrl": "https://x.com/username/status/1234567890"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Monitoring started successfully...",
  "tweet_id": "1234567890",
  "job": {
    "tweet_id": "1234567890",
    "status": "active",
    "started_at": "2023-10-27T10:00:00.000Z"
  },
  "initial_quote_metrics": { ... }
}
```

**Error Responses:**
- `400 Bad Request`: Invalid URL or missing parameters.
- `409 Conflict`: Tweet is already being monitored.
- `429 Too Many Requests`: Twitter API rate limit exceeded.
- `401 Unauthorized`: Twitter API authentication failed.
- `402 Payment Required`: Twitter API credits exhausted.

### 2. Stop Monitoring

Manually stops the monitoring job for a tweet.

- **Endpoint**: `POST /api/monitor-tweet/stop`
- **Description**: Marks the monitoring job status as `completed`.

**Request Body:**
```json
{
  "tweetId": "1234567890"
}
// OR
{
  "tweetUrl": "https://x.com/username/status/1234567890"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Monitoring stopped successfully",
  "tweet_id": "1234567890"
}
```

### 3. Get Monitoring Data

Retrieves the current status and historical data for a monitored tweet.

- **Endpoint**: `GET /api/monitor-tweet/[tweetId]`
- **Description**: Returns the job details, all recorded metric snapshots, and calculated statistics (time remaining, activity status).

**Response (Success - 200):**
```json
{
  "success": true,
  "job": {
    "tweet_id": "1234567890",
    "status": "active", // or 'completed'
    "started_at": "2023-10-27T10:00:00.000Z"
  },
  "snapshots": [
    {
      "timestamp": "2023-10-27T10:00:00.000Z",
      "likeCount": 150,
      "retweetCount": 20,
      "replyCount": 5,
      "quoteCount": 2,
      "viewCount": 5000,
      "bookmarkCount": 10,
      "quoteViewSum": 1000,
      "quoteTweetCount": 2
    },
    // ... more snapshots
  ],
  "stats": {
    "total_snapshots": 15,
    "is_active": true,
    "hours_remaining": 71,
    "minutes_remaining": 55
  }
}
```

## Twitter API Integration (twitterapi.io)

The system relies on `twitterapi.io` to fetch real-time data. The integration is handled in `src/lib/external-api.ts`.

### Configuration
The system supports a "Hybrid" API key strategy to prevent rate limit exhaustion on critical monitoring tasks.

**Environment Variables:**
- `TWITTER_API_URL`: Base URL (default: `https://api.twitterapi.io`)
- `TWITTER_API_KEY_MONITOR`: **Dedicated key** for the monitoring endpoint. This ensures that heavy batch jobs (using the shared key) don't block the user from starting a new monitor.
- `TWITTER_API_KEY_SHARED`: Shared key for background batch operations.
- `TWITTER_API_KEY`: Fallback key if specific ones aren't set.

### Endpoints Used

#### 1. Fetch Tweet Metrics
Used to get the primary engagement stats (Likes, Retweets, etc.).
- **URL**: `GET /twitter/tweets`
- **Parameters**: `tweet_ids={id}`
- **Headers**: `X-API-Key: {API_KEY}`
- **Response Mapping**:
  - `likeCount` -> `likeCount`
  - `retweetCount` -> `retweetCount`
  - `replyCount` -> `replyCount`
  - `quoteCount` -> `quoteCount`
  - `viewCount` -> `viewCount`
  - `bookmarkCount` -> `bookmarkCount`

#### 2. Fetch Quote Tweets (Paginated)
Used to calculate `quoteViewSum` (total views across all quote tweets).
- **URL**: `GET /twitter/tweet/quotes`
- **Parameters**:
  - `tweetId={id}`
  - `includeReplies=true`
  - `cursor={pagination_cursor}`
- **Logic**:
  - The system recursively fetches pages until all quotes are retrieved or a safety limit is hit.
  - It sums the `viewCount` of every quote tweet found.
  - **Dynamic Page Limit**: The system calculates a dynamic page limit based on the parent tweet's `quoteCount` (approx 20 tweets per page) to avoid infinite loops or excessive API usage.

### Error Handling
- **429 (Rate Limit)**: Implements exponential backoff (wait 2s, 4s, 8s...) before retrying.
- **402 (Payment Required)**: Explicitly handled to warn users about exhausted API credits.
- **401/403 (Auth)**: Returns authentication errors immediately.

## Data Model

The system uses MongoDB to store monitoring data.

### MonitoringJob
Tracks the lifecycle of a monitoring task.
- `tweet_id`: Unique identifier for the tweet.
- `status`: `active` or `completed`.
- `started_at`: Timestamp when monitoring began.
- `created_at`: Record creation timestamp.

### MetricSnapshot
Represents the state of a tweet's metrics at a specific point in time.
- `tweet_id`: Reference to the job.
- `timestamp`: When the snapshot was taken.
- `likeCount`, `retweetCount`, `replyCount`, `quoteCount`, `viewCount`, `bookmarkCount`: Standard engagement metrics.
- `quoteViewSum`: Aggregated views from quote tweets.
- `quoteTweetCount`: Number of quote tweets included in the sum.

## End-to-End Implementation

To implement this system, you need three main components:

### 1. Backend & Database
- **Database**: MongoDB collections `monitoring_jobs` and `metric_snapshots`.
- **API Routes**: Next.js App Router handlers in `src/app/api/monitor-tweet`.
- **External API**: Integration with `twitterapi.io` (or similar) to fetch real-time tweet data.
- **Rate Limiting**: The `start` endpoint includes specific error handling for API rate limits (429) and credit exhaustion (402). It uses a dedicated API key (`monitor`) to segregate usage.

### 2. The Scheduler (Worker)
Monitoring relies on a background process to periodically fetch new data.
- **Script**: `scripts/job-scheduler.ts` (or similar cron job).
- **Logic**:
    1.  Finds all `active` jobs started within the last 72 hours (or configured duration).
    2.  Iterates through them and fetches fresh metrics from the external API.
    3.  Stores a new `MetricSnapshot`.
    4.  If the duration has passed (e.g., 5 days), marks the job as `completed`.

### 3. Frontend Dashboard (UI)
The visualization is built using React and Recharts.

- **Page**: `src/app/monitor/[tweetId]/page.tsx`
- **Features**:
    - **Real-time Updates**: Polls the GET endpoint every 30 seconds while the job is active.
    - **Status Indicators**: Shows if monitoring is active and how much time is remaining.
    - **Metric Cards**: Displays the latest values for Likes, Retweets, etc., with "growth since start" indicators (green text showing +N).
    - **Charts**: Uses `ComposedChart` with `Area` components to show the trend of each metric over time.
        - **X-Axis**: Time of snapshot.
        - **Y-Axis**: Metric count.
        - **Tooltip**: Shows exact values on hover.

#### UI Chart Implementation Example (Recharts)
```tsx
<ResponsiveContainer width="100%" height={260}>
  <ComposedChart data={chartData}>
    <defs>
      <linearGradient id="grad-Likes" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2F6FED" stopOpacity={0.35} />
        <stop offset="100%" stopColor="#2F6FED" stopOpacity={0.05} />
      </linearGradient>
    </defs>
    <XAxis dataKey="time" />
    <YAxis />
    <Tooltip />
    <Area
      type="monotone"
      dataKey="Likes"
      stroke="#2F6FED"
      fill="url(#grad-Likes)"
    />
  </ComposedChart>
</ResponsiveContainer>
```

## Configuration & Constraints

- **Duration**: Default monitoring duration is set to **5 days** (120 hours).
- **Frequency**: Data collection typically occurs every **5-15 minutes** (controlled by the scheduler).
- **Dependencies**:
    - `mongodb`: For data persistence.
    - `recharts`: For data visualization.
    - External Twitter API provider.
