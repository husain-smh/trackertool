import OpenAI from 'openai';
import type { EngagerAnalysis } from './analyze-engagers';

const openai = new OpenAI({
  apiKey: process.env.OPENAIAPIKEY,
});

// Compact engager data for categorized lists (only essential fields)
export interface CategorizedEngager {
  userId: string;
  username: string;
  name: string;
  bio?: string;
  followers: number;
  verified: boolean;
  replied: boolean;
  retweeted: boolean;
  quoted: boolean;
  importance_score?: number;
}

export interface AIReport {
  generated_at: Date;
  structured_stats: {
    total_engagers: number;
    categories: {
      founders: { count: number; percentage: number };
      vcs: { count: number; percentage: number };
      ai_creators: { count: number; percentage: number };
      media: { count: number; percentage: number };
      developers: { count: number; percentage: number };
      c_level: { count: number; percentage: number };
      yc_alumni: { count: number; percentage: number };
      others: { count: number; percentage: number };
    };
    engagement: {
      replied_percentage: number;
      retweeted_percentage: number;
      quoted_percentage: number;
    };
    follower_tiers: Array<{
      tier: string;
      count: number;
    }>;
    high_profile_engagers: Array<{
      username: string;
      name: string;
      followers: number;
      bio?: string;
      verified: boolean;
      engagement_types: string[];
      importance_score?: number;
    }>;
    vc_firms: Array<{
      firm_name: string;
      partners: Array<{
        username: string;
        name: string;
        followers: number;
        bio?: string;
      }>;
    }>;
    hardcoded_vc_firms: Array<{
      firm_name: string;
      partners: Array<{
        username: string;
        name: string;
        followers: number;
        bio?: string;
      }>;
    }>;
    quality_metrics: {
      verified_percentage: number;
      top_10_followers_sum: number;
    };
    // Categorized engagers for interactive pie chart
    categorized_engagers: {
      founders: CategorizedEngager[];
      vcs: CategorizedEngager[];
      ai_creators: CategorizedEngager[];
      media: CategorizedEngager[];
      developers: CategorizedEngager[];
      c_level: CategorizedEngager[];
      yc_alumni: CategorizedEngager[];
      others: CategorizedEngager[];
    };
  };
  notable_people: Array<{
    username: string;
    name: string;
    engagement_type: string[];
  }>;
  narrative: string;
  sample_bios: {
    founders: string[];
    vcs: string[];
    ai_creators: string[];
    media: string[];
    developers: string[];
  };
}

/**
 * Build the prompt for LLM generation
 */
function buildPrompt(analysis: EngagerAnalysis): string {
  const { 
    category_counts, 
    category_percentages, 
    engagement_stats, 
    notable_people, 
    follower_tiers,
    quality_metrics
  } = analysis;

  const prompt = `You are analyzing Twitter engagement data for a client report. Generate a professional, founder-friendly narrative report in the EXACT format specified below.

CRITICAL RULES:
1. ONLY use the data provided below. Do NOT make up numbers, names, or facts.
2. Do NOT mention comparisons to other tweets or historical data.
3. Be specific and reference actual numbers from the data.
4. Write in a tone that makes the client feel good about their engagement.
5. Follow the example format structure provided below.

DATA PROVIDED:

Total Engagers: ${engagement_stats.total}

Breakdown of Profiles:
- Founders/CEOs: ${category_counts.founders} (${category_percentages.founders}%)
- Investors and VC professionals: ${category_counts.vcs} (${category_percentages.vcs}%)
- C-Level Executives (CTO, CFO, COO): ${category_counts.c_level} (${category_percentages.c_level}%)
- AI Content Creators: ${category_counts.ai_creators} (${category_percentages.ai_creators}%)
- Media: ${category_counts.media} (${category_percentages.media}%)
- Developers: ${category_counts.developers} (${category_percentages.developers}%)
- Y Combinator alumni: ${category_counts.yc_alumni} (${category_percentages.yc_alumni}%)

Follower Count Tiers:
${follower_tiers.map(t => `- ${t.count} users with ${t.tier} followers`).join('\n')}


Quality Metrics:
- Verified accounts: ${quality_metrics.verified_percentage}%
- Replied: ${engagement_stats.replied_percentage}%
- Retweeted: ${engagement_stats.retweeted_percentage}%
- Quoted: ${engagement_stats.quoted_percentage}%
- Top 10 engaged accounts: ${(quality_metrics.top_10_followers_sum / 1000000).toFixed(2)}M+ followers combined

${notable_people.length > 0 ? `Notable People:\n${notable_people.map(np => 
  `- @${np.username} (${np.name}): ${np.engagement_type.join(', ')}`
).join('\n')}\n\n` : ''}

Generate a report in this EXACT format:

**Breakdown of profiles:**

- [X] Founders/CEOs engaged with your tweet, demonstrating strong interest from notable builders and leaders in the tech and startup ecosystem

- [X] Investors and VC professionals including partners from [list firms if any]

- [X] C-Level Executives (CTO, CFO, COO, etc.) who are decision makers in their organizations

- [X] AI Content Creators and Educators actively amplifying your message

- [X] Notable Tech Leaders including founders and investors recognized at top firms

- [X] Y Combinator-backed or similar programs founders and alumni actively engaged

**Follower Count Tiers:**

[List each tier with count]

**Major Investors:**

[List investors with format: Name (@username) – XK followers – Role/Description]


**Quality Metrics:**

- Approximately [X]% of engaged accounts are verified, indicating a solid presence of authentic high-profile figures
- [X]% of accounts replied directly to the tweet, showing real engagement beyond passive likes or retweets
- [X]% retweeted the content, amplifying its reach to new audiences
- Top 10 accounts that engaged with this tweet collectively amass over [X]M+ followers, driving massive potential visibility

Write in a professional but enthusiastic tone. Make the client feel good about their engagement while being factual and accurate. Use the exact numbers provided.`;

  return prompt;
}

/**
 * Generate AI report from analysis data
 */
export async function generateAIReport(analysis: EngagerAnalysis): Promise<AIReport> {
  const prompt = buildPrompt(analysis);

  // Log prompt size for debugging (approximate token count: ~4 chars per token)
  const approximateTokens = Math.ceil(prompt.length / 4);
  console.log(`[AI Report] Prompt size: ${prompt.length} characters (~${approximateTokens} tokens)`);
  console.log(`[AI Report] Total engagers analyzed: ${analysis.engagement_stats.total}`);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a professional social media analyst writing client reports. You are accurate, factual, and never make up data. You write in a founder-friendly, enthusiastic tone that highlights value. Follow the exact format provided.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7, // Slightly creative but still factual
      max_tokens: 5000, // Increased from 3000 to allow for more detailed reports
    });

    const narrative = completion.choices[0].message.content?.trim() || '';
    
    // Debug logging
    console.log(`[AI Report] Narrative length: ${narrative.length} characters`);
    console.log(`[AI Report] Narrative preview (first 200 chars): ${narrative.substring(0, 200)}`);
    if (!narrative || narrative.length === 0) {
      console.warn('[AI Report] WARNING: Narrative is empty! AI response might be empty.');
      console.log('[AI Report] Full completion response:', JSON.stringify(completion, null, 2));
    }

    // Validate narrative doesn't contain made-up data
    validateNarrative(narrative, analysis);

    // Convert categorized engagers to compact format
    const convertToCategorizedEngager = (engager: any): CategorizedEngager => ({
      userId: engager.userId,
      username: engager.username,
      name: engager.name,
      bio: engager.bio,
      followers: engager.followers,
      verified: engager.verified,
      replied: engager.replied,
      retweeted: engager.retweeted,
      quoted: engager.quoted,
      importance_score: engager.importance_score,
    });

    return {
      generated_at: new Date(),
      structured_stats: {
        total_engagers: analysis.engagement_stats.total,
        categories: {
          founders: {
            count: analysis.category_counts.founders,
            percentage: analysis.category_percentages.founders,
          },
          vcs: {
            count: analysis.category_counts.vcs,
            percentage: analysis.category_percentages.vcs,
          },
          ai_creators: {
            count: analysis.category_counts.ai_creators,
            percentage: analysis.category_percentages.ai_creators,
          },
          media: {
            count: analysis.category_counts.media,
            percentage: analysis.category_percentages.media,
          },
          developers: {
            count: analysis.category_counts.developers,
            percentage: analysis.category_percentages.developers,
          },
          c_level: {
            count: analysis.category_counts.c_level,
            percentage: analysis.category_percentages.c_level,
          },
          yc_alumni: {
            count: analysis.category_counts.yc_alumni,
            percentage: analysis.category_percentages.yc_alumni,
          },
          others: {
            count: analysis.category_counts.others,
            percentage: analysis.category_percentages.others,
          },
        },
        engagement: {
          replied_percentage: analysis.engagement_stats.replied_percentage,
          retweeted_percentage: analysis.engagement_stats.retweeted_percentage,
          quoted_percentage: analysis.engagement_stats.quoted_percentage,
        },
        follower_tiers: analysis.follower_tiers.map(t => ({
          tier: t.tier,
          count: t.count,
        })),
        high_profile_engagers: analysis.high_profile_engagers,
        vc_firms: analysis.vc_firms,
        hardcoded_vc_firms: analysis.hardcoded_vc_firms,
        quality_metrics: analysis.quality_metrics,
        // Include categorized engagers for interactive pie chart
        categorized_engagers: {
          founders: analysis.categories.founders.map(convertToCategorizedEngager),
          vcs: analysis.categories.vcs.map(convertToCategorizedEngager),
          ai_creators: analysis.categories.ai_creators.map(convertToCategorizedEngager),
          media: analysis.categories.media.map(convertToCategorizedEngager),
          developers: analysis.categories.developers.map(convertToCategorizedEngager),
          c_level: analysis.categories.c_level.map(convertToCategorizedEngager),
          yc_alumni: analysis.categories.yc_alumni.map(convertToCategorizedEngager),
          others: analysis.categories.others.map(convertToCategorizedEngager),
        },
      },
      notable_people: analysis.notable_people.map(np => ({
        username: np.username,
        name: np.name,
        engagement_type: np.engagement_type,
      })),
      narrative,
      sample_bios: analysis.sample_bios,
    };
  } catch (error) {
    console.error('Error generating AI report:', error);
    if (error instanceof OpenAI.APIError) {
      throw new Error(`OpenAI API error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Basic validation to ensure narrative doesn't contain obviously wrong data
 */
function validateNarrative(narrative: string, analysis: EngagerAnalysis): void {
  const narrativeLower = narrative.toLowerCase();

  // Check for common hallucination patterns
  const total = analysis.engagement_stats.total;

  // If narrative mentions a total that's way off, flag it
  const mentionedNumbers = narrative.match(/\d+/g);
  if (mentionedNumbers) {
    for (const num of mentionedNumbers) {
      const numInt = parseInt(num);
      // If number is close to total (within 10%), that's fine
      // But if it's way off and looks like a made-up total, warn
      if (numInt > total * 1.5 && numInt < 10000) {
        console.warn(`Potential hallucination detected: narrative mentions ${numInt} but total is ${total}`);
      }
    }
  }

  // Check that notable people mentioned actually exist
  for (const notable of analysis.notable_people) {
    if (narrativeLower.includes(`@${notable.username.toLowerCase()}`) || 
        narrativeLower.includes(notable.name.toLowerCase())) {
      // Good - they're mentioning actual notable people
      continue;
    }
  }
}

