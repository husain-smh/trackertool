#!/usr/bin/env node

/**
 * Run All Campaigns Wrapper
 * 
 * This script fetches all active campaigns from the database and runs
 * a specified script for each campaign. Designed for use with GitHub Actions
 * or any automated scheduler.
 * 
 * Usage:
 *   npx tsx scripts/run-all-campaigns.ts --script narrative-scan
 *   npx tsx scripts/run-all-campaigns.ts --script aggregate-quote-metrics
 *   npx tsx scripts/run-all-campaigns.ts --script aggregate-nested-quote-metrics
 *   npx tsx scripts/run-all-campaigns.ts --script reply-narrative-scan
 *   npx tsx scripts/run-all-campaigns.ts --script nested-narrative-scan
 * 
 * Options:
 *   --script <name>     Script to run (without .ts extension)
 *   --campaign <id>     Run for a specific campaign only (optional)
 *   --dry-run           Show what would be run without executing
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import path from 'path';
import { getActiveCampaigns } from '../src/lib/models/socap/campaigns';
import { disconnect } from '../src/lib/mongodb';

// Map of script names to their campaign argument format
const SCRIPT_CAMPAIGN_ARGS: Record<string, string> = {
  'narrative-scan': '--campaign-id',
  'nested-narrative-scan': '--campaign-id',
  'reply-narrative-scan': '--campaign-id',
  'aggregate-quote-metrics': '--campaign',
  'aggregate-nested-quote-metrics': '--campaign',
  'fetch-replies-logged': '--campaign',
  'fetch-nested-quotes-logged': '--campaign',
  'populate-second-order-engagements': '--campaign',
  'regenerate-alerts': '', // positional argument
  'mark-invalid-alerts': '', // positional argument
};

function ts(): string {
  return new Date().toISOString();
}

function parseArg(name: string): string | null {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return null;
  
  const arg = process.argv[idx];
  if (arg.includes('=')) return arg.split('=')[1];
  if (process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function runScript(scriptName: string, campaignId: string): Promise<{ success: boolean; duration: number }> {
  const startTime = Date.now();
  const scriptPath = path.join(__dirname, `${scriptName}.ts`);
  
  const argFormat = SCRIPT_CAMPAIGN_ARGS[scriptName];
  const args = ['tsx', scriptPath];
  
  if (argFormat === '') {
    // Positional argument
    args.push(campaignId);
  } else if (argFormat) {
    args.push(argFormat, campaignId);
  }
  
  console.log(`[${ts()}] 🚀 Running: npx ${args.join(' ')}`);
  
  return new Promise((resolve) => {
    const child = spawn('npx', args, {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });
    
    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      if (code === 0) {
        console.log(`[${ts()}] ✅ Completed ${scriptName} for campaign ${campaignId} in ${(duration / 1000).toFixed(1)}s`);
        resolve({ success: true, duration });
      } else {
        console.error(`[${ts()}] ❌ Failed ${scriptName} for campaign ${campaignId} (exit code: ${code})`);
        resolve({ success: false, duration });
      }
    });
    
    child.on('error', (err) => {
      const duration = Date.now() - startTime;
      console.error(`[${ts()}] ❌ Error running ${scriptName}: ${err.message}`);
      resolve({ success: false, duration });
    });
  });
}

async function main(): Promise<void> {
  const scriptName = parseArg('--script');
  const specificCampaign = parseArg('--campaign');
  const dryRun = hasFlag('--dry-run');
  
  if (!scriptName) {
    console.error('Usage: npx tsx scripts/run-all-campaigns.ts --script <script-name> [--campaign <id>] [--dry-run]');
    console.error('\nAvailable scripts:');
    Object.keys(SCRIPT_CAMPAIGN_ARGS).forEach((s) => console.error(`  - ${s}`));
    process.exit(1);
  }
  
  if (!SCRIPT_CAMPAIGN_ARGS.hasOwnProperty(scriptName)) {
    console.error(`❌ Unknown script: ${scriptName}`);
    console.error('\nAvailable scripts:');
    Object.keys(SCRIPT_CAMPAIGN_ARGS).forEach((s) => console.error(`  - ${s}`));
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Run All Campaigns - Batch Runner                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  let campaigns: { _id: any; name?: string }[];
  
  if (specificCampaign) {
    campaigns = [{ _id: specificCampaign, name: 'Specified Campaign' }];
    console.log(`[${ts()}] 📌 Running for specific campaign: ${specificCampaign}`);
  } else {
    console.log(`[${ts()}] 📊 Fetching active campaigns...`);
    // Type assertion needed because Campaign interface has optional _id (for inserts)
    // but fetched MongoDB documents always have _id populated
    campaigns = await getActiveCampaigns() as { _id: any; name?: string }[];
    console.log(`[${ts()}] Found ${campaigns.length} active campaign(s)`);
  }
  
  if (campaigns.length === 0) {
    console.log(`[${ts()}] ⚠️ No active campaigns found. Exiting.`);
    await disconnect();
    process.exit(0);
  }
  
  console.log(`[${ts()}] 🎯 Script: ${scriptName}`);
  console.log(`[${ts()}] 📋 Campaigns to process:\n`);
  
  campaigns.forEach((c, i) => {
    const id = typeof c._id === 'string' ? c._id : c._id.toString();
    console.log(`   ${i + 1}. ${c.name || 'Unnamed'} (${id})`);
  });
  console.log('');
  
  if (dryRun) {
    console.log(`[${ts()}] 🔍 DRY RUN - Not executing scripts`);
    await disconnect();
    process.exit(0);
  }
  
  const results: { campaignId: string; success: boolean; duration: number }[] = [];
  
  for (const campaign of campaigns) {
    const campaignId = typeof campaign._id === 'string' ? campaign._id : campaign._id.toString();
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Campaign: ${campaign.name || 'Unnamed'} (${campaignId})`);
    console.log('═'.repeat(60));
    
    const result = await runScript(scriptName, campaignId);
    results.push({ campaignId, ...result });
  }
  
  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalDuration = results.reduce((acc, r) => acc + r.duration, 0);
  
  console.log(`[${ts()}] ✅ Successful: ${successful}/${results.length}`);
  console.log(`[${ts()}] ❌ Failed: ${failed}/${results.length}`);
  console.log(`[${ts()}] ⏱️  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  
  if (failed > 0) {
    console.log(`\n[${ts()}] Failed campaigns:`);
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`   - ${r.campaignId}`));
    await disconnect();
    process.exit(1);
  }
  
  console.log(`\n[${ts()}] 🎉 All campaigns processed successfully!`);
}

main()
  .then(async () => {
    // Gracefully close MongoDB connection so the process can exit
    await disconnect();
    // Note: exit code is handled inside main() based on success/failure
  })
  .catch(async (err) => {
    console.error(`[${ts()}] ❌ Fatal error:`, err);
    await disconnect();
    process.exit(1);
  });
