import { NextRequest, NextResponse } from 'next/server';
import { getClient, removeClient, updateClient } from '@/lib/models/clients';

// DELETE - Remove a managed client
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const deleted = await removeClient(username);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Client @${username} removed`,
    });
  } catch (error) {
    console.error('[clients] Error removing client:', error);
    return NextResponse.json(
      { error: 'Failed to remove client', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// PATCH - Update client settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params;
    const body = await request.json();

    const allowedFields = ['display_name', 'auto_analyze', 'monitoring_enabled'] as const;
    const updates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const updated = await updateClient(username, updates as any);

    if (!updated) {
      return NextResponse.json(
        { error: 'Client not found' },
        { status: 404 }
      );
    }

    const client = await getClient(username);
    return NextResponse.json({ success: true, client });
  } catch (error) {
    console.error('[clients] Error updating client:', error);
    return NextResponse.json(
      { error: 'Failed to update client', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
