import { NextRequest, NextResponse } from 'next/server';
import { getImportantPeopleCollection } from '@/lib/models/ranker';

// POST - Trigger sync for all important people
export async function POST(request: NextRequest) {
  try {
    const collection = await getImportantPeopleCollection();
    const allPeople = await collection.find({ is_active: true }).toArray();

    if (allPeople.length === 0) {
      return NextResponse.json(
        { error: 'No important people to sync' },
        { status: 404 }
      );
    }

    console.log(`Starting sync for ${allPeople.length} people...`);

    const results = {
      total: allPeople.length,
      successful: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Sync each person sequentially with delay
    for (const person of allPeople) {
      try {
        console.log(`Syncing @${person.username}...`);

        // Call our sync endpoint
        const response = await fetch(`${request.nextUrl.origin}/api/ranker/admin/sync-person`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username: person.username }),
        });

        if (response.ok) {
          results.successful++;
          console.log(`✅ @${person.username} synced successfully`);
        } else {
          results.failed++;
          const error = await response.json();
          results.errors.push(`@${person.username}: ${error.error}`);
          console.error(`❌ @${person.username} failed:`, error.error);
        }

        // Wait 2 seconds between requests to avoid rate limits
        if (person !== allPeople[allPeople.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`@${person.username}: ${errorMsg}`);
        console.error(`❌ @${person.username} failed:`, errorMsg);
      }
    }

    console.log(`Sync complete: ${results.successful} successful, ${results.failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Sync complete: ${results.successful}/${results.total} successful`,
      data: results,
    });

  } catch (error) {
    console.error('Error in sync-all:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to sync all people',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

