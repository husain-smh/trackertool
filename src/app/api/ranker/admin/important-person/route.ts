import { NextRequest, NextResponse } from 'next/server';
import {
  addImportantPerson,
  removeImportantPerson,
  updateImportantPersonWeight,
  updateImportantPersonNetworth,
  updateImportantPersonTags,
} from '@/lib/models/ranker';

// Type for add result
interface AddResult {
  username: string;
  success: boolean;
  message: string;
  error?: string;
}

// POST - Add one or more important people (supports comma-separated usernames)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username } = body;

    // Validation
    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { error: 'username is required and must be a string (supports comma-separated values)' },
        { status: 400 }
      );
    }

    // Split by comma and clean up whitespace
    const usernames = username
      .split(',')
      .map(u => u.trim())
      .filter(u => u.length > 0); // Remove empty strings

    if (usernames.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid username is required' },
        { status: 400 }
      );
    }

    console.log(`Adding ${usernames.length} username(s): ${usernames.join(', ')}`);

    // Process each username
    const results: AddResult[] = [];
    for (const user of usernames) {
      try {
        await addImportantPerson(user);
        results.push({
          username: user,
          success: true,
          message: `@${user} added successfully`,
        });
      } catch (error) {
        // Handle duplicate key error
        if (error instanceof Error && error.message.includes('duplicate key')) {
          results.push({
            username: user,
            success: false,
            message: `@${user} already exists`,
            error: 'Duplicate entry',
          });
        } else {
          results.push({
            username: user,
            success: false,
            message: `Failed to add @${user}`,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Count successes and failures
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    // Determine response status
    // If all failed, return 500
    // If some succeeded, return 207 (Multi-Status)
    // If all succeeded, return 200
    let status = 200;
    if (failureCount === results.length) {
      status = 500;
    } else if (failureCount > 0) {
      status = 207; // Multi-Status: partial success
    }

    return NextResponse.json({
      success: successCount > 0,
      message: `Processed ${usernames.length} username(s): ${successCount} added, ${failureCount} failed`,
      summary: {
        total: usernames.length,
        added: successCount,
        failed: failureCount,
      },
      results,
    }, { status });

  } catch (error) {
    console.error('Error adding important person:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to add important person',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE - Remove/deactivate an important person
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');

    if (!username) {
      return NextResponse.json(
        { error: 'username query parameter is required' },
        { status: 400 }
      );
    }

    const removed = await removeImportantPerson(username);

    if (!removed) {
      return NextResponse.json(
        { error: 'Person not found or already inactive' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Important person deactivated successfully',
    });

  } catch (error) {
    console.error('Error removing important person:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to remove important person',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// PATCH - Update important person weight
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, weight, networth, tags } = body;

    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { error: 'username is required and must be a string' },
        { status: 400 }
      );
    }

    const hasWeightUpdate = weight !== undefined;
    const hasNetworthUpdate = networth !== undefined;
    const hasTagUpdate = tags !== undefined;

    if (!hasWeightUpdate && !hasNetworthUpdate && !hasTagUpdate) {
      return NextResponse.json(
        { error: 'Provide weight, networth, and/or tags to update' },
        { status: 400 }
      );
    }

    let parsedWeight: number | undefined;
    if (hasWeightUpdate) {
      parsedWeight = Number(weight);
      if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
        return NextResponse.json(
          { error: 'weight must be a positive number' },
          { status: 400 }
        );
      }
    }

    let parsedNetworth: number | null | undefined;
    if (hasNetworthUpdate) {
      // Allow null to clear networth, or a positive number
      if (networth === null || networth === '') {
        parsedNetworth = null;
      } else {
        parsedNetworth = Number(networth);
        if (!Number.isFinite(parsedNetworth) || parsedNetworth < 0) {
          return NextResponse.json(
            { error: 'networth must be a non-negative number or null' },
            { status: 400 }
          );
        }
      }
    }

    let normalizedTags: string[] | undefined;
    if (hasTagUpdate) {
      if (!Array.isArray(tags)) {
        return NextResponse.json(
          { error: 'tags must be an array of strings' },
          { status: 400 }
        );
      }

      normalizedTags = Array.from(
        new Map(
          tags
            .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
            .filter((tag) => tag.length > 0)
            .map((tag) => [tag.toLowerCase(), tag] as const)
        ).values()
      );
    }

    const trimmedUsername = username.trim();
    const results: string[] = [];

    if (hasWeightUpdate && parsedWeight !== undefined) {
      const updated = await updateImportantPersonWeight(trimmedUsername, parsedWeight);
      if (!updated) {
        return NextResponse.json(
          { error: 'Person not found or inactive' },
          { status: 404 }
        );
      }
      results.push(`weight updated to ${parsedWeight}`);
    }

    if (hasNetworthUpdate && parsedNetworth !== undefined) {
      const updated = await updateImportantPersonNetworth(trimmedUsername, parsedNetworth);
      if (!updated) {
        return NextResponse.json(
          { error: 'Person not found or inactive' },
          { status: 404 }
        );
      }
      if (parsedNetworth === null) {
        results.push('networth cleared');
      } else {
        results.push(`networth updated to ${parsedNetworth.toLocaleString()}`);
      }
    }

    if (hasTagUpdate && normalizedTags !== undefined) {
      const updated = await updateImportantPersonTags(trimmedUsername, normalizedTags);
      if (!updated) {
        return NextResponse.json(
          { error: 'Person not found or inactive' },
          { status: 404 }
        );
      }
      results.push(`tags set (${normalizedTags.length})`);
    }

    return NextResponse.json({
      success: true,
      message: `@${trimmedUsername} ${results.join(' & ')}`,
      data: {
        username: trimmedUsername,
        weight: parsedWeight,
        networth: parsedNetworth,
        tags: normalizedTags,
      },
    });
  } catch (error) {
    console.error('Error updating important person:', error);

    return NextResponse.json(
      {
        error: 'Failed to update person',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

