#!/usr/bin/env node

/**
 * SOCAP Turbo Worker Service
 * 
 * High-performance worker for processing large job backlogs quickly.
 * Use this when you have many pending jobs (like 265 jobs).
 * 
 * Features:
 * - Higher default concurrency (15)
 * - Minimal delay between batches (100ms instead of 1s)
 * - Real-time progress tracking with ETA
 * - Campaign-specific filtering (ONLY processes jobs for that campaign)
 * 
 * Usage:
 *   npm run turbo-worker
 *   
 *   With custom concurrency:
 *   npx tsx scripts/turbo-worker.ts --concurrency=25
 *   
 *   Process ONLY a specific campaign's jobs:
 *   npx tsx scripts/turbo-worker.ts --campaign=6936d390b3d6b8e3d2869b76
 *   
 *   Combined:
 *   npx tsx scripts/turbo-worker.ts --campaign=YOUR_CAMPAIGN_ID --concurrency=20
 */

import 'dotenv/config';

import { WorkerOrchestrator } from '../src/lib/socap/workers/worker-orchestrator';
import { getJobQueueStats, getJobQueueCollection } from '../src/lib/socap/job-queue';

// Parse command line arguments
const args = process.argv.slice(2);
const concurrencyArg = args.find((arg) => arg.startsWith('--concurrency='));
const batchArg = args.find((arg) => arg.startsWith('--batch='));
const campaignArg = args.find((arg) => arg.startsWith('--campaign='));

// Higher defaults for turbo mode
const CONCURRENCY = concurrencyArg
  ? parseInt(concurrencyArg.split('=')[1], 10)
  : parseInt(process.env.SOCAP_TURBO_CONCURRENCY || '15', 10);

const MAX_JOBS_PER_BATCH = batchArg
  ? parseInt(batchArg.split('=')[1], 10)
  : parseInt(process.env.SOCAP_MAX_JOBS_PER_BATCH || '500', 10);

// Minimal delay between batches in turbo mode
const BATCH_DELAY_MS = parseInt(process.env.SOCAP_TURBO_DELAY || '100', 10);

// Campaign filter (optional)
const CAMPAIGN_ID = campaignArg ? campaignArg.split('=')[1] : null;

// Progress update frequency
const PROGRESS_UPDATE_INTERVAL = 10; // Update every 10 jobs

/**
 * Enhanced orchestrator with faster processing and real-time progress tracking
 */
class TurboWorkerOrchestrator extends WorkerOrchestrator {
  private totalProcessed = 0;
  private totalCompleted = 0;
  private totalFailed = 0;
  private startTime = Date.now();
  private lastProgressUpdate = 0;
  private totalPending = 0;
  private campaignJobsCount = 0;
  private campaignJobsProcessed = 0;

  constructor(concurrency: number) {
    super(concurrency);
  }


  /**
   * Get count of pending jobs for a specific campaign
   */
  private async getCampaignPendingCount(campaignId: string): Promise<number> {
    const collection = await getJobQueueCollection();
    return await collection.countDocuments({ 
      campaign_id: campaignId, 
      status: 'pending' 
    });
  }

  /**
   * Print real-time progress update
   */
  private printProgress(force: boolean = false): void {
    // Only print every PROGRESS_UPDATE_INTERVAL jobs (or if forced)
    if (!force && this.totalProcessed - this.lastProgressUpdate < PROGRESS_UPDATE_INTERVAL) {
      return;
    }
    this.lastProgressUpdate = this.totalProcessed;

    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = elapsed > 0 ? this.totalProcessed / elapsed : 0;
    const remaining = this.totalPending - this.totalProcessed;
    const eta = rate > 0 ? Math.ceil(remaining / rate) : 0;

    // Progress bar
    const progress = Math.min(100, (this.totalProcessed / this.totalPending) * 100);
    const filled = Math.floor(progress / 2);
    const bar = '█'.repeat(filled) + '░'.repeat(50 - filled);

    // Format ETA nicely
    const etaStr = eta > 60 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : `${eta}s`;

    // Campaign-specific info
    const campaignInfo = CAMPAIGN_ID 
      ? ` | 🎯 Campaign: ${this.campaignJobsProcessed}/${this.campaignJobsCount}`
      : '';

    // Use \r to overwrite the line (no newline spam)
    process.stdout.write(`\r   [${bar}] ${progress.toFixed(1)}% | ${this.totalProcessed}/${this.totalPending} | ✅${this.totalCompleted} ❌${this.totalFailed} | ${rate.toFixed(1)}/s | ETA: ${etaStr}${campaignInfo}   `);
  }

  /**
   * Start turbo processing with real-time progress tracking
   */
  async startTurbo(): Promise<void> {
    console.log('');
    console.log('🚀 ═══════════════════════════════════════════════════════════');
    console.log('   TURBO WORKER MODE - High Performance Job Processing');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Concurrency:     ${CONCURRENCY} parallel jobs`);
    console.log(`   Batch size:      ${MAX_JOBS_PER_BATCH} jobs per batch`);
    console.log(`   Batch delay:     ${BATCH_DELAY_MS}ms`);
    if (CAMPAIGN_ID) {
      console.log(`   🎯 Filter:       Campaign ${CAMPAIGN_ID} ONLY`);
    }
    console.log('═══════════════════════════════════════════════════════════\n');

    // Handle campaign filter if specified
    if (CAMPAIGN_ID) {
      this.campaignJobsCount = await this.getCampaignPendingCount(CAMPAIGN_ID);
      if (this.campaignJobsCount > 0) {
        console.log(`🎯 Campaign filter active: ${CAMPAIGN_ID}`);
        console.log(`   Found ${this.campaignJobsCount} pending jobs for this campaign`);
        console.log(`   ONLY processing jobs for this campaign (ignoring others)\n`);
        // Set totalPending to just this campaign's jobs
        this.totalPending = this.campaignJobsCount;
      } else {
        console.log(`⚠️  No pending jobs found for campaign ${CAMPAIGN_ID}`);
        console.log(`   Nothing to process. Exiting.\n`);
        return;
      }
    } else {
      // No campaign filter - get all pending jobs
      const stats = await getJobQueueStats();
      this.totalPending = stats.pending;

      if (this.totalPending === 0) {
        console.log('✅ No pending jobs to process!');
        return;
      }

      console.log(`📋 Found ${this.totalPending} pending jobs to process`);
    }
    
    console.log(`   Progress updates every ${PROGRESS_UPDATE_INTERVAL} jobs\n`);

    let isRunning = true;
    let batchNumber = 0;

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n\n⚠️  Received shutdown signal, finishing current batch...');
      isRunning = false;
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (isRunning) {
      batchNumber++;

      try {
        const batchStats = await this.processJobsWithProgress(MAX_JOBS_PER_BATCH);

        if (batchStats.processed === 0) {
          // No more jobs
          break;
        }

        // Minimal delay between batches
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      } catch (error) {
        console.error('\n❌ Error in batch:', error);
        // Brief pause on error, then continue
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Final newline after progress bar
    console.log('\n');

    // Final summary
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   TURBO WORKER COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Total processed:  ${this.totalProcessed} jobs`);
    console.log(`   Completed:        ${this.totalCompleted} ✅`);
    console.log(`   Failed:           ${this.totalFailed} ❌`);
    if (CAMPAIGN_ID && this.campaignJobsCount > 0) {
      console.log(`   Campaign jobs:    ${this.campaignJobsProcessed}/${this.campaignJobsCount} 🎯`);
    }
    console.log(`   Total time:       ${totalTime}s`);
    console.log(`   Average rate:     ${(this.totalProcessed / parseFloat(totalTime)).toFixed(1)} jobs/sec`);
    console.log('═══════════════════════════════════════════════════════════\n');
  }

  /**
   * Process jobs with real-time progress updates
   */
  private async processJobsWithProgress(maxJobs: number): Promise<{
    processed: number;
    completed: number;
    failed: number;
  }> {
    const { claimJob, completeJob, failJob } = await import('../src/lib/socap/job-queue');
    const { RetweetsWorker } = await import('../src/lib/socap/workers/retweets-worker');
    const { RepliesWorker } = await import('../src/lib/socap/workers/replies-worker');
    const { QuotesWorker } = await import('../src/lib/socap/workers/quotes-worker');
    const { MetricsWorker } = await import('../src/lib/socap/workers/metrics-worker');

    const stats = { processed: 0, completed: 0, failed: 0 };
    const workerId = `turbo-${Date.now()}`;
    const activeJobs: Promise<void>[] = [];
    const workers = new Map();

    while (stats.processed < maxJobs) {
      // Pass campaign ID to filter jobs if specified
      const job = await claimJob(workerId, CAMPAIGN_ID || undefined);
      if (!job) break;

      stats.processed++;
      this.totalProcessed++;

      // Track campaign jobs
      if (CAMPAIGN_ID && job.campaign_id === CAMPAIGN_ID) {
        this.campaignJobsProcessed++;
      }

      // Real-time progress update
      this.printProgress();

      // Get or create worker
      const workerKey = `${job.job_type}-${workerId}`;
      if (!workers.has(workerKey)) {
        let worker;
        switch (job.job_type) {
          case 'retweets': worker = new RetweetsWorker(workerId); break;
          case 'replies': worker = new RepliesWorker(workerId); break;
          case 'quotes': worker = new QuotesWorker(workerId); break;
          case 'metrics': worker = new MetricsWorker(workerId); break;
          default: throw new Error(`Unknown job type: ${job.job_type}`);
        }
        workers.set(workerKey, worker);
      }
      const worker = workers.get(workerKey);

      // Process job
      const jobPromise = (async () => {
        try {
          await worker.execute(job);
          if (job._id) await completeJob(job._id);
          stats.completed++;
          this.totalCompleted++;

          // Trigger alert detection for engagement jobs
          if (job.job_type !== 'metrics') {
            try {
              const { detectAndQueueAlerts } = await import('../src/lib/socap/alert-detector');
              await detectAndQueueAlerts(job.campaign_id);
            } catch {}
          } else {
            try {
              const { processMetricSnapshots } = await import('../src/lib/socap/metric-snapshot-processor');
              await processMetricSnapshots(job.campaign_id);
            } catch {}
          }
        } catch (error) {
          stats.failed++;
          this.totalFailed++;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (job._id) await failJob(job._id, errorMessage);
        }
        // Update progress after each job completes
        this.printProgress();
      })().finally(() => {
        const idx = activeJobs.indexOf(jobPromise);
        if (idx > -1) activeJobs.splice(idx, 1);
      });

      activeJobs.push(jobPromise);

      // Wait if at concurrency limit
      if (activeJobs.length >= CONCURRENCY) {
        await Promise.race(activeJobs);
      }
    }

    await Promise.all(activeJobs);
    
    // Force final progress update
    this.printProgress(true);
    
    return stats;
  }
}

// Start the turbo worker
const orchestrator = new TurboWorkerOrchestrator(CONCURRENCY);

orchestrator.startTurbo()
  .then(() => {
    console.log('👋 Turbo worker finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
