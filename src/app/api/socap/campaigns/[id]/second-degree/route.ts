import { NextRequest, NextResponse } from 'next/server';
import { getQuoteTweetsCollection } from '@/lib/models/socap/quote-tweets';
import { getSecondOrderEngagementsCollection } from '@/lib/models/socap/second-order-engagements';
import { getCampaignById } from '@/lib/models/socap/campaigns';

// Vercel Pro: Allow up to 30 seconds for this function (handles cold starts + DB queries)
export const maxDuration = 30;

type Category = 'main_twt' | 'influencer_twt' | 'investor_twt' | undefined;

type SeriesPoint = {
  time: string;
  views: number;
  likes: number;
  retweets: number;
  replies: number;
  second_order_retweets: number;
  second_order_replies: number;
};

type Totals = {
  views: number;
  likes: number;
  retweets: number;
  replies: number;
  second_order_retweets: number;
  second_order_replies: number;
};

const emptyTotals = (): Totals => ({
  views: 0,
  likes: 0,
  retweets: 0,
  replies: 0,
  second_order_retweets: 0,
  second_order_replies: 0,
});

function ensureCategory(cat: Category): Category {
  if (cat === 'main_twt' || cat === 'influencer_twt' || cat === 'investor_twt') return cat;
  return undefined;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;

    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      return NextResponse.json(
        { success: false, error: 'Campaign not found' },
        { status: 404 }
      );
    }

    const minDate = campaign.chart_min_date ? new Date(campaign.chart_min_date) : null;

    const quoteTweetsCol = await getQuoteTweetsCollection();
    const secondOrderCol = await getSecondOrderEngagementsCollection();

    const quoteAgg = await quoteTweetsCol
      .aggregate([
        {
          $match: {
            campaign_id: campaignId,
            ...(minDate ? { created_at: { $gte: minDate } } : {}),
          },
        },
        {
          $addFields: {
            bucket: { $dateTrunc: { date: '$created_at', unit: 'hour' } },
          },
        },
        {
          $group: {
            _id: { cat: '$parent_category', bucket: '$bucket' },
            views: { $sum: { $ifNull: ['$metrics.viewCount', 0] } },
            likes: { $sum: { $ifNull: ['$metrics.likeCount', 0] } },
            retweets: { $sum: { $ifNull: ['$metrics.retweetCount', 0] } },
            replies: { $sum: { $ifNull: ['$metrics.replyCount', 0] } },
          },
        },
      ])
      .toArray();

    const secondAgg = await secondOrderCol
      .aggregate([
        {
          $match: {
            campaign_id: campaignId,
            ...(minDate ? { timestamp: { $gte: minDate } } : {}),
          },
        },
        {
          $addFields: {
            bucket: { $dateTrunc: { date: '$timestamp', unit: 'hour' } },
          },
        },
        {
          $group: {
            _id: { cat: '$parent_category', bucket: '$bucket' },
            second_order_retweets: {
              $sum: {
                $cond: [{ $eq: ['$action_type', 'retweet'] }, 1, 0],
              },
            },
            second_order_replies: {
              $sum: {
                $cond: [{ $eq: ['$action_type', 'reply'] }, 1, 0],
              },
            },
          },
        },
      ])
      .toArray();

    const totals: Record<string, Totals> = {
      main_twt: emptyTotals(),
      influencer_twt: emptyTotals(),
      investor_twt: emptyTotals(),
    };

    const seriesMap: Record<string, Map<string, SeriesPoint>> = {
      main_twt: new Map(),
      influencer_twt: new Map(),
      investor_twt: new Map(),
    };

    const upsertPoint = (cat: Category, bucket: Date) => {
      const key = bucket.toISOString();
      if (!cat || !seriesMap[cat]) return undefined;
      if (!seriesMap[cat].has(key)) {
        seriesMap[cat].set(key, {
          time: key,
          views: 0,
          likes: 0,
          retweets: 0,
          replies: 0,
          second_order_retweets: 0,
          second_order_replies: 0,
        });
      }
      return seriesMap[cat].get(key)!;
    };

    for (const doc of quoteAgg) {
      const cat = ensureCategory(doc._id?.cat);
      if (!cat) continue;
      const bucket: Date = doc._id.bucket;
      const point = upsertPoint(cat, bucket);
      if (!point) continue;
      point.views += doc.views || 0;
      point.likes += doc.likes || 0;
      point.retweets += doc.retweets || 0;
      point.replies += doc.replies || 0;

      totals[cat].views += doc.views || 0;
      totals[cat].likes += doc.likes || 0;
      totals[cat].retweets += doc.retweets || 0;
      totals[cat].replies += doc.replies || 0;
    }

    for (const doc of secondAgg) {
      const cat = ensureCategory(doc._id?.cat);
      if (!cat) continue;
      const bucket: Date = doc._id.bucket;
      const point = upsertPoint(cat, bucket);
      if (!point) continue;
      point.second_order_retweets += doc.second_order_retweets || 0;
      point.second_order_replies += doc.second_order_replies || 0;

      totals[cat].second_order_retweets += doc.second_order_retweets || 0;
      totals[cat].second_order_replies += doc.second_order_replies || 0;
    }

    const series: Record<string, SeriesPoint[]> = {
      main_twt: Array.from(seriesMap.main_twt.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      ),
      influencer_twt: Array.from(seriesMap.influencer_twt.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      ),
      investor_twt: Array.from(seriesMap.investor_twt.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      ),
    };

    return NextResponse.json({
      success: true,
      data: {
        totals,
        series,
      },
    });
  } catch (error) {
    console.error('Error fetching second-degree metrics:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch second-degree metrics',
      },
      { status: 500 }
    );
  }
}


