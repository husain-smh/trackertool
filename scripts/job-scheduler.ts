import cron from 'node-cron';
import { config } from 'dotenv';

// Load environment variables
config();

// Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://identity-labs-x.vercel.app';

interface SchedulerConfig {
  name: string;
  endpoint: string;
  interval: string; // Cron format
  method?: 'GET' | 'POST';
  body?: any;
}

// Define your scheduled jobs here
const JOBS: SchedulerConfig[] = [
  {
    name: 'Create Jobs (Trigger Workers)',
    endpoint: `${API_BASE_URL}/api/socap/workers/trigger`,
    interval: '*/15 * * * *', // Every 15 minutes
    method: 'POST',
  },
  {
    name: 'Process Jobs (Run Workers)',
    endpoint: `${API_BASE_URL}/api/socap/workers/run`,
    interval: '*/5 * * * *', // Every 5 minutes
    method: 'POST',
    body: {
      maxJobs: 100,
      concurrency: 5,
    },
  },
  // Add more jobs as needed
  // {
  //   name: 'Custom Job',
  //   endpoint: `${API_BASE_URL}/api/some-endpoint`,
  //   interval: '*/2 * * * *', // Every 2 minutes
  //   method: 'POST',
  // },
];

/**
 * Execute a single scheduled job
 */
async function executeJob(job: SchedulerConfig): Promise<void> {
  const startTime = Date.now();
  console.log(`\n[${new Date().toISOString()}] 🚀 Starting: ${job.name}`);

  try {
    const options: RequestInit = {
      method: job.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (job.body) {
      options.body = JSON.stringify(job.body);
    }

    const response = await fetch(job.endpoint, options);
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    console.log(`✅ Success: ${job.name}`);
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Failed: ${job.name}`);
    console.error(`   Duration: ${duration}ms`);
    console.error(`   Error:`, error instanceof Error ? error.message : error);
  }
}

/**
 * Initialize all scheduled jobs
 */
function initializeScheduler(): void {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         SOCAP Job Scheduler - Starting                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`🌐 API Base URL: ${API_BASE_URL}\n`);
  console.log('📅 Scheduled Jobs:\n');

  for (const job of JOBS) {
    console.log(`   ⏰ ${job.name}`);
    console.log(`      Endpoint: ${job.endpoint}`);
    console.log(`      Interval: ${job.interval}`);
    console.log('');

    // Schedule the job
    cron.schedule(job.interval, () => {
      executeJob(job);
    });
  }

  console.log('✅ All jobs scheduled successfully!');
  console.log('📊 Scheduler is now running... (Press Ctrl+C to stop)\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Graceful shutdown handler
 */
function setupGracefulShutdown(): void {
  const shutdown = () => {
    console.log('\n\n🛑 Shutting down scheduler...');
    console.log('✅ Scheduler stopped cleanly');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ===== Main Execution =====

// Set up graceful shutdown
setupGracefulShutdown();

// Initialize and start the scheduler
initializeScheduler();

// Optional: Run all jobs once on startup for immediate testing
// Uncomment the lines below if you want to trigger all jobs immediately
// console.log('🔄 Running all jobs once on startup...\n');
// for (const job of JOBS) {
//   executeJob(job);
// }

