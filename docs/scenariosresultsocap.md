# SOCAP Campaign Monitoring - User Scenarios & Results

This document explains what happens in different scenarios when using the SOCAP campaign monitoring system. Each scenario shows what you do, what the system does, and what you see.

---

## Scenario 1: Small Product Launch (3 Tweets, 3-Day Campaign)

### Setup
**What You Do**:
- Create campaign: "Product Launch Q1 2025"
- Add 1 main tweet (your company's announcement)
- Add 1 influencer tweet (influencer promoting your product)
- Add 1 investor tweet (investor sharing the news)
- Set monitor window: 3 days
- Set alert threshold: 10 (importance score)

**What Happens Behind the Scenes**:
- System resolves 3 tweet URLs to tweet IDs
- Creates campaign in database
- Initializes 12 worker jobs (3 tweets × 4 job types: retweets, replies, quotes, metrics)

### Day 1 - Hour 0 (Campaign Start)

**What You See**:
- Dashboard shows: 0 engagements, 0 alerts
- All 3 tweets listed with current metrics (e.g., Main: 50 likes, Influencer: 200 likes, Investor: 30 likes)

**What System Does**:
- Workers run every 30 minutes
- First run: Backfills all existing retweeters, replies, quotes for each tweet
- Finds: Main tweet has 5 retweeters, 3 replies, 1 quote
- Finds: Influencer tweet has 20 retweeters, 8 replies, 2 quotes
- Finds: Investor tweet has 2 retweeters, 1 reply, 0 quotes

**What You See After First Run**:
- Dashboard updates: Total 40 engagements across all tweets
- Engagement list shows: 27 retweeters, 12 repliers, 3 quoters
- No alerts yet (no one above importance score 10)

### Day 1 - Hour 2

**What System Does**:
- Metrics worker runs: Main tweet now has 75 likes (was 50), +25 delta
- Retweets worker: Finds 2 new retweeters on main tweet (7 total now)
- One new retweeter has importance score 15 (investor followed by important people)

**What You See**:
- Dashboard: Cumulative likes graph shows spike (+25 likes)
- Alert notification: "Investor @johnvc (importance: 15) retweeted your main tweet"
- Engagement list: New retweeter appears at top (sorted by importance)

### Day 1 - Hour 6

**What System Does**:
- Influencer tweet gets quote-tweeted by a founder (importance score 22)
- Main tweet gets 5 more replies
- Metrics: Influencer tweet gained 150 likes, 30 retweets

**What You See**:
- Alert: "Founder @techfounder (importance: 22) quote-tweeted your influencer tweet: 'This product is game-changing for developers!'"
- Dashboard metrics: 
  - Total likes: 225 (cumulative across all tweets)
  - Total retweets: 35
  - Total quotes: 4
- Pie chart: Shows breakdown - 2 investors, 1 founder, 5 developers, 30 others

### Day 2 - Hour 12

**What System Does**:
- Investor tweet gets retweeted by 3 VCs (all with importance scores 12-18)
- Main tweet gets reply from media account (importance score 8, below threshold, no alert)
- Total engagements: 65 across all tweets

**What You See**:
- 3 alerts spaced 5-7 minutes apart:
  1. "VC @venturecapital1 (importance: 18) retweeted your investor tweet"
  2. "VC @venturecapital2 (importance: 15) retweeted your investor tweet"
  3. "VC @venturecapital3 (importance: 12) retweeted your investor tweet"
- Dashboard: Engagement timeline shows steady growth
- Category breakdown: Now shows 5 investors, 1 founder, 8 developers

### Day 3 - End of Campaign

**What System Does**:
- Final metrics snapshot
- Campaign status changes to "completed"
- Workers stop running

**What You See**:
- Final report:
  - Total engagements: 120
  - Total likes: 1,500 (cumulative)
  - Total retweets: 85
  - Total quotes: 12
  - Total replies: 23
  - Unique accounts: 95 (some engaged multiple tweets)
- Top engagers list: Shows 10 most important accounts
- Time-series charts: Show growth over 3 days
- Category breakdown: 8 investors, 3 founders, 15 developers, 5 media, 64 others

---

## Scenario 2: Medium Campaign (10 Tweets, 7-Day Campaign)

### Setup
**What You Do**:
- Create campaign: "Series A Announcement"
- Add 2 main tweets (company announcement + follow-up)
- Add 5 influencer tweets (5 different influencers)
- Add 3 investor tweets (3 different investors)
- Set monitor window: 7 days
- Set alert threshold: 15 (higher threshold for less noise)

**What Happens Behind the Scenes**:
- System creates 10 tweets
- Initializes 40 worker jobs (10 tweets × 4 job types)

### Day 1 - First 6 Hours

**What System Does**:
- Processes all 10 tweets
- Finds initial engagements: 150 total
- 8 accounts have importance score > 15

**What You See**:
- Dashboard shows 10 tweets organized by category (Main, Influencer, Investor)
- 8 alerts sent over 20 minutes (spaced out):
  - 3 investors retweeted main tweets
  - 2 founders quote-tweeted influencer tweets
  - 3 VCs replied to investor tweets
- Engagement list: 150 engagers sorted by importance
- Cumulative metrics: Starting baseline established

### Day 2-3

**What System Does**:
- Steady growth: 20-30 new engagements per 30-minute run
- Metrics workers track: Likes growing from 500 → 1,200 → 2,500
- Some runs have 0 new high-importance engagers (no alerts)
- Some runs have 3-5 new high-importance engagers (alerts spaced out)

**What You See**:
- Dashboard updates every 30 minutes (cached for 1 minute for UI)
- Cumulative graphs show upward trend
- Alerts come in batches (when high-importance accounts engage)
- Can filter engagements by:
  - Tweet category (main/influencer/investor)
  - Action type (retweet/reply/quote)
  - Importance score threshold
  - Time range

### Day 4-5

**What System Does**:
- Peak engagement period
- One influencer tweet goes viral: 200 new retweeters in one run
- System processes delta efficiently (only new 200, not all retweeters)
- Multiple high-importance accounts engage

**What You See**:
- Dashboard shows spike in metrics for that influencer tweet
- 15 alerts over 20 minutes (all from same run, spaced out)
- Engagement list: Can see which accounts engaged with multiple tweets
  - Example: "Investor @bigvc engaged with 3 tweets: main (retweet), influencer1 (reply), investor1 (quote)"
- Cumulative graph: Sharp increase visible

### Day 6-7

**What System Does**:
- Engagement slows down (normal decay)
- Final metrics collection
- Campaign completion

**What You See**:
- Final report with complete statistics
- Total: 850 engagements across 10 tweets
- 45 unique high-importance accounts (importance > 15)
- Breakdown by category: 12 investors, 8 founders, 25 developers, 8 media, 797 others
- Time-series shows: Peak on day 4-5, gradual decline

---

## Scenario 3: Large Campaign (50 Tweets, 3-Day Campaign)

### Setup
**What You Do**:
- Create campaign: "Major Product Launch"
- Add 5 main tweets
- Add 30 influencer tweets (large influencer campaign)
- Add 15 investor tweets
- Set monitor window: 3 days
- Set alert threshold: 20 (very high, only top-tier alerts)

**What Happens Behind the Scenes**:
- System creates 50 tweets
- Initializes 200 worker jobs
- Job queue distributes work across multiple workers
- With 10 workers processing 5 jobs each: All jobs complete in ~25 minutes

### Day 1 - First Hour

**What System Does**:
- Processes all 50 tweets (200 jobs)
- Initial backfill: Finds 500 existing engagements
- Identifies 12 accounts with importance score > 20

**What You See**:
- Dashboard loads (may take 2-3 seconds due to data volume)
- 12 alerts sent over 20 minutes
- Engagement list: 500 engagers (paginated, 50 per page)
- Can filter by tweet category to see:
  - Main tweets: 50 engagements
  - Influencer tweets: 350 engagements
  - Investor tweets: 100 engagements

### Day 1 - Hour 2-6

**What System Does**:
- Each 30-minute run processes ~100-150 new engagements
- Job queue handles load efficiently
- Some tweets have no new engagements (workers skip quickly)
- Some tweets have many new engagements (workers process delta)

**What You See**:
- Dashboard updates show steady growth
- Alerts: 3-8 alerts per run (only very high importance)
- Cumulative metrics: 
  - Total likes: 5,000 → 8,000 → 12,000
  - Total retweets: 500 → 800 → 1,200
- Can drill down into specific tweet to see its individual metrics

### Day 2 - Peak Activity

**What System Does**:
- Viral moment: One influencer tweet gets 500 new retweeters in one run
- System processes efficiently: Only processes new 500 (not all retweeters)
- 25 high-importance accounts engage across various tweets

**What You See**:
- Dashboard shows major spike for that influencer tweet
- 25 alerts sent over 20 minutes (all from same run)
- Engagement timeline: Shows peak activity hour
- Can see which accounts engaged with multiple tweets:
  - "VC @topvc engaged with 5 tweets: main1 (retweet), influencer3 (quote), investor2 (reply), influencer7 (retweet), investor5 (quote)"

### Day 3 - Completion

**What System Does**:
- Final processing
- Generates comprehensive report
- Archives data

**What You See**:
- Final statistics:
  - Total engagements: 3,500
  - Unique accounts: 2,800 (some engaged multiple tweets)
  - High-importance accounts: 85 (importance > 20)
  - Total likes: 45,000
  - Total retweets: 3,200
  - Total quotes: 180
  - Total replies: 120
- Category breakdown: 25 investors, 15 founders, 200 developers, 30 media, 2,530 others
- Time-series charts: Show full 3-day progression with peak on day 2

---

## Scenario 4: Low Engagement Campaign

### Setup
**What You Do**:
- Create campaign: "Niche Product Launch"
- Add 1 main tweet, 2 influencer tweets, 1 investor tweet
- Set monitor window: 3 days
- Set alert threshold: 5 (lower threshold to catch any important engagement)

### What Happens

**Day 1-3**:
- Very few engagements: 2-5 per 30-minute run
- Most runs have 0 new engagements
- Only 1-2 high-importance accounts engage total

**What You See**:
- Dashboard shows minimal activity
- 1-2 alerts total over 3 days
- Engagement list: 15 total engagers
- Metrics: Slow, steady growth (50 likes → 75 likes → 100 likes)
- System still runs efficiently (workers quickly detect no new engagements)

---

## Scenario 5: High-Value Account Engages Multiple Tweets

### Setup
**What You Do**:
- Create campaign with 3 tweets (1 main, 1 influencer, 1 investor)
- Set alert threshold: 10

### What Happens

**Run 1**:
- Top investor (importance score 50) retweets main tweet

**What You See**:
- Alert: "Investor @topinvestor (importance: 50) retweeted your main tweet"
- Engagement list shows this account at top (sorted by importance)

**Run 2** (30 minutes later):
- Same investor replies to influencer tweet

**What You See**:
- Alert: "Investor @topinvestor (importance: 50) replied to your influencer tweet"
- Engagement list: Same account appears again (different engagement)
- Dashboard: Can see this account engaged with 2 tweets

**Run 3** (30 minutes later):
- Same investor quote-tweets investor tweet

**What You See**:
- Alert: "Investor @topinvestor (importance: 50) quote-tweeted your investor tweet"
- Engagement list: Shows all 3 engagements by this account
- Dashboard summary: "Top engager: @topinvestor engaged with all 3 tweets"

**Key Point**: System tracks each engagement separately, so you can see:
- Which accounts are most engaged
- Which tweets they engaged with
- What actions they took (retweet/reply/quote)

---

## Scenario 6: Alert Spacing & Batching

### Setup
**What You Do**:
- Create campaign with 5 tweets
- Set alert threshold: 10
- Set alert spacing: 20 minutes

### What Happens

**Run 1 (10:00 AM)**:
- System detects 50 new high-importance engagements
- All 50 alerts queued with `scheduled_send_time` distributed over 20 minutes

**What You See**:
- Alerts start arriving at 10:00 AM
- Alerts continue arriving every 2-3 minutes
- Last alert arrives at 10:20 AM
- All 50 alerts sent before next run

**Run 2 (10:30 AM)**:
- System detects 30 new high-importance engagements
- New batch of alerts queued

**What You See**:
- New alerts start at 10:30 AM
- Continue until 10:50 AM
- No overlap with previous batch

**Key Point**: You receive all important alerts, but they're spaced out so you're not overwhelmed. System ensures alerts from one run are sent before the next run starts.

---

## Scenario 7: Rate Limits & Error Handling

### Setup
**What You Do**:
- Create campaign with 100 tweets
- System processes normally

### What Happens

**Normal Operation**:
- Workers process jobs efficiently
- All jobs complete within 30-minute window

**Rate Limit Hit**:
- Twitter API returns rate limit error for one tweet's metrics worker
- System stores current baseline before error
- Worker sets `blocked_until` timestamp
- Other workers continue normally

**What You See**:
- Dashboard shows metrics for 99 tweets (one missing, will update later)
- No data loss (baseline stored)
- System continues processing other tweets

**Rate Limit Clears** (next run):
- Worker resumes with stored baseline
- Fetches new metrics
- Calculates accurate delta (new - stored baseline)

**What You See**:
- Dashboard updates with complete metrics
- Delta calculation is accurate (no double-counting)

**Key Point**: System handles errors gracefully. You might see temporary gaps, but data is never lost and calculations remain accurate.

---

## Scenario 8: Campaign Completion & Final Report

### Setup
**What You Do**:
- Create 7-day campaign
- Monitor for full duration

### What Happens

**Days 1-6**:
- Normal monitoring and alerts
- Dashboard updates every 30 minutes

**Day 7 - Final Hour**:
- System detects monitor window ending
- Triggers final report generation
- Freezes all metrics
- Calculates final statistics

**What You See**:
- Campaign status changes to "Completed"
- Final report available:
  - Total engagements: 1,250
  - Unique accounts: 950
  - High-importance accounts: 45
  - Total likes: 25,000
  - Total retweets: 1,800
  - Total quotes: 120
  - Total replies: 330
  - Category breakdown with percentages
  - Time-series charts for entire campaign
  - Top 20 engagers list
  - Engagement timeline
- Dashboard remains accessible for historical viewing
- No more alerts (campaign completed)
- Workers stop running (saves resources)

**Key Point**: You get a comprehensive final report with all statistics, and the dashboard remains available for reference even after completion.

---

## Scenario 9: Filtering & Dashboard Views

### Setup
**What You Do**:
- Campaign with 20 tweets running
- Want to analyze specific data

### What You Can Do

**Filter Engagements**:
- By tweet category: "Show only main tweet engagements"
- By action type: "Show only retweets"
- By importance: "Show only accounts with importance > 15"
- By time: "Show engagements from last 24 hours"
- Combined: "Show retweets on influencer tweets with importance > 20 from today"

**What You See**:
- Filtered engagement list updates instantly
- Metrics recalculate for filtered view
- Charts update to show filtered data

**View Tweet-Specific Data**:
- Click on any tweet in dashboard
- See: Individual metrics, engagers for that tweet, timeline for that tweet

**View Account-Specific Data**:
- Click on any engager
- See: All tweets this account engaged with, engagement types, timestamps

**Compare Categories**:
- View: "Main tweets vs Influencer tweets vs Investor tweets"
- See: Separate metrics for each category
- Understand: Which category drives most engagement

**Key Point**: Dashboard is flexible - you can drill down into any level of detail you need.

---

## Scenario 10: Real-Time Updates

### Setup
**What You Do**:
- Campaign running
- Dashboard open in browser

### What Happens

**Every 30 Minutes**:
- Workers run and process new engagements
- Database updates with new data

**Dashboard Refresh**:
- Dashboard auto-refreshes every 1 minute (or manual refresh)
- Shows latest data from cache (1-minute TTL)
- If new engagement detected, cache invalidates and fresh data loads

**What You See**:
- Metrics update: "Total likes: 1,000 → 1,050" (new 50 likes)
- New engagers appear in list
- Charts update with new data points
- Alerts arrive (if configured for browser notifications)

**Key Point**: Dashboard stays current with minimal delay. You see updates within 1-2 minutes of engagement happening.

---

## Summary: What Users Experience

### Simple Workflow
1. **Create Campaign**: Fill form with tweet URLs, set preferences
2. **Wait**: System runs automatically every 30 minutes
3. **Receive Alerts**: Get notified when important accounts engage
4. **View Dashboard**: See real-time metrics, engagement lists, charts
5. **Get Report**: Final report at campaign end

### What You See
- **Dashboard**: Real-time metrics, charts, engagement lists
- **Alerts**: Notifications when high-importance accounts engage
- **Reports**: Comprehensive statistics and breakdowns
- **Filters**: Flexible views of your data

### What You Don't Need to Do
- Manually check tweets
- Calculate metrics
- Track engagements
- Monitor for important accounts
- Generate reports

### System Handles
- Processing 1 tweet or 500 tweets
- Handling rate limits gracefully
- Spacing out alerts
- Tracking deltas efficiently
- Generating comprehensive reports
- Maintaining data accuracy

---

## Key Takeaways

1. **Scalability**: System handles small (3 tweets) to large (500+ tweets) campaigns efficiently
2. **Real-Time**: Updates every 30 minutes, visible within 1-2 minutes
3. **Smart Alerts**: Only important engagements trigger alerts, spaced out to avoid spam
4. **Comprehensive Tracking**: Every engagement tracked separately, can see account's full engagement history
5. **Flexible Views**: Filter and analyze data any way you need
6. **Reliable**: Handles errors gracefully, no data loss
7. **Complete Reports**: Final reports show everything you need to understand campaign performance

