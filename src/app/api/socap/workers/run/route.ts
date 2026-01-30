import { NextRequest, NextResponse } from 'next/server';
import { WorkerOrchestrator } from '@/lib/socap/workers/worker-orchestrator';
import { logger } from '@/lib/logger';

/**
 * POST /socap/workers/run
 * Process pending jobs from the job queue
 * Called by N8N on schedule (default: every 5 minutes)
 * 
 * Accepts optional body:
 * {
 *   "maxJobs": 100,    // Max jobs to process (default: 100)
 *   "concurrency": 5   // Concurrent jobs (default: 5)
 * }
 */
export async function POST(request: NextRequest) {
  const operationId = `worker-run-${Date.now()}`;
  
  try {
    // Parse body if present (N8N might not send body)
    let maxJobs = 100;
    let concurrency = 5;
    
    try {
      const body = await request.json().catch(() => ({}));
      maxJobs = body.maxJobs || 100;
      concurrency = body.concurrency || 5;
    } catch {
      // Body parsing failed, use defaults
      // This is fine - N8N might not send a body
    }
    
    logger.info('Starting worker processing', {
      operation: 'worker-run',
      operationId,
      maxJobs,
      concurrency,
    });
    
    const orchestrator = new WorkerOrchestrator(concurrency);
    const stats = await orchestrator.processJobs(maxJobs);
    
    logger.info('Worker processing completed', {
      operation: 'worker-run',
      operationId,
      stats,
    });
    
    return NextResponse.json({
      success: true,
      message: 'Worker processing completed',
      data: {
        ...stats,
        operationId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Worker processing failed', error, {
      operation: 'worker-run',
      operationId,
    });
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run workers',
        details: error instanceof Error ? error.message : 'Unknown error',
        operationId,
      },
      { status: 500 }
    );
  }
}

