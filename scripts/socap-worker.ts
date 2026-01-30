#!/usr/bin/env node

/**
 * SOCAP Worker Service
 * 
 * Standalone worker service that processes jobs continuously.
 * Run this as a separate Node.js process for production.
 * 
 * Usage:
 *   npm run worker
 *   or
 *   node scripts/socap-worker.js
 *   or
 *   tsx scripts/socap-worker.ts
 */

// Load environment variables FIRST before any other imports
import 'dotenv/config';

import { WorkerOrchestrator } from '../src/lib/socap/workers/worker-orchestrator';

const CONCURRENCY = parseInt(process.env.SOCAP_WORKER_CONCURRENCY || '5', 10);
const MAX_JOBS_PER_BATCH = parseInt(process.env.SOCAP_MAX_JOBS_PER_BATCH || '100', 10);

console.log('🚀 Starting SOCAP Worker Service...');
console.log(`   Concurrency: ${CONCURRENCY}`);
console.log(`   Max jobs per batch: ${MAX_JOBS_PER_BATCH}`);

const orchestrator = new WorkerOrchestrator(CONCURRENCY);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  orchestrator.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  orchestrator.stop();
  process.exit(0);
});

// Start processing
orchestrator.start().catch((error) => {
  console.error('❌ Fatal error in worker service:', error);
  process.exit(1);
});

console.log('✅ Worker service started. Press Ctrl+C to stop.');

