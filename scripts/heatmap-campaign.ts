/**
 * SOCAP Heatmap CLI
 *
 * Purpose:
 * - (Optional) Enrich `account_profile.account_based_in` for engagements in a campaign
 * - Compute and print the heatmap payload the UI uses
 * - Save the heatmap JSON to disk for inspection
 *
 * Run (from `ilpdts/`):
 *   npx tsx scripts/heatmap-campaign.ts --campaignId <id>
 *
 * Enrich + then compute (WARNING: uses external API credits / rate limits):
 *   npx tsx scripts/heatmap-campaign.ts --campaignId <id> --enrich --batches 5 --batchSize 20 --qps 5 --concurrency 5
 */

import 'dotenv/config';

import { writeFileSync } from 'fs';
import { resolve } from 'path';

type Args = {
  campaignId: string;
  enrich: boolean;
  batches: number;
  batchSize: number;
  delayMs: number;
  qps: number; // 0 means "disabled" (use delayMs only)
  concurrency: number;
  distributeRegions: boolean;
  outPrefix?: string;
};

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  npx tsx scripts/heatmap-campaign.ts --campaignId <id> [--enrich] [--batches N] [--batchSize N] [--delayMs MS] [--qps N] [--concurrency N] [--distributeRegions true|false] [--outPrefix pathPrefix]',
      '',
      'Examples:',
      '  npx tsx scripts/heatmap-campaign.ts --campaignId 64f0...abcd',
      '  npx tsx scripts/heatmap-campaign.ts --campaignId 64f0...abcd --enrich --batches 5 --batchSize 20 --qps 5 --concurrency 5',
      '',
      'Notes:',
      '  - Without --enrich, this script ONLY computes/prints heatmap from existing data.',
      '  - With --enrich, it calls the external “user about” API to populate account_based_in (rate-limited / credit usage).',
      '  - Throughput controls (only meaningful with --enrich):',
      '      --qps N: Target requests/second (default: 0 = disabled).',
      '      --concurrency N: Max in-flight requests (default: 1).',
      '    Effective spacing between request starts is max(--delayMs, 1000/--qps) when --qps > 0.',
    ].join('\n')
  );
}

function printHelpAndExit(): never {
  printUsage();
  process.exit(0);
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`\n❌ ${message}\n`);
  printUsage();
  process.exit(1);
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  printUsageAndExit(`Invalid boolean value: "${value}" (expected true/false)`);
}

function parseIntArg(value: string | undefined, name: string, defaultValue: number): number {
  if (value == null) return defaultValue;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    printUsageAndExit(`Invalid --${name} value: "${value}" (expected a non-negative integer)`);
  }
  return n;
}

function parseArgs(argv: string[]): Args {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelpAndExit();
  }

  const map = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith('--')) {
      map.set(key, true);
    } else {
      map.set(key, next);
      i++;
    }
  }

  const campaignId =
    (map.get('campaignId') as string | undefined) ??
    (map.get('campaign') as string | undefined) ??
    (map.get('c') as string | undefined);

  if (!campaignId) printUsageAndExit('Missing required --campaignId');

  const enrich = map.get('enrich') === true;
  const batches = parseIntArg(map.get('batches') as string | undefined, 'batches', 1);
  const batchSize = parseIntArg(map.get('batchSize') as string | undefined, 'batchSize', 20);
  const delayMs = parseIntArg(map.get('delayMs') as string | undefined, 'delayMs', 1000);
  const qps = parseIntArg(map.get('qps') as string | undefined, 'qps', 0);
  const concurrency = parseIntArg(map.get('concurrency') as string | undefined, 'concurrency', 1);
  const distributeRegions = parseBool(map.get('distributeRegions') as string | undefined, true);
  const outPrefix = map.get('outPrefix') === true ? undefined : (map.get('outPrefix') as string | undefined);

  if (concurrency === 0) {
    printUsageAndExit('--concurrency must be >= 1');
  }

  return {
    campaignId,
    enrich,
    batches,
    batchSize,
    delayMs,
    qps,
    concurrency,
    distributeRegions,
    outPrefix,
  };
}

function safeFileSlug(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('🔎 SOCAP Heatmap CLI');
  console.log(`- campaignId: ${args.campaignId}`);
  console.log(`- enrich: ${args.enrich ? 'yes' : 'no'}`);
  console.log(`- distributeRegions: ${args.distributeRegions ? 'yes' : 'no'}`);
  if (args.enrich) {
    console.log(`- concurrency: ${args.concurrency}`);
    console.log(`- delayMs: ${args.delayMs}`);
    console.log(`- qps: ${args.qps || '(disabled)'}`);
  }

  // Lazy imports so `--help` / missing args don't require DB env or connect.
  const [{ disconnect }, { getCampaignById }, { getEngagementsCollection }, locationSvc, heatmapAgg] =
    await Promise.all([
      import('../src/lib/mongodb'),
      import('../src/lib/models/socap/campaigns'),
      import('../src/lib/models/socap/engagements'),
      import('../src/lib/socap/location-enrichment-service'),
      import('../src/lib/socap/heatmap-aggregator'),
    ]);

  const { getUsersNeedingLocationEnrichment, enrichUserLocation } = locationSvc;
  const { getLocationHeatmapData, distributeRegionEngagements } = heatmapAgg;

  // Optional: validate campaign exists (UI endpoint requires it)
  const campaign = await getCampaignById(args.campaignId);
  console.log(`- campaign exists in socap_campaigns: ${campaign ? 'yes' : 'no'}`);

  // Show current engagement/location coverage so you know why the heatmap is empty
  const engagements = await getEngagementsCollection();
  const totalEngagements = await engagements.countDocuments({ campaign_id: args.campaignId });
  const withLocation = await engagements.countDocuments({
    campaign_id: args.campaignId,
    'account_profile.account_based_in': { $exists: true, $nin: [null, ''] },
  });
  const withoutLocation = totalEngagements - withLocation;

  console.log('\n📦 Engagement coverage');
  console.log(`- total engagements: ${totalEngagements.toLocaleString()}`);
  console.log(`- with account_based_in: ${withLocation.toLocaleString()}`);
  console.log(`- missing account_based_in: ${withoutLocation.toLocaleString()}`);

  if (args.enrich) {
    console.log('\n🧭 Running location enrichment batches (may use API credits)...');

    const intervalMs =
      args.qps > 0 ? Math.max(args.delayMs, Math.ceil(1000 / Math.max(1, args.qps))) : args.delayMs;

    // Simple global request-start scheduler:
    // Each task "books" a start time spaced by intervalMs, while allowing up to `concurrency` in-flight.
    let nextStartAt = Date.now();
    let scheduleChain = Promise.resolve();
    async function scheduleRequestStart(): Promise<void> {
      const startPromise = (scheduleChain = scheduleChain
        .catch(() => undefined)
        .then(async () => {
          const now = Date.now();
          const waitMs = Math.max(0, nextStartAt - now);
          nextStartAt = Math.max(nextStartAt, now) + intervalMs;
          if (waitMs > 0) await sleep(waitMs);
        }));
      await startPromise;
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let hitRateLimit = false;

    for (let batch = 1; batch <= args.batches; batch++) {
      const users = await getUsersNeedingLocationEnrichment(args.campaignId, args.batchSize);
      if (users.length === 0) {
        console.log(`✅ No users left needing location enrichment (stopping at batch ${batch - 1}).`);
        break;
      }

      console.log(
        `\n➡️ Batch ${batch}/${args.batches} (users=${users.length}, concurrency=${args.concurrency}, intervalMs=${intervalMs})`
      );

      let processed = 0;
      let updated = 0;
      let skipped = 0;
      let errors = 0;

      const queue = users.map((u) => u.username);
      const inFlight = new Set<Promise<void>>();

      const runOne = async (username: string) => {
        await scheduleRequestStart();
        try {
          const didUpdate = await enrichUserLocation(args.campaignId, username);
          processed++;
          totalProcessed++;
          if (didUpdate) {
            updated++;
            totalUpdated++;
          } else {
            skipped++;
            totalSkipped++;
          }
        } catch (err: any) {
          processed++;
          totalProcessed++;
          errors++;
          totalErrors++;

          // Best-effort detection for rate limits (TwitterApiError includes statusCode in many paths)
          const msg = err instanceof Error ? err.message : String(err);
          const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
          if (statusCode === 429 || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
            hitRateLimit = true;
          }
        }
      };

      for (const username of queue) {
        if (hitRateLimit) break;

        const p = runOne(username).finally(() => inFlight.delete(p));
        inFlight.add(p);

        if (inFlight.size >= args.concurrency) {
          await Promise.race(inFlight);
        }
      }

      // Drain remaining
      await Promise.allSettled(Array.from(inFlight));

      console.log(`- processed: ${processed}`);
      console.log(`- updated: ${updated}`);
      console.log(`- skipped: ${skipped}`);
      console.log(`- errors: ${errors}`);

      if (hitRateLimit) {
        console.log('⏸️ Detected rate limiting (429). Stopping early — re-run later to continue.');
        break;
      }

      if (processed === 0) {
        console.log('✅ Nothing processed in this batch (stopping).');
        break;
      }
    }

    console.log('\n📊 Enrichment totals (this run)');
    console.log(`- processed: ${totalProcessed}`);
    console.log(`- updated: ${totalUpdated}`);
    console.log(`- skipped: ${totalSkipped}`);
    console.log(`- errors: ${totalErrors}`);
  }

  console.log('\n🗺️ Computing heatmap...');
  const heatmap = await getLocationHeatmapData(args.campaignId);
  const locations = args.distributeRegions ? distributeRegionEngagements(heatmap.locations) : heatmap.locations;

  console.log('\n✅ Heatmap result');
  console.log(`- total_engagements: ${heatmap.total_engagements.toLocaleString()}`);
  console.log(`- total_locations: ${heatmap.total_locations.toLocaleString()}`);
  console.log(`- locations_with_data: ${heatmap.metadata.locations_with_data.toLocaleString()}`);
  console.log(`- locations_missing_data: ${heatmap.metadata.locations_missing_data.toLocaleString()}`);
  console.log(`- locations_unmapped: ${heatmap.metadata.locations_unmapped.toLocaleString()}`);

  console.log('\n🏆 Top 15 heatmap entries (post-distribution setting):');
  const top = [...locations].sort((a, b) => b.engagement_count - a.engagement_count).slice(0, 15);
  for (const [i, row] of top.entries()) {
    const codes = row.country_codes?.join(',') ?? '';
    const count =
      Number.isInteger(row.engagement_count) ? row.engagement_count : Number(row.engagement_count.toFixed(2));
    console.log(`${String(i + 1).padStart(2, ' ')}. ${codes.padEnd(6, ' ')}  ${String(count).padStart(8, ' ')}  (${row.location})`);
  }

  const prefix = args.outPrefix ?? `heatmap-${safeFileSlug(args.campaignId)}`;
  const out1 = resolve(process.cwd(), `${prefix}.raw.json`);
  const out2 = resolve(process.cwd(), `${prefix}.${args.distributeRegions ? 'distributed' : 'undistributed'}.json`);

  writeFileSync(out1, JSON.stringify(heatmap, null, 2), 'utf8');
  writeFileSync(
    out2,
    JSON.stringify(
      {
        ...heatmap,
        locations,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log('\n💾 Wrote files:');
  console.log(`- ${out1}`);
  console.log(`- ${out2}`);

  console.log('\nIf you want to verify what the UI calls, hit:');
  console.log(`  /api/socap/campaigns/${args.campaignId}/heatmap?distribute_regions=${args.distributeRegions ? 'true' : 'false'}`);
}

main()
  .then(async () => {
    const { disconnect } = await import('../src/lib/mongodb');
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n❌ Heatmap script failed:', err);
    const { disconnect } = await import('../src/lib/mongodb');
    await disconnect();
    process.exit(1);
  });


