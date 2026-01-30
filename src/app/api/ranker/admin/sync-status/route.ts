import { NextResponse } from 'next/server';
import { getImportantPeopleCollection } from '@/lib/models/ranker';

// GET - Get sync status for all important people
export async function GET() {
  try {
    const collection = await getImportantPeopleCollection();
    
    // Get all active important people with their sync status
    const people = await collection
      .find({ is_active: true })
      .sort({ last_synced: 1 }) // Oldest synced first (null values come first)
      .toArray();

    // Calculate statistics
    const totalPeople = people.length;
    const syncedPeople = people.filter(p => p.last_synced !== null).length;
    const unsyncedPeople = totalPeople - syncedPeople;
    
    // Get oldest and newest sync dates
    const syncedPeopleWithDates = people.filter(p => p.last_synced !== null);
    const oldestSync = syncedPeopleWithDates.length > 0 
      ? syncedPeopleWithDates[0].last_synced 
      : null;
    const newestSync = syncedPeopleWithDates.length > 0 
      ? syncedPeopleWithDates[syncedPeopleWithDates.length - 1].last_synced 
      : null;

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total_people: totalPeople,
          synced_people: syncedPeople,
          unsynced_people: unsyncedPeople,
          oldest_sync: oldestSync,
          newest_sync: newestSync,
        },
        people: people.map(p => ({
          username: p.username,
          user_id: p.user_id,
          name: p.name,
          last_synced: p.last_synced,
          following_count: p.following_count,
          sync_status: p.last_synced === null ? 'never_synced' : 'synced',
        })),
      },
    });

  } catch (error) {
    console.error('Error fetching sync status:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch sync status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

