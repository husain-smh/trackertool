import { getEngagers } from './models/tweets';
import { getImportantPeople } from './models/ranker';
import type { Engager } from './models/tweets';

export interface EngagerCategory {
  founders: Engager[];
  vcs: Engager[];
  ai_creators: Engager[];
  media: Engager[];
  developers: Engager[];
  c_level: Engager[]; // CTO, CFO, COO, etc.
  yc_alumni: Engager[]; // Y Combinator alumni
  others: Engager[];
}

export interface FollowerTier {
  tier: string;
  count: number;
  range: string;
}

export interface HighProfileEngager {
  username: string;
  name: string;
  followers: number;
  bio?: string;
  verified: boolean;
  engagement_types: string[];
  importance_score?: number;
}

export interface VCFirm {
  firm_name: string;
  partners: Array<{
    username: string;
    name: string;
    followers: number;
    bio?: string;
  }>;
}

export interface NotablePerson {
  username: string;
  name: string;
  engagement_type: string[];
  followers: number;
  verified: boolean;
}

export interface EngagementStats {
  total: number;
  replied_count: number;
  retweeted_count: number;
  quoted_count: number;
  replied_percentage: number;
  retweeted_percentage: number;
  quoted_percentage: number;
}

export interface EngagerAnalysis {
  all_engagers: Engager[];
  categories: EngagerCategory;
  category_counts: {
    founders: number;
    vcs: number;
    ai_creators: number;
    media: number;
    developers: number;
    c_level: number;
    yc_alumni: number;
    others: number;
  };
  category_percentages: {
    founders: number;
    vcs: number;
    ai_creators: number;
    media: number;
    developers: number;
    c_level: number;
    yc_alumni: number;
    others: number;
  };
  engagement_stats: EngagementStats;
  notable_people: NotablePerson[];
  follower_tiers: FollowerTier[];
  high_profile_engagers: HighProfileEngager[];
  vc_firms: VCFirm[];
  hardcoded_vc_firms: VCFirm[]; // Hardcoded VCs/investors from important_people database
  quality_metrics: {
    verified_percentage: number;
    top_10_followers_sum: number;
  };
  sample_bios: {
    founders: string[];
    vcs: string[];
    ai_creators: string[];
    media: string[];
    developers: string[];
  };
}

/**
 * Fetch all engagers for a tweet (handles pagination)
 */
export async function fetchAllEngagers(tweetId: string): Promise<Engager[]> {
  const allEngagers: Engager[] = [];
  const batchSize = 1000;
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await getEngagers(tweetId, {
      limit: batchSize,
      skip,
    });

    allEngagers.push(...result.engagers);
    skip += batchSize;
    hasMore = result.engagers.length === batchSize;
  }

  return allEngagers;
}

/**
 * Categorize an engager based on bio keywords
 * Returns array of categories since someone can be both founder and YC alumni
 */
export function categorizeEngager(engager: Engager): (keyof EngagerCategory)[] {
  const bio = (engager.bio || '').toLowerCase();
  const name = (engager.name || '').toLowerCase();
  const username = (engager.username || '').toLowerCase();

  const combined = `${bio} ${name} ${username}`;
  const categories: (keyof EngagerCategory)[] = [];

  // Check YC first (can overlap with other categories)
  const ycKeywords = ['y combinator', 'yc s', 'yc w', 'yc ', 'ycombinator'];
  if (ycKeywords.some(kw => combined.includes(kw))) {
    categories.push('yc_alumni');
  }

  // C-Level Executives (separate from founders)
  const cLevelKeywords = ['cto', 'cfo', 'coo', 'chief technology', 'chief financial', 'chief operating'];
  if (cLevelKeywords.some(kw => combined.includes(kw)) && !combined.includes('founder') && !combined.includes('ceo')) {
    categories.push('c_level');
  }

  // Founders/CEOs
  const founderKeywords = [
    'founder', 'co-founder', 'cofounder', 'ceo',
    'chief executive', 'startup founder', 'company founder'
  ];
  if (founderKeywords.some(kw => combined.includes(kw))) {
    categories.push('founders');
  }

  // VCs/Investors
  const vcKeywords = [
    'vc', 'venture capital', 'venture capitalist', 'investor', 'angel investor',
    'a16z', 'andreessen horowitz',
    'partner at', 'investment partner', 'venture partner', 'seed fund',
    'series a', 'series b', 'series c', 'portfolio', 'backed by'
  ];
  if (vcKeywords.some(kw => combined.includes(kw))) {
    categories.push('vcs');
  }

  // AI Creators
  const aiCreatorKeywords = [
    'ai content creator', 'ai influencer', 'ai writer', 'ai educator',
    'newsletter', 'ai newsletter', 'building in ai', 'ai builder',
    'ai creator', 'ai content', 'generative ai', 'llm', 'chatgpt',
    'ai researcher', 'ai practitioner'
  ];
  if (aiCreatorKeywords.some(kw => combined.includes(kw))) {
    categories.push('ai_creators');
  }

  // Media
  const mediaKeywords = [
    'journalist', 'reporter', 'media', 'press', 'writer', 'editor',
    'tech journalist', 'tech reporter', 'news', 'publication',
    'techcrunch', 'the verge', 'wired', 'forbes', 'bloomberg'
  ];
  if (mediaKeywords.some(kw => combined.includes(kw))) {
    categories.push('media');
  }

  // Developers
  const developerKeywords = [
    'developer', 'engineer', 'software engineer', 'programmer', 'coder',
    'building', 'builder', 'full stack', 'backend', 'frontend',
    'dev', 'tech lead', 'senior engineer', 'principal engineer'
  ];
  if (developerKeywords.some(kw => combined.includes(kw))) {
    categories.push('developers');
  }

  // If no category found, mark as others
  if (categories.length === 0) {
    categories.push('others');
  }

  return categories;
}

/**
 * Extract VC firm names from bio
 */
export function extractVCFirm(bio: string): string | null {
  const firmPatterns = [
    { pattern: /a16z|andreessen horowitz/gi, name: 'a16z' },
    { pattern: /y combinator|ycombinator/gi, name: 'Y Combinator' },
    { pattern: /idc ventures/gi, name: 'IDC Ventures' },
    { pattern: /balderton capital/gi, name: 'Balderton Capital' },
    { pattern: /general catalyst/gi, name: 'General Catalyst' },
    { pattern: /accel/gi, name: 'Accel' },
    { pattern: /sequoia/gi, name: 'Sequoia' },
    { pattern: /kleiner perkins/gi, name: 'Kleiner Perkins' },
    { pattern: /greylock/gi, name: 'Greylock' },
    { pattern: /benchmark/gi, name: 'Benchmark' },
    { pattern: /first round/gi, name: 'First Round' },
    { pattern: /index ventures/gi, name: 'Index Ventures' },
    { pattern: /insight partners/gi, name: 'Insight Partners' },
    { pattern: /lightspeed/gi, name: 'Lightspeed' },
    { pattern: /redpoint/gi, name: 'Redpoint' },
  ];

  for (const firm of firmPatterns) {
    if (firm.pattern.test(bio)) {
      return firm.name;
    }
  }

  return null;
}

/**
 * Find notable people from important_people database
 */
export async function findNotablePeople(
  engagers: Engager[]
): Promise<NotablePerson[]> {
  // Get all important people (fetch in batches if needed)
  const allImportantPeople: any[] = [];
  let page = 1;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { people, total } = await getImportantPeople(page, pageSize);
    allImportantPeople.push(...people);
    hasMore = page * pageSize < total;
    page++;
  }

  // Create lookup maps for efficient matching
  const usernameMap = new Map<string, any>();
  const userIdMap = new Map<string, any>();
  
  for (const ip of allImportantPeople) {
    if (ip.username) {
      usernameMap.set(ip.username.toLowerCase(), ip);
    }
    if (ip.user_id) {
      userIdMap.set(ip.user_id, ip);
    }
  }

  const notableMap = new Map<string, NotablePerson>();

  for (const engager of engagers) {
    const importantPerson = 
      userIdMap.get(engager.userId) ||
      usernameMap.get(engager.username.toLowerCase());

    if (importantPerson) {
      const key = engager.userId;
      if (!notableMap.has(key)) {
        const engagementTypes: string[] = [];
        if (engager.replied) engagementTypes.push('replied');
        if (engager.retweeted) engagementTypes.push('retweeted');
        if (engager.quoted) engagementTypes.push('quoted');

        notableMap.set(key, {
          username: engager.username,
          name: importantPerson.name || engager.name,
          engagement_type: engagementTypes,
          followers: engager.followers,
          verified: engager.verified,
        });
      } else {
        // Update engagement types
        const existing = notableMap.get(key)!;
        if (engager.replied && !existing.engagement_type.includes('replied')) {
          existing.engagement_type.push('replied');
        }
        if (engager.retweeted && !existing.engagement_type.includes('retweeted')) {
          existing.engagement_type.push('retweeted');
        }
        if (engager.quoted && !existing.engagement_type.includes('quoted')) {
          existing.engagement_type.push('quoted');
        }
      }
    }
  }

  return Array.from(notableMap.values());
}

/**
 * Calculate engagement statistics
 */
export function calculateEngagementStats(engagers: Engager[]): EngagementStats {
  const total = engagers.length;
  const replied_count = engagers.filter(e => e.replied).length;
  const retweeted_count = engagers.filter(e => e.retweeted).length;
  const quoted_count = engagers.filter(e => e.quoted).length;

  return {
    total,
    replied_count,
    retweeted_count,
    quoted_count,
    replied_percentage: total > 0 ? Math.round((replied_count / total) * 100 * 100) / 100 : 0,
    retweeted_percentage: total > 0 ? Math.round((retweeted_count / total) * 100 * 100) / 100 : 0,
    quoted_percentage: total > 0 ? Math.round((quoted_count / total) * 100 * 100) / 100 : 0,
  };
}

/**
 * Extract sample bios for each category (top 5-10 most relevant)
 */
export function extractSampleBios(
  categories: EngagerCategory
): EngagerAnalysis['sample_bios'] {
  const getSamples = (engagers: Engager[], max: number = 8): string[] => {
    return engagers
      .filter(e => e.bio && e.bio.trim().length > 0)
      .slice(0, max)
      .map(e => `${e.name} (@${e.username}): ${e.bio}`)
      .filter((bio, index, self) => self.indexOf(bio) === index); // Remove duplicates
  };

  return {
    founders: getSamples(categories.founders),
    vcs: getSamples(categories.vcs),
    ai_creators: getSamples(categories.ai_creators),
    media: getSamples(categories.media),
    developers: getSamples(categories.developers),
  };
}

/**
 * Calculate follower count tiers
 */
export function calculateFollowerTiers(engagers: Engager[]): FollowerTier[] {
  const tiers: FollowerTier[] = [
    { tier: '500K+', count: 0, range: '500000+' },
    { tier: '200K-500K', count: 0, range: '200000-500000' },
    { tier: '100K-200K', count: 0, range: '100000-200000' },
    { tier: '50K-100K', count: 0, range: '50000-100000' },
    { tier: '10K-50K', count: 0, range: '10000-50000' },
  ];

  for (const engager of engagers) {
    const followers = engager.followers || 0;
    if (followers >= 500000) {
      tiers[0].count++;
    } else if (followers >= 200000) {
      tiers[1].count++;
    } else if (followers >= 100000) {
      tiers[2].count++;
    } else if (followers >= 50000) {
      tiers[3].count++;
    } else if (followers >= 10000) {
      tiers[4].count++;
    }
  }

  return tiers.filter(t => t.count > 0);
}

/**
 * Get highest profile engagers (sorted by importance_score)
 */
export function getHighProfileEngagers(engagers: Engager[], limit: number = 20): HighProfileEngager[] {
  return engagers
    .filter(e => e.importance_score !== undefined && e.importance_score !== null)
    .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
    .slice(0, limit)
    .map(e => {
      const engagementTypes: string[] = [];
      if (e.replied) engagementTypes.push('replied');
      if (e.retweeted) engagementTypes.push('retweeted');
      if (e.quoted) engagementTypes.push('quoted');

      return {
        username: e.username,
        name: e.name,
        followers: e.followers,
        bio: e.bio,
        verified: e.verified,
        engagement_types: engagementTypes,
        importance_score: e.importance_score,
      };
    });
}

/**
 * Extract VC firms and their partners
 */
export function extractVCFirms(vcEngagers: Engager[]): VCFirm[] {
  const firmMap = new Map<string, VCFirm>();

  for (const engager of vcEngagers) {
    if (!engager.bio) continue;

    const firmName = extractVCFirm(engager.bio);
    if (firmName) {
      if (!firmMap.has(firmName)) {
        firmMap.set(firmName, {
          firm_name: firmName,
          partners: [],
        });
      }

      const firm = firmMap.get(firmName)!;
      firm.partners.push({
        username: engager.username,
        name: engager.name,
        followers: engager.followers,
        bio: engager.bio,
      });
    }
  }

  return Array.from(firmMap.values());
}

/**
 * Hardcoded firm mapping for VCs/investors
 * Maps usernames or patterns to firm names
 * Can be extended with more mappings
 */
const HARDCODED_VC_FIRM_MAPPING: Map<string, string> = new Map([
  // Add hardcoded mappings here
  // Example: ['username', 'Firm Name']
  // The mapping can also use patterns or be extended via database
]);

/**
 * Get firm name for a hardcoded VC/investor
 * First checks hardcoded mapping, then tries to extract from bio
 */
function getHardcodedVCFirm(engager: Engager, importantPerson?: any): string | null {
  // Check hardcoded mapping first
  const usernameLower = engager.username.toLowerCase();
  if (HARDCODED_VC_FIRM_MAPPING.has(usernameLower)) {
    return HARDCODED_VC_FIRM_MAPPING.get(usernameLower)!;
  }

  // Check if important person has a firm tag
  if (importantPerson?.tags) {
    const firmTags = importantPerson.tags.filter((tag: string) => 
      tag.toLowerCase().includes('firm:') || tag.toLowerCase().includes('vc:')
    );
    if (firmTags.length > 0) {
      // Extract firm name from tag like "firm:a16z" or "vc:sequoia"
      const firmTag = firmTags[0];
      const firmName = firmTag.split(':')[1]?.trim();
      if (firmName) {
        return firmName.charAt(0).toUpperCase() + firmName.slice(1);
      }
    }
  }

  // Fallback: try to extract from bio
  if (engager.bio) {
    return extractVCFirm(engager.bio);
  }

  return null;
}

/**
 * Extract hardcoded VCs/investors by firm affiliation
 * Uses important_people database filtered by VC/investor tags
 */
export async function extractHardcodedVCFirms(
  engagers: Engager[]
): Promise<VCFirm[]> {
  // Get all important people (fetch in batches)
  const allImportantPeople: any[] = [];
  let page = 1;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { people, total } = await getImportantPeople(page, pageSize);
    allImportantPeople.push(...people);
    hasMore = page * pageSize < total;
    page++;
  }

  // Filter for VCs/investors by tags
  const vcInvestorTags = ['vc', 'investor', 'vc investor', 'venture capital', 'angel investor', 'yc founder'];
  const vcInvestorPeople = allImportantPeople.filter((person) => {
    const tags = (person.tags || []).map((t: string) => t.toLowerCase());
    return vcInvestorTags.some(tag => tags.includes(tag));
  });

  // Create lookup maps
  const usernameMap = new Map<string, any>();
  const userIdMap = new Map<string, any>();

  for (const ip of vcInvestorPeople) {
    if (ip.username) {
      usernameMap.set(ip.username.toLowerCase(), ip);
    }
    if (ip.user_id) {
      userIdMap.set(ip.user_id, ip);
    }
  }

  // Group engagers who are in the hardcoded list by firm
  const firmMap = new Map<string, VCFirm>();

  for (const engager of engagers) {
    const importantPerson = 
      userIdMap.get(engager.userId) ||
      usernameMap.get(engager.username.toLowerCase());

    if (importantPerson) {
      const firmName = getHardcodedVCFirm(engager, importantPerson);
      if (firmName) {
        if (!firmMap.has(firmName)) {
          firmMap.set(firmName, {
            firm_name: firmName,
            partners: [],
          });
        }

        const firm = firmMap.get(firmName)!;
        firm.partners.push({
          username: engager.username,
          name: engager.name,
          followers: engager.followers,
          bio: engager.bio,
        });
      }
    }
  }

  return Array.from(firmMap.values());
}

/**
 * Main analysis function - processes all engagers
 */
export async function analyzeEngagers(tweetId: string): Promise<EngagerAnalysis> {
  // Fetch all engagers
  const allEngagers = await fetchAllEngagers(tweetId);

  if (allEngagers.length === 0) {
    throw new Error('No engagers found for this tweet');
  }

  // Categorize engagers (can be in multiple categories)
  const categories: EngagerCategory = {
    founders: [],
    vcs: [],
    ai_creators: [],
    media: [],
    developers: [],
    c_level: [],
    yc_alumni: [],
    others: [],
  };

  for (const engager of allEngagers) {
    const engagerCategories = categorizeEngager(engager);
    for (const category of engagerCategories) {
      categories[category].push(engager);
    }
  }

  // Calculate counts and percentages
  const total = allEngagers.length;
  const category_counts = {
    founders: categories.founders.length,
    vcs: categories.vcs.length,
    ai_creators: categories.ai_creators.length,
    media: categories.media.length,
    developers: categories.developers.length,
    c_level: categories.c_level.length,
    yc_alumni: categories.yc_alumni.length,
    others: categories.others.length,
  };

  const category_percentages = {
    founders: total > 0 ? Math.round((category_counts.founders / total) * 100 * 100) / 100 : 0,
    vcs: total > 0 ? Math.round((category_counts.vcs / total) * 100 * 100) / 100 : 0,
    ai_creators: total > 0 ? Math.round((category_counts.ai_creators / total) * 100 * 100) / 100 : 0,
    media: total > 0 ? Math.round((category_counts.media / total) * 100 * 100) / 100 : 0,
    developers: total > 0 ? Math.round((category_counts.developers / total) * 100 * 100) / 100 : 0,
    c_level: total > 0 ? Math.round((category_counts.c_level / total) * 100 * 100) / 100 : 0,
    yc_alumni: total > 0 ? Math.round((category_counts.yc_alumni / total) * 100 * 100) / 100 : 0,
    others: total > 0 ? Math.round((category_counts.others / total) * 100 * 100) / 100 : 0,
  };

  // Calculate engagement stats
  const engagement_stats = calculateEngagementStats(allEngagers);

  // Find notable people
  const notable_people = await findNotablePeople(allEngagers);

  // Calculate follower tiers
  const follower_tiers = calculateFollowerTiers(allEngagers);

  // Get high profile engagers (top 20 by importance_score)
  const high_profile_engagers = getHighProfileEngagers(allEngagers, 20);

  // Extract VC firms (from bio-based extraction)
  const vc_firms = extractVCFirms(categories.vcs);

  // Extract hardcoded VC firms (from important_people database)
  const hardcoded_vc_firms = await extractHardcodedVCFirms(allEngagers);

  // Calculate quality metrics
  const verified_count = allEngagers.filter(e => e.verified).length;
  const verified_percentage = total > 0 ? Math.round((verified_count / total) * 100 * 100) / 100 : 0;
  const top_10_followers_sum = high_profile_engagers
    .slice(0, 10)
    .reduce((sum, e) => sum + e.followers, 0);

  // Extract sample bios
  const sample_bios = extractSampleBios(categories);

  return {
    all_engagers: allEngagers,
    categories,
    category_counts,
    category_percentages,
    engagement_stats,
    notable_people,
    follower_tiers,
    high_profile_engagers,
    vc_firms,
    hardcoded_vc_firms,
    quality_metrics: {
      verified_percentage,
      top_10_followers_sum,
    },
    sample_bios,
  };
}

