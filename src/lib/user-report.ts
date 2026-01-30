import { categorizeEngager } from '@/lib/analyze-engagers';
import {
  getEngagersCollection,
  getTweetsCollection,
  type Engager,
  type Tweet,
} from '@/lib/models/tweets';
import { Document } from 'mongodb';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

function formatNumber(value: number, precision = 2): number {
  return Number(Number.isFinite(value) ? value.toFixed(precision) : value);
}

const FOLLOWER_TIER_DEFS = [
  { label: '1M+', min: 1_000_000, max: Number.POSITIVE_INFINITY, range: '1000000-+' },
  { label: '500K-1M', min: 500_000, max: 1_000_000, range: '500000-1000000' },
  { label: '200K-500K', min: 200_000, max: 500_000, range: '200000-500000' },
  { label: '100K-200K', min: 100_000, max: 200_000, range: '100000-200000' },
  { label: '50K-100K', min: 50_000, max: 100_000, range: '50000-100000' },
  { label: '10K-50K', min: 10_000, max: 50_000, range: '10000-50000' },
  { label: '<10K', min: 0, max: 10_000, range: '0-10000' },
];

const CATEGORY_LABELS = {
  founders: 'Founders / CEOs',
  vcs: 'Investors & VCs',
  ai_creators: 'AI Creators',
  media: 'Media & Press',
  developers: 'Developers',
  c_level: 'C-Level Operators',
  yc_alumni: 'YC Alumni',
  others: 'General Audience',
} as const;

export type ProfileCategoryKey = keyof typeof CATEGORY_LABELS;

export interface MetricTotals {
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
  views: number;
  bookmarks: number;
}

export interface TimelinePoint {
  tweetId: string;
  tweetUrl: string;
  createdAt: string;
  totalEngagers: number;
  likes: number | null;
  retweets: number | null;
  quotes: number | null;
  replies: number | null;
  views: number | null;
  bookmarks: number | null;
}

export interface MomentumPoint {
  tweetId: string;
  createdAt: string;
  rollingEngagers: number;
  rollingViews: number | null;
}

export interface EngagementMix {
  repliedPct: number;
  retweetedPct: number;
  quotedPct: number;
}

export interface ImportanceStats {
  average: number;
  max: number;
  population: number;
}

export interface FollowerTier {
  tier: string;
  count: number;
  range: string;
}

export interface TweetEngagement {
  tweetId: string;
  tweetUrl: string;
  actions: string[]; // ['replied', 'retweeted', 'quoted']
}

export interface TopValuableEngager {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  followers: number;
  verified: boolean;
  importance_score: number;
  tweetEngagements: TweetEngagement[];
}

export interface EngagerRollup {
  totalEngagements: number;
  uniqueEngagers: number;
  repeatEngagements: number;
  verifiedCount: number;
  nonVerifiedCount: number;
  highFollowerCount: number;
  highFollowerShare: number;
  topFollowerTier: string | null;
  engagementMix: EngagementMix;
  importance: ImportanceStats;
  topValuableEngagers: TopValuableEngager[];
  followerTiers: FollowerTier[];
}

export interface HighImportanceEngager {
  userId: string;
  username: string;
  name: string;
  followers: number;
  importanceScore: number;
  engagementTypes: string[];
  verified: boolean;
  categories: string[];
}

export interface NetworkReachGroup {
  role: string;
  category: ProfileCategoryKey;
  engagers: HighImportanceEngager[];
}

export interface ProfileDistributionEngager {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  followers: number;
  verified: boolean;
  importanceScore?: number;
}

export interface ProfileDistributionCategory {
  key: ProfileCategoryKey;
  label: string;
  count: number;
  percentage: number;
  engagers: ProfileDistributionEngager[];
}

export interface ProfileDistribution {
  totalEngagers: number;
  categories: ProfileDistributionCategory[];
}

export interface ReportPointer {
  tweetId: string;
  tweetUrl: string;
  createdAt: string;
  analyzedAt: string | null;
  totalEngagers: number;
  status: Tweet['status'];
  summarySnippet?: string;
}

export interface AIReportStatus {
  completedCount: number;
  backlogCount: number;
  completedReports: ReportPointer[];
  backlog: ReportPointer[];
}

export interface UserReportPayload {
  author: {
    name: string;
    username?: string;
  };
  metricTotals: MetricTotals;
  timeline: {
    points: TimelinePoint[];
    momentum: MomentumPoint[];
  };
  engagers: EngagerRollup;
  networkReach: {
    totalHighImportance: number;
    groups: NetworkReachGroup[];
  };
  profileDistribution: ProfileDistribution;
  aiReports: AIReportStatus;
}

export interface UserReportClientSummary {
  identifier: string;
  name: string;
  username?: string;
  tweetCount: number;
  lastTweetAt: string;
  lastAnalyzedAt: string | null;
}

type AggregatedEngager = {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  location?: string;
  followers: number;
  verified: boolean;
  replied: boolean;
  retweeted: boolean;
  quoted: boolean;
  liked: boolean;
  importance_score?: number;
  followed_by?: string[];
  engagements: number;
  tweetEngagements: TweetEngagement[];
};

function getFollowerTierLabel(value: number | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const tier = FOLLOWER_TIER_DEFS.find((entry) => value >= entry.min && value < entry.max);
  return tier ? tier.label : null;
}

function buildTimeline(tweets: Tweet[]): TimelinePoint[] {
  return tweets
    .map((tweet) => {
      const metrics = tweet.metrics;
      return {
        tweetId: tweet.tweet_id,
        tweetUrl: tweet.tweet_url,
        createdAt: tweet.created_at.toISOString(),
        totalEngagers: tweet.total_engagers,
        likes: metrics ? metrics.likeCount : null,
        retweets: metrics ? metrics.retweetCount : null,
        quotes: metrics ? metrics.quoteCount : null,
        replies: metrics ? metrics.replyCount : null,
        views: metrics ? metrics.viewCount : null,
        bookmarks: metrics ? metrics.bookmarkCount : null,
      };
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function buildMomentum(points: TimelinePoint[], windowSize = 3): MomentumPoint[] {
  if (points.length === 0) {
    return [];
  }

  return points.map((point, idx) => {
    const start = Math.max(0, idx - (windowSize - 1));
    const slice = points.slice(start, idx + 1);
    const engAverage =
      slice.reduce((sum, entry) => sum + entry.totalEngagers, 0) / slice.length;

    const viewsSlice = slice.filter((entry) => entry.views !== null) as Array<
      TimelinePoint & { views: number }
    >;
    const viewAverage =
      viewsSlice.length > 0
        ? viewsSlice.reduce((sum, entry) => sum + (entry.views ?? 0), 0) / viewsSlice.length
        : null;

    return {
      tweetId: point.tweetId,
      createdAt: point.createdAt,
      rollingEngagers: formatNumber(engAverage),
      rollingViews: viewAverage !== null ? formatNumber(viewAverage) : null,
    };
  });
}

function aggregateEngagers(
  allEngagers: Engager[],
  tweetsMap: Map<string, Tweet>,
): {
  rollup: EngagerRollup;
  aggregated: AggregatedEngager[];
} {
  const map = new Map<string, AggregatedEngager>();

  for (const engager of allEngagers) {
    const existing = map.get(engager.userId);
    
    // Build actions array for this tweet
    const actions: string[] = [];
    if (engager.replied) actions.push('replied');
    if (engager.retweeted) actions.push('retweeted');
    if (engager.quoted) actions.push('quoted');
    if (engager.liked) actions.push('liked');
    
    // Get tweet URL
    const tweet = tweetsMap.get(engager.tweet_id);
    const tweetEngagement: TweetEngagement = {
      tweetId: engager.tweet_id,
      tweetUrl: tweet?.tweet_url || `https://twitter.com/i/status/${engager.tweet_id}`,
      actions,
    };
    
    if (!existing) {
      map.set(engager.userId, {
        userId: engager.userId,
        username: engager.username,
        name: engager.name,
        bio: engager.bio,
        location: engager.location,
        followers: engager.followers,
        verified: engager.verified,
        replied: engager.replied,
        retweeted: engager.retweeted,
        quoted: engager.quoted,
        liked: Boolean(engager.liked),
        importance_score: engager.importance_score,
        followed_by: engager.followed_by ? [...engager.followed_by] : undefined,
        engagements: 1,
        tweetEngagements: [tweetEngagement],
      });
      continue;
    }

    existing.replied ||= engager.replied;
    existing.retweeted ||= engager.retweeted;
    existing.quoted ||= engager.quoted;
    existing.liked ||= Boolean(engager.liked);
    existing.verified ||= engager.verified;
    existing.followers = Math.max(existing.followers, engager.followers);
    existing.importance_score = Math.max(
      existing.importance_score || 0,
      engager.importance_score || 0,
    ) || undefined;
    if (engager.bio && (!existing.bio || engager.bio.length > existing.bio.length)) {
      existing.bio = engager.bio;
    }
    if (engager.location && !existing.location) {
      existing.location = engager.location;
    }
    if (engager.followed_by && engager.followed_by.length > 0) {
      const current = new Set(existing.followed_by || []);
      for (const username of engager.followed_by) {
        current.add(username);
      }
      existing.followed_by = Array.from(current);
    }
    
    // Add tweet engagement if it has actions
    if (actions.length > 0) {
      // Check if we already have engagement for this tweet
      const existingTweetEngagement = existing.tweetEngagements.find(
        (te) => te.tweetId === engager.tweet_id,
      );
      if (existingTweetEngagement) {
        // Merge actions if tweet already tracked
        const combinedActions = new Set([
          ...existingTweetEngagement.actions,
          ...actions,
        ]);
        existingTweetEngagement.actions = Array.from(combinedActions);
      } else {
        existing.tweetEngagements.push(tweetEngagement);
      }
    }
    
    existing.engagements += 1;
  }

  const aggregated = Array.from(map.values());
  const totalEngagements = allEngagers.length;
  const uniqueEngagers = aggregated.length;
  const repeatEngagements = Math.max(totalEngagements - uniqueEngagers, 0);

  const verifiedCount = aggregated.filter((engager) => engager.verified).length;
  const nonVerifiedCount = uniqueEngagers - verifiedCount;
  const highFollowerCount = aggregated.filter((engager) => engager.followers >= 10_000).length;
  const highFollowerShare =
    uniqueEngagers > 0 ? formatNumber((highFollowerCount / uniqueEngagers) * 100) : 0;
  const topFollowerTier = getFollowerTierLabel(
    aggregated.reduce((max, engager) => Math.max(max, engager.followers), 0),
  );

  const engagementMix: EngagementMix = {
    repliedPct:
      uniqueEngagers > 0
        ? formatNumber(
            (aggregated.filter((engager) => engager.replied).length / uniqueEngagers) * 100,
          )
        : 0,
    retweetedPct:
      uniqueEngagers > 0
        ? formatNumber(
            (aggregated.filter((engager) => engager.retweeted).length / uniqueEngagers) * 100,
          )
        : 0,
    quotedPct:
      uniqueEngagers > 0
        ? formatNumber(
            (aggregated.filter((engager) => engager.quoted).length / uniqueEngagers) * 100,
          )
        : 0,
  };

  const importanceScores = aggregated
    .map((engager) => engager.importance_score || 0)
    .filter((score) => score > 0);
  const importance: ImportanceStats = {
    average:
      importanceScores.length > 0
        ? formatNumber(
            importanceScores.reduce((sum, score) => sum + score, 0) / importanceScores.length,
          )
        : 0,
    max: importanceScores.length > 0 ? formatNumber(Math.max(...importanceScores)) : 0,
    population: importanceScores.length,
  };

  // Extract top valuable engagers (with importance_score > 0, sorted by score)
  const topValuableEngagers: TopValuableEngager[] = aggregated
    .filter((engager) => (engager.importance_score || 0) > 0)
    .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, 50)
    .map((engager) => ({
      userId: engager.userId,
      username: engager.username,
      name: engager.name,
      bio: engager.bio,
      followers: engager.followers,
      verified: engager.verified,
      importance_score: engager.importance_score || 0,
      tweetEngagements: engager.tweetEngagements.filter((te) => te.actions.length > 0),
    }));

  const followerTierBuckets: FollowerTier[] = FOLLOWER_TIER_DEFS.map((tier) => ({
    tier: tier.label,
    range: tier.range,
    count: 0,
  }));

  for (const engager of aggregated) {
    const followers = engager.followers || 0;
    const bucket = FOLLOWER_TIER_DEFS.find((tier) => followers >= tier.min && followers < tier.max);
    if (!bucket) continue;

    const target = followerTierBuckets.find((entry) => entry.tier === bucket.label);
    if (target) {
      target.count += 1;
    }
  }

  const followerTiersDistribution = followerTierBuckets.filter((bucket) => bucket.count > 0);

  return {
    rollup: {
      totalEngagements,
      uniqueEngagers,
      repeatEngagements,
      verifiedCount,
      nonVerifiedCount,
      highFollowerCount,
      highFollowerShare,
      topFollowerTier,
      engagementMix,
      importance,
      topValuableEngagers,
      followerTiers: followerTiersDistribution,
    },
    aggregated,
  };
}

function buildNetworkReach(engagers: AggregatedEngager[]): {
  totalHighImportance: number;
  groups: NetworkReachGroup[];
} {
  const highImportance = engagers
    .filter((engager) => (engager.importance_score || 0) > 0)
    .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, 40);

  const map = new Map<keyof typeof CATEGORY_LABELS, HighImportanceEngager[]>();

  for (const engager of highImportance) {
    const engagementTypes: string[] = [];
    if (engager.replied) engagementTypes.push('replied');
    if (engager.retweeted) engagementTypes.push('retweeted');
    if (engager.quoted) engagementTypes.push('quoted');

    const categories = categorizeEngager({
      tweet_id: '',
      userId: engager.userId,
      username: engager.username,
      name: engager.name,
      bio: engager.bio,
      location: engager.location,
      followers: engager.followers,
      verified: engager.verified,
      replied: engager.replied,
      retweeted: engager.retweeted,
      quoted: engager.quoted,
      importance_score: engager.importance_score,
      followed_by: engager.followed_by,
      created_at: new Date(),
    } as Engager);

    const payload: HighImportanceEngager = {
      userId: engager.userId,
      username: engager.username,
      name: engager.name,
      followers: engager.followers,
      importanceScore: engager.importance_score || 0,
      engagementTypes,
      verified: engager.verified,
      categories,
    };

    for (const category of categories) {
      const normalizedCategory = category in CATEGORY_LABELS ? category : 'others';
      const existing = map.get(normalizedCategory as keyof typeof CATEGORY_LABELS) || [];
      if (existing.length < 10) {
        existing.push(payload);
        map.set(normalizedCategory as keyof typeof CATEGORY_LABELS, existing);
      }
    }
  }

  const groups: NetworkReachGroup[] = Array.from(map.entries())
    .map(([category, list]) => ({
      category,
      role: CATEGORY_LABELS[category],
      engagers: list,
    }))
    .sort((a, b) => a.role.localeCompare(b.role));

  return {
    totalHighImportance: highImportance.length,
    groups,
  };
}

function buildProfileDistribution(engagers: AggregatedEngager[]): ProfileDistribution {
  const totalEngagers = engagers.length;

  const categoryKeys = Object.keys(CATEGORY_LABELS) as ProfileCategoryKey[];

  const baseCategories: Record<ProfileCategoryKey, ProfileDistributionCategory> =
    categoryKeys.reduce((acc, key) => {
      acc[key] = {
        key,
        label: CATEGORY_LABELS[key],
        count: 0,
        percentage: 0,
        engagers: [],
      };
      return acc;
    }, {} as Record<ProfileCategoryKey, ProfileDistributionCategory>);

  for (const engager of engagers) {
    const categories = categorizeEngager({
      tweet_id: '',
      userId: engager.userId,
      username: engager.username,
      name: engager.name,
      bio: engager.bio,
      location: engager.location,
      followers: engager.followers,
      verified: engager.verified,
      replied: engager.replied,
      retweeted: engager.retweeted,
      quoted: engager.quoted,
      importance_score: engager.importance_score,
      followed_by: engager.followed_by,
      created_at: new Date(),
    } as Engager);

    for (const category of categories) {
      const key: ProfileCategoryKey =
        category in CATEGORY_LABELS ? (category as ProfileCategoryKey) : 'others';

      const bucket = baseCategories[key];
      bucket.count += 1;
      bucket.engagers.push({
        userId: engager.userId,
        username: engager.username,
        name: engager.name,
        bio: engager.bio,
        followers: engager.followers,
        verified: engager.verified,
        importanceScore: engager.importance_score,
      });
    }
  }

  const categoriesWithPercentages: ProfileDistributionCategory[] = Object.values(
    baseCategories,
  )
    .filter((cat) => cat.count > 0)
    .map((cat) => ({
      ...cat,
      percentage:
        totalEngagers > 0 ? formatNumber((cat.count / totalEngagers) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEngagers,
    categories: categoriesWithPercentages,
  };
}

function buildAIReportStatus(tweets: Tweet[]): AIReportStatus {
  const completedReports: ReportPointer[] = [];
  const backlog: ReportPointer[] = [];

  for (const tweet of tweets) {
    const pointer: ReportPointer = {
      tweetId: tweet.tweet_id,
      tweetUrl: tweet.tweet_url,
      createdAt: tweet.created_at.toISOString(),
      analyzedAt: tweet.analyzed_at ? tweet.analyzed_at.toISOString() : null,
      totalEngagers: tweet.ai_report?.structured_stats?.total_engagers ?? tweet.total_engagers,
      status: tweet.status,
      summarySnippet: tweet.ai_report?.narrative
        ? tweet.ai_report.narrative.slice(0, 200)
        : undefined,
    };

    if (tweet.ai_report) {
      completedReports.push(pointer);
    } else {
      backlog.push(pointer);
    }
  }

  return {
    completedCount: completedReports.length,
    backlogCount: backlog.length,
    completedReports,
    backlog,
  };
}

async function findTweetsByIdentifier(identifier: string): Promise<Tweet[]> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return [];
  }

  const tweetsCollection = await getTweetsCollection();
  const usernameTarget = sanitizeUsername(trimmed);

  if (usernameTarget) {
    const usernameRegex = new RegExp(`^@?${escapeRegex(usernameTarget)}$`, 'i');
    const tweets = await tweetsCollection
      .find({ author_username: usernameRegex })
      .sort({ created_at: 1 })
      .toArray();
    if (tweets.length > 0) {
      return tweets;
    }
  }

  const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
  return tweetsCollection.find({ author_name: nameRegex }).sort({ created_at: 1 }).toArray();
}

export async function getUserReport(identifier: string): Promise<UserReportPayload | null> {
  const tweets = await findTweetsByIdentifier(identifier);

  if (tweets.length === 0) {
    return null;
  }

  const metricTotals: MetricTotals = {
    likes: 0,
    retweets: 0,
    quotes: 0,
    replies: 0,
    views: 0,
    bookmarks: 0,
  };

  for (const tweet of tweets) {
    if (!tweet.metrics) continue;
    metricTotals.likes += tweet.metrics.likeCount ?? 0;
    metricTotals.retweets += tweet.metrics.retweetCount ?? 0;
    metricTotals.quotes += tweet.metrics.quoteCount ?? 0;
    metricTotals.replies += tweet.metrics.replyCount ?? 0;
    metricTotals.views += tweet.metrics.viewCount ?? 0;
    metricTotals.bookmarks += tweet.metrics.bookmarkCount ?? 0;
  }

  const timelinePoints = buildTimeline(tweets);
  const momentum = buildMomentum(timelinePoints);

  const tweetIds = tweets.map((tweet) => tweet.tweet_id);
  const engagersCollection = await getEngagersCollection();
  const engagersCursor = await engagersCollection
    .find({ tweet_id: { $in: tweetIds } })
    .toArray();

  // Create a map of tweet_id -> Tweet for quick lookup
  const tweetsMap = new Map<string, Tweet>();
  for (const tweet of tweets) {
    tweetsMap.set(tweet.tweet_id, tweet);
  }

  const { rollup, aggregated } = aggregateEngagers(engagersCursor, tweetsMap);
  const networkReach = buildNetworkReach(aggregated);
  const profileDistribution = buildProfileDistribution(aggregated);
  const aiReports = buildAIReportStatus(tweets);

  return {
    author: {
      name: tweets[0]?.author_name ?? identifier,
      username: tweets[0]?.author_username,
    },
    metricTotals,
    timeline: {
      points: timelinePoints,
      momentum,
    },
    engagers: rollup,
    networkReach,
    profileDistribution,
    aiReports,
  };
}

function sanitizeIdentifierForPath(value: string): string {
  return sanitizeUsername(value) || value.trim();
}

export async function listUserReportClients(): Promise<UserReportClientSummary[]> {
  const tweetsCollection = await getTweetsCollection();

  // Group by normalized author identifier:
  // - prefer username if present
  // - lowercase for grouping (we strip @ later in JS to avoid requiring newer Mongo operators)
  const pipeline: Document[] = [
    { $sort: { created_at: -1 } },
    {
      $addFields: {
        __authorKey: {
          $toLower: {
            $ifNull: ['$author_username', '$author_name'],
          },
        },
      },
    },
    {
      $group: {
        _id: '$__authorKey',
        author_name: { $first: '$author_name' },
        author_username: { $first: '$author_username' },
        tweetCount: { $sum: 1 },
        lastTweetAt: { $first: '$created_at' },
        lastAnalyzedAt: { $max: '$analyzed_at' },
      },
    },
    { $sort: { lastTweetAt: -1 } },
  ];

  const rows = await tweetsCollection.aggregate(pipeline).toArray();

  return rows
    .filter((row) => row && row._id)
    .map((row: any): UserReportClientSummary => {
      const username: string | undefined = row.author_username ?? undefined;
      const identifier = username
        ? sanitizeIdentifierForPath(username)
        : sanitizeIdentifierForPath(row.author_name ?? String(row._id));

      return {
        identifier,
        name: row.author_name ?? identifier,
        username,
        tweetCount: Number(row.tweetCount ?? 0),
        lastTweetAt:
          row.lastTweetAt instanceof Date
            ? row.lastTweetAt.toISOString()
            : new Date(row.lastTweetAt).toISOString(),
        lastAnalyzedAt:
          row.lastAnalyzedAt
            ? row.lastAnalyzedAt instanceof Date
              ? row.lastAnalyzedAt.toISOString()
              : new Date(row.lastAnalyzedAt).toISOString()
            : null,
      };
    });
}


