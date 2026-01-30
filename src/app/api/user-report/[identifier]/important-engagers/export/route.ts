import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getEngagersCollection, getTweetsCollection } from '@/lib/models/tweets';

function parseBoundedInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  try {
    const { identifier } = await params;
    const { searchParams } = new URL(request.url);

    const all = searchParams.get('all') === 'true';
    const limit = all ? parseBoundedInt(searchParams.get('limit'), 5000, 1, 20_000) : parseBoundedInt(searchParams.get('limit'), 50, 1, 200);
    const skip = all ? 0 : parseBoundedInt(searchParams.get('skip'), 0, 0, 1_000_000);

    const tweetsCollection = await getTweetsCollection();

    // Find tweets for this author (same matching logic as the report: username (preferred), fallback to name).
    const trimmed = identifier.trim();
    const sanitizedUsername = trimmed.replace(/^@/, '');
    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    let tweets: Array<{ tweet_id: string; tweet_url: string }> = [];
    if (sanitizedUsername) {
      const usernameRegex = new RegExp(`^@?${escapeRegex(sanitizedUsername)}$`, 'i');
      tweets = (await tweetsCollection
        .find({ author_username: usernameRegex })
        .project({ tweet_id: 1, tweet_url: 1, _id: 0 })
        .toArray()) as Array<{ tweet_id: string; tweet_url: string }>;
    }

    if (tweets.length === 0) {
      const nameRegex = new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
      tweets = (await tweetsCollection
        .find({ author_name: nameRegex })
        .project({ tweet_id: 1, tweet_url: 1, _id: 0 })
        .toArray()) as Array<{ tweet_id: string; tweet_url: string }>;
    }

    if (tweets.length === 0) {
      return NextResponse.json({ error: 'Author not found' }, { status: 404 });
    }

    const tweetIds = tweets.map((t: any) => String(t.tweet_id));
    const tweetUrlById = new Map<string, string>(
      tweets.map((t: any) => [String(t.tweet_id), String(t.tweet_url)]),
    );

    const engagersCollection = await getEngagersCollection();

    const match = {
      tweet_id: { $in: tweetIds },
      importance_score: { $gt: 0 },
      $or: [{ replied: true }, { retweeted: true }, { quoted: true }, { liked: true }],
    };

    // We fetch a "page" (or all) of top important engagers, and also keep per-tweet action flags to build a second sheet.
    const pipeline: any[] = [
      { $match: match },
      { $sort: { importance_score: -1, followers: -1 } },
      {
        $group: {
          _id: '$userId',
          userId: { $first: '$userId' },
          username: { $first: '$username' },
          name: { $first: '$name' },
          bio: { $first: '$bio' },
          followers: { $max: '$followers' },
          verified: { $max: { $cond: ['$verified', 1, 0] } },
          importance_score: { $max: '$importance_score' },
          tweetEngagements: {
            $push: {
              tweetId: '$tweet_id',
              replied: '$replied',
              retweeted: '$retweeted',
              quoted: '$quoted',
              liked: '$liked',
            },
          },
        },
      },
      { $sort: { importance_score: -1, followers: -1 } },
      ...(skip > 0 ? [{ $skip: skip }] : []),
      { $limit: limit },
    ];

    const rows = await engagersCollection.aggregate(pipeline).toArray();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Social Capital Inc.';
    workbook.created = new Date();

    const sheetUsers = workbook.addWorksheet('Users', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const sheetEngagements = workbook.addWorksheet('Engagements', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    const headerFont = { name: 'Calibri', size: 11, bold: true } as const;
    const bodyFont = { name: 'Calibri', size: 11 } as const;

    sheetUsers.columns = [
      { header: 'Importance Score', key: 'importance', width: 16 },
      { header: 'Username', key: 'username', width: 22 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Verified', key: 'verified', width: 10 },
      { header: 'Followers', key: 'followers', width: 12 },
      { header: 'Signals (unique)', key: 'signals', width: 18 },
      { header: 'Tweets Engaged', key: 'tweets', width: 14 },
      { header: 'Bio', key: 'bio', width: 60 },
    ];

    sheetEngagements.columns = [
      { header: 'Username', key: 'username', width: 22 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Importance Score', key: 'importance', width: 16 },
      { header: 'Tweet ID', key: 'tweetId', width: 22 },
      { header: 'Actions', key: 'actions', width: 22 },
      { header: 'Tweet URL', key: 'tweetUrl', width: 46 },
    ];

    const styleHeaderRow = (ws: ExcelJS.Worksheet) => {
      const headerRow = ws.getRow(1);
      headerRow.font = headerFont;
      headerRow.alignment = { vertical: 'middle' };
      headerRow.height = 18;
      headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFBDBDBD' } },
          left: { style: 'thin', color: { argb: 'FFBDBDBD' } },
          bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
          right: { style: 'thin', color: { argb: 'FFBDBDBD' } },
        };
      });
    };

    styleHeaderRow(sheetUsers);
    styleHeaderRow(sheetEngagements);

    for (const row of rows) {
      const tweetEngagements = (row.tweetEngagements ?? [])
        .map((te: any) => {
          const actions: string[] = [];
          if (te.replied) actions.push('Replied');
          if (te.retweeted) actions.push('Retweeted');
          if (te.quoted) actions.push('Quoted');
          if (te.liked) actions.push('Liked');
          return {
            tweetId: String(te.tweetId),
            tweetUrl:
              tweetUrlById.get(String(te.tweetId)) ??
              `https://twitter.com/i/status/${String(te.tweetId)}`,
            actions,
          };
        })
        .filter((te: any) => te.actions.length > 0);

      const uniqueSignals = new Set<string>();
      for (const te of tweetEngagements) {
        for (const action of te.actions) uniqueSignals.add(action);
      }

      const userRow = sheetUsers.addRow({
        importance: Number(row.importance_score ?? 0),
        username: row.username ? `@${String(row.username).replace(/^@/, '')}` : '',
        name: String(row.name ?? ''),
        verified: Boolean(row.verified) ? 'Yes' : 'No',
        followers: Number(row.followers ?? 0),
        signals: Array.from(uniqueSignals).join(', '),
        tweets: tweetEngagements.length,
        bio: typeof row.bio === 'string' ? row.bio : '',
      });
      userRow.font = bodyFont;
      userRow.alignment = { vertical: 'top', wrapText: true };

      for (const te of tweetEngagements) {
        const engagementRow = sheetEngagements.addRow({
          username: row.username ? `@${String(row.username).replace(/^@/, '')}` : '',
          name: String(row.name ?? ''),
          importance: Number(row.importance_score ?? 0),
          tweetId: te.tweetId,
          actions: te.actions.join(', '),
          tweetUrl: te.tweetUrl,
        });
        engagementRow.font = bodyFont;
        engagementRow.alignment = { vertical: 'top', wrapText: true };
      }
    }

    // Simple number formatting
    sheetUsers.getColumn('importance').numFmt = '0.0';
    sheetUsers.getColumn('followers').numFmt = '#,##0';
    sheetEngagements.getColumn('importance').numFmt = '0.0';

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `user_report_important_accounts_${sanitizeFilename(identifier)}${all ? '_all' : `_skip_${skip}_limit_${limit}`}.xlsx`;

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to export important engagers', error);
    return NextResponse.json(
      {
        error: 'Failed to export important engagers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

