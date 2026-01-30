import { NextRequest, NextResponse } from 'next/server';
import { analyzeEngagers } from '@/lib/analyze-engagers';
import { generateAIReport } from '@/lib/generate-ai-report';
import { getTweet, updateTweetReport } from '@/lib/models/tweets';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tweetId: string }> }
) {
  try {
    const { tweetId } = await params;

    // Verify tweet exists
    const tweet = await getTweet(tweetId);
    if (!tweet) {
      return NextResponse.json(
        { error: 'Tweet not found' },
        { status: 404 }
      );
    }

    // Analyze all engagers
    console.log(`[Generate Report] Starting analysis for tweet ${tweetId}...`);
    const analysis = await analyzeEngagers(tweetId);
    console.log(`[Generate Report] Analysis complete. Found ${analysis.all_engagers.length} engagers.`);

    // Generate AI report
    console.log(`[Generate Report] Generating AI narrative...`);
    const report = await generateAIReport(analysis);
    console.log(`[Generate Report] AI report generated successfully.`);

    // Store report in tweet document
    await updateTweetReport(tweetId, report);
    console.log(`[Generate Report] Report saved to database.`);

    return NextResponse.json({
      success: true,
      report,
    });

  } catch (error) {
    console.error('Error generating report:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to generate report',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

