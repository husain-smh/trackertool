/**
 * API Route: Get All Authorized Clients
 * 
 * Returns a list of all clients who have authorized their X account.
 * Used by the admin page to display the list of connected clients.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClientOAuthCollection, ClientOAuth } from '@/lib/models/socap/client-oauth';

export interface AuthorizedClient {
  client_id: string;
  x_username: string;
  x_name: string;
  status: 'active' | 'expired' | 'revoked';
  authorized_at: string;
  last_used_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const collection = await getClientOAuthCollection();
    
    // Get all OAuth records, sorted by most recently authorized
    const oauthRecords = await collection
      .find({})
      .sort({ authorized_at: -1 })
      .toArray();
    
    // Map to a cleaner response format (don't expose tokens!)
    const clients: AuthorizedClient[] = oauthRecords.map((record) => ({
      client_id: record.client_id,
      x_username: record.x_username,
      x_name: record.x_name,
      status: record.status,
      authorized_at: record.authorized_at?.toISOString() || new Date().toISOString(),
      last_used_at: record.last_used_at?.toISOString() || null,
    }));
    
    return NextResponse.json({
      success: true,
      clients,
      count: clients.length,
    });
  } catch (error) {
    console.error('[API] Error fetching authorized clients:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to fetch clients' 
      },
      { status: 500 }
    );
  }
}
