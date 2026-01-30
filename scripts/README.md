# Scripts Guide

Standalone SOCAP/ranker utilities you can run with `npx tsx scripts/<file> ...` unless otherwise noted.

## 🔧 Setup (once)
- Node 18+ with native `fetch`.
- `npm install` (repo root).
- `.env` with required environment variables (see below).
- Optional: `REQUEST_INTERVAL_MS`, `MAX_PAGES`, etc. to tune rate limits (see individual scripts).

### Required Environment Variables

```bash
# Database
MONGODB_URI=mongodb+srv://...  # MongoDB connection string (ranker & socap DBs)

# Twitter API (Hybrid Key Setup - recommended for rate limit distribution)
TWITTER_API_KEY_MONITOR=...   # Dedicated key for monitoring (protected)
TWITTER_API_KEY_SHARED=...    # Shared key for batch operations (jobs, narratives, aggregates)
# OR use single key (backward compatible):
TWITTER_API_KEY=...           # Fallback if specific keys not set

TWITTER_API_URL=https://api.twitterapi.io  # Optional, defaults to twitterapi.io

# OpenAI (for narrative scans)
OPENAIAPIKEY=sk-...

# Application URLs
NEXT_PUBLIC_BASE_URL=https://your-app.vercel.app
AUTO_SYNC_BASE_URL=http://localhost:3000  # For local sync scripts
```

### Twitter API Key Strategy (Hybrid)

To prevent rate limit issues, we use a **hybrid API key approach**:

| Key | Used By | Purpose |
|-----|---------|---------|
| `TWITTER_API_KEY_MONITOR` | Monitoring endpoints | **Protected** - always available for real-time monitoring |
| `TWITTER_API_KEY_SHARED` | Jobs, narratives, aggregates | **Shared** - for batch operations that can tolerate delays |

If you only have one API key, just set `TWITTER_API_KEY` and it will be used for everything (backward compatible).

## 📚 Script reference

### Data ingestion & aggregation
- `aggregate-quote-metrics.ts` — Fetches quote tweets for campaign tweets and sums quote metrics into parent tweets. Args: `--campaign <id>`; optional `--category main|influencer|investor|all`, `--tweet <id>`, `--maxPages N` (default 60), `--intervalMs 500`. Run: `npx tsx scripts/aggregate-quote-metrics.ts --campaign <id>`.
- `aggregate-nested-quote-metrics.ts` — Fetches quotes-of-quotes for stored quote tweets and updates nested metrics. Args: `--campaign <id>`; optional `--quote <quoteTweetId>`, `--maxPages N`, `--intervalMs ms`. Run: `npx tsx scripts/aggregate-nested-quote-metrics.ts --campaign <id>`.
- `fetch-replies-logged.ts` — Logs and ingests replies for campaign tweets into engagements/replies collections. Args: `--campaign <id>`; optional `--category main|influencer|investor|all`, `--tweet <id>`, `--maxPages`, `--intervalMs`. Run: `npx tsx scripts/fetch-replies-logged.ts --campaign <id>`.
- `fetch-nested-quotes-logged.ts` — Logs and ingests quotes-of-quotes for campaign quote tweets into nested quote collection. Args: `--campaign <id>`; optional `--parent <quoteTweetId>`, `--maxPages`, `--intervalMs`. Run: `npx tsx scripts/fetch-nested-quotes-logged.ts --campaign <id>`.
- `populate-second-order-engagements.ts` — For each quote tweet in a campaign, fetches its retweets/replies and stores “second-order” engagements. Args: `--campaign <id>`; env: `SECOND_ORDER_MAX_PAGES` (default 10), `SECOND_ORDER_REQUEST_INTERVAL_MS` (default 500). Run: `npx tsx scripts/populate-second-order-engagements.ts --campaign <id>`.

### Narrative / LLM scans
- `narrative-scan.ts` — LLM-filters quote tweets for a campaign and writes a JSON report. Args: `--campaign-id <id>`; optional `--batch-size`, `--max-quotes`, `--output <file>`. Env: `OPENAIAPIKEY`. Run: `npx tsx scripts/narrative-scan.ts --campaign-id <id>`.
- `nested-narrative-scan.ts` — Same as above but for nested quote tweets. Args: `--campaign-id <id>`; optional `--batch-size`, `--max-quotes`, `--output`. Env: `OPENAIAPIKEY`. Run: `npx tsx scripts/nested-narrative-scan.ts --campaign-id <id>`.
- `reply-narrative-scan.ts` — LLM-filters replies for a campaign and writes a JSON report. Args: `--campaign-id <id>`; optional `--batch-size`, `--max-replies`, `--output`. Env: `OPENAIAPIKEY`. Run: `npx tsx scripts/reply-narrative-scan.ts --campaign-id <id>`.

### Sync & data hygiene (ranker)
- `auto-sync-low-followers.ts` — Finds unsynced `important_people` with following count ≤6000 via twitterapi.io, then calls `/api/ranker/admin/sync-person`. Env: `MONGODB_URI`, `TWITTER_API_KEY`, `AUTO_SYNC_BASE_URL` (default `http://localhost:3000`). Run: `npx tsx scripts/auto-sync-low-followers.ts`.
- `auto-sync-low-followers-local.ts` — Directly pages followings (up to threshold 10k by default) and posts cleaned list to `/api/ranker/sync/following`; supports `--username` to force one user. Env: `TWITTER_API_KEY`, `AUTO_SYNC_BASE_URL`, `REQUEST_INTERVAL_MS` (default 750), `MAX_REQUESTS` (default 3000). Run: `npx tsx scripts/auto-sync-low-followers-local.ts [--username <handle>]`.
- `auto-sync-followers-local-backend.ts` — Single-user sync helper that pages followings locally and posts to `/api/ranker/sync/following`. Args: `--username <handle>`; env: `TWITTER_API_KEY`, `AUTO_SYNC_BASE_URL`, `REQUEST_INTERVAL_MS` (default 500), `MAX_REQUESTS` (default 500). Run: `npx tsx scripts/auto-sync-followers-local-backend.ts --username <handle>`.
- `cleanup-malformed-usernames.ts` — Deletes `important_people` rows whose `username` contains commas (malformed bulk adds). **Destructive**; no args. Run: `npx tsx scripts/cleanup-malformed-usernames.ts`.

### Alerts & campaign maintenance
- `mark-invalid-alerts.ts` — Marks alerts as skipped when their engagement’s tweet_id is not in the campaign. Args: `<campaign-id>` or `--all`. Run: `npx tsx scripts/mark-invalid-alerts.ts <campaign-id>` or `--all`.
- `regenerate-alerts.ts` — Re-runs alert detection for a campaign via `detectAndQueueAlerts`. Args: `<campaign-id>`. Run: `npx tsx scripts/regenerate-alerts.ts <campaign-id>`.

### Worker & scheduling
- `socap-worker.ts` — Long-running worker that pulls and processes SOCAP jobs. Env: `SOCAP_WORKER_CONCURRENCY` (default 5), `SOCAP_MAX_JOBS_PER_BATCH` (default 100) plus DB/API envs. Run: `npm run worker` or `npx tsx scripts/socap-worker.ts` (keep process alive, e.g., PM2/systemd).
- `turbo-worker.ts` — **High-performance worker for processing large job backlogs quickly.** 3× faster than the regular worker with progress tracking, ETA display, and automatic stats. Env: `SOCAP_TURBO_CONCURRENCY` (default 15), `SOCAP_MAX_JOBS_PER_BATCH` (default 500), `SOCAP_TURBO_DELAY` (default 100ms). Run: `npm run turbo-worker` or with custom concurrency: `npx tsx scripts/turbo-worker.ts --concurrency=25`. **Campaign-specific processing:** `npx tsx scripts/turbo-worker.ts --campaign=<campaign_id>` — processes ONLY jobs for that campaign, ignoring all others.
- `job-scheduler.ts` — Cron scheduler that hits SOCAP endpoints to enqueue/run workers. Env: `NEXT_PUBLIC_BASE_URL` (defaults to `https://identity-labs-x.vercel.app`). Run: `npx tsx scripts/job-scheduler.ts` (or `npm run scheduler`). PM2 example: `pm2 start scripts/job-scheduler.ts --interpreter=node --interpreter-args="--loader tsx"`.

Default schedule inside `job-scheduler.ts`:
| Job | Endpoint | Interval | Purpose |
|---|---|---|---|
| Create Jobs | `/api/socap/workers/trigger` | */15 * * * * | Enqueue jobs for active campaigns |
| Process Jobs | `/api/socap/workers/run` | */5 * * * * | Process queued jobs |

To change or add jobs, edit the `JOBS` array in `job-scheduler.ts` (cron syntax such as `*/5 * * * *` for every 5 minutes). Keep Node 18+ so `fetch` is available.

### Batch helpers
- `run-all-campaigns.ts` — Wrapper script that runs any campaign-specific script for ALL active campaigns. Used by GitHub Actions for automated scheduling. Usage: `npx tsx scripts/run-all-campaigns.ts --script narrative-scan [--dry-run]`.

### Influencer export (one-off)
- `influencer-metrics-export.ts` — Reads a list of influencer usernames/URLs, fetches each account’s latest **50 non-reply tweets**, computes averages/medians (views/likes/retweets/replies/quotes) and content-mix ratios (original/retweet/quote), enriches with ranker `importance_score` + important followers, and writes `likes.xlsx`.
  - Run: `npx tsx scripts/influencer-metrics-export.ts --input <file.(txt|csv|xlsx)> --output likes.xlsx`
  - Env: `TWITTER_API_KEY_SHARED` (or `TWITTER_API_KEY`), `MONGODB_URI`
  - Optional: `--tweets 50`, `--concurrency 3` (QPS still limited by `TWITTER_QPS_LIMIT`)

### Viral creator discovery (yearly)
- `viral-accounts-year.ts` — Collects the **Top** tweets for each week over ~1 year, extracts authors + metrics, and outputs:
  - `Tweets` sheet: Keyword → Week → Tweet → Author → Metrics
  - `Accounts` sheet: deduped + aggregated accounts (includes `keywords`)
  - `Seeds` sheet: deduped accounts formatted for downstream scoring
  - `Todo` sheet: filtered worklist for outreach (default: peak views ≥ 50k)
  - Run (default ~60 weeks, 50 tweets/week): `npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 50 --out viral-accounts-year.xlsx`
  - Minimal “no keyword” + “less noise” (recommended starting point): `npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 50 --lang en --minFaves 500 --out viral-accounts-year.xlsx`
  - Optional view threshold (applied post-fetch via `viewCount`): `npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 50 --lang en --minFaves 500 --minViewCount 50000 --out viral-accounts-year.xlsx`
  - Creator-first recommended query (exclude replies/retweets): `npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 50 --queryBase "-filter:replies -filter:retweets" --out viral-accounts-year.xlsx`
  - Multiple keywords (single run):
    - Put keywords in a file (one per line), e.g. `keywords.txt`:
      - `finance`
      - `marketing`
      - `digital marketing`
      - `tech`
    - Run: `npx tsx scripts/viral-accounts-year.ts --weeks 60 --tweetsPerWeek 30 --maxPagesPerWeek 2 --lang en --minFaves 1000 --keywordsFile keywords.txt --out viral-keywords.xlsx --seedOut seeds.txt`
  - Env: `TWITTER_API_KEY_SHARED` (or `TWITTER_API_KEY`)

---

## 🤖 GitHub Actions (Automated Scheduling)

GitHub Actions workflows run your scripts automatically on a schedule, even when your laptop is off. Located in `.github/workflows/`.

### Quick Setup

1. **Initialize Git** (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   ```

2. **Create GitHub Repository**:
   - Go to [github.com/new](https://github.com/new) and create a new repo
   - Push your code:
     ```bash
     git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
     git branch -M main
     git push -u origin main
     ```

3. **Add Repository Secrets** (Settings → Secrets and variables → Actions → New repository secret):

   | Secret Name | Description |
   |-------------|-------------|
   | `MONGODB_URI` | MongoDB connection string |
   | `TWITTER_API_KEY_SHARED` | Twitter API key for batch operations (jobs, narratives, aggregates) |
   | `TWITTER_API_URL` | Twitter API base URL (optional) |
   | `OPENAIAPIKEY` | OpenAI API key (for narrative scans) |
   | `NEXT_PUBLIC_BASE_URL` | Your deployed app URL (e.g., `https://identity-labs-x.vercel.app`) |
   
   **Note:** GitHub Actions only runs batch operations (jobs, narratives, aggregates), so it only needs `TWITTER_API_KEY_SHARED`. Your Vercel deployment should have `TWITTER_API_KEY_MONITOR` for the monitoring endpoints.

4. **Enable Actions**: Go to Actions tab in your repo and enable workflows.

### Workflow Schedule

| Workflow | File | Schedule | What it does |
|----------|------|----------|--------------|
| Job Scheduler | `job-scheduler.yml` | Every 15 min | Triggers worker endpoints to create and process jobs |
| SOCAP Worker | `socap-worker.yml` | Every 5 min | Processes queued jobs via turbo-worker |
| Narrative Scans | `narrative-scans.yml` | Every 12 min | Runs LLM analysis on all campaigns |
| Aggregate Metrics | `aggregate-metrics.yml` | Every 15 min | Fetches and aggregates quote metrics |

### Manual Triggers

All workflows can be triggered manually from the GitHub Actions UI:
1. Go to Actions → Select workflow → "Run workflow"
2. Optionally specify a campaign ID or other parameters

### Monitoring

- View workflow runs: **Actions** tab in your GitHub repo
- Check logs: Click on any workflow run to see detailed logs
- Notifications: Enable email/Slack notifications for failures in Settings

### Important Notes

- **GitHub Actions timeout**: 6 hours per job (plenty for most scripts)
- **Cron accuracy**: GitHub may delay cron jobs by 5-15 min during peak times
- **Free tier limits**: 2,000 min/month for private repos (unlimited for public)
- **Secrets**: Never commit `.env` files; use GitHub Secrets instead

---

## 🚂 Railway Deployment (Alternative)

For truly **continuous** workers that need to run 24/7, consider Railway:

1. Create a Railway account at [railway.app](https://railway.app)
2. Connect your GitHub repo
3. Add environment variables in Railway dashboard
4. Create a service for the worker with start command:
   ```bash
   npm run turbo-worker
   ```

Railway is pay-per-usage (~$5-10/month for workers) and has no timeout limits.

