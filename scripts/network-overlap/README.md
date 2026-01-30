# Network Overlap Tool

Given a seed user (e.g., @veeraj), this tool tells you: **"For any Twitter account, how many people that Viraj follows also follow that account?"**

## How It Works

1. **Get seed user's following list** → These are the "important people"
2. **For each important person, get who THEY follow** → Build a map
3. **Flip the data** → Instead of "Person A follows [X, Y, Z]", store "X is followed by [A, B, C]"
4. **Query anytime** → "Who follows @randomuser?" → Instant lookup

## Commands

### Build Index
Build the network overlap index for a seed user:

```bash
npx tsx scripts/network-overlap/index.ts build --seed veeraj
```

This will:
1. Fetch the seed user's following list
2. For each person they follow, fetch who that person follows
3. Build a reverse index in MongoDB

If the build is interrupted, resume with:

```bash
npx tsx scripts/network-overlap/index.ts build --seed veeraj --resume
```

### Query Overlap
Look up overlap score for any account:

```bash
npx tsx scripts/network-overlap/index.ts query --username elonmusk
```

Output example:
```
@elonmusk
User ID: 44196397
Overlap Score: 12

Followed by:
  - @naval (Naval)
  - @pmarca (Marc Andreessen)
  - @balajis (Balaji)
  ...
```

### List Seed Users
Show all indexed seed users:

```bash
npx tsx scripts/network-overlap/index.ts list-seeds
```

### Top Accounts
Show accounts with highest overlap scores:

```bash
npx tsx scripts/network-overlap/index.ts top --limit 100
```

### Statistics
Show index statistics:

```bash
npx tsx scripts/network-overlap/index.ts stats
```

## Database

The tool uses a separate MongoDB database: `network_overlap`

### Collections

**seed_users**
- Tracks seed users and their following lists
- Used to track sync progress and enable resume

**following_index**
- The reverse lookup index
- Stores which "important people" follow each account
- Indexed by both user_id and username for fast lookups

## API Endpoints Used

- `GET https://api.twitterapi.io/twitter/user/info?userName=xxx`
- `GET https://api.twitterapi.io/twitter/user/followings?userName=xxx&cursor=xxx`

## Environment Variables

Uses the same Twitter API configuration as other scripts:
- `TWITTER_API_KEY` or `TWITTER_API_KEY_SHARED`
- `MONGODB_URI`

## File Structure

```
scripts/network-overlap/
├── index.ts     # Main CLI script
├── types.ts     # TypeScript types
├── api.ts       # TwitterAPI.io fetch functions
├── db.ts        # MongoDB connection
├── models.ts    # Database operations
└── README.md    # This file
```
