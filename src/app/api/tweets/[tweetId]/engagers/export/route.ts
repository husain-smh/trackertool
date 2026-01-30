import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getTweet, getEngagers, type GetEngagersOptions } from '@/lib/models/tweets';

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
  { params }: { params: Promise<{ tweetId: string }> },
) {
  try {
    const { tweetId } = await params;
    const { searchParams } = new URL(request.url);

    const all = searchParams.get('all') === 'true';
    const limit = all
      ? parseBoundedInt(searchParams.get('limit'), 10000, 1, 50_000)
      : parseBoundedInt(searchParams.get('limit'), 50, 1, 200);
    const skip = all ? 0 : parseBoundedInt(searchParams.get('skip'), 0, 0, 1_000_000);

    const sortBy =
      (searchParams.get('sort_by') as GetEngagersOptions['sortBy']) || 'importance_score';
    const sortOrder =
      (searchParams.get('sort_order') as GetEngagersOptions['sortOrder']) || 'desc';

    const options: GetEngagersOptions = { limit, skip, sortBy, sortOrder };

    const minFollowers = searchParams.get('min_followers');
    if (minFollowers) {
      options.minFollowers = parseBoundedInt(minFollowers, 0, 0, 1_000_000_000);
    }
    const maxFollowers = searchParams.get('max_followers');
    if (maxFollowers) {
      options.maxFollowers = parseBoundedInt(maxFollowers, 0, 0, 1_000_000_000);
    }

    const engagementType = searchParams.get('engagement_type');
    if (engagementType) options.engagementType = engagementType as any;
    const verifiedOnly = searchParams.get('verified_only');
    if (verifiedOnly === 'true') options.verifiedOnly = true;

    const tweet = await getTweet(tweetId);
    if (!tweet) {
      return NextResponse.json({ error: 'Tweet not found' }, { status: 404 });
    }

    const { engagers } = await getEngagers(tweetId, options);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Social Capital Inc.';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Engagers', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Importance Score', key: 'importance', width: 16 },
      { header: 'Username', key: 'username', width: 22 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Followers', key: 'followers', width: 12 },
      { header: 'Verified', key: 'verified', width: 10 },
      { header: 'Signals', key: 'signals', width: 18 },
      { header: 'Bio', key: 'bio', width: 60 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { name: 'Calibri', size: 11, bold: true };
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

    for (const e of engagers) {
      const signals = [
        e.replied ? 'Replied' : null,
        e.retweeted ? 'Retweeted' : null,
        e.quoted ? 'Quoted' : null,
        e.liked ? 'Liked' : null,
      ].filter(Boolean);

      const row = sheet.addRow({
        importance: Number(e.importance_score ?? 0),
        username: e.username ? `@${String(e.username).replace(/^@/, '')}` : '',
        name: String(e.name ?? ''),
        followers: Number(e.followers ?? 0),
        verified: Boolean(e.verified) ? 'Yes' : 'No',
        signals: signals.join(', '),
        bio: typeof e.bio === 'string' ? e.bio : '',
      });
      row.font = { name: 'Calibri', size: 11 };
      row.alignment = { vertical: 'top', wrapText: true };
    }

    sheet.getColumn('importance').numFmt = '0.00';
    sheet.getColumn('followers').numFmt = '#,##0';

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `tweet_engagers_${sanitizeFilename(tweetId)}${all ? '_all' : `_skip_${skip}_limit_${limit}`}.xlsx`;

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
    console.error('Failed to export tweet engagers', error);
    return NextResponse.json(
      {
        error: 'Failed to export tweet engagers',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

