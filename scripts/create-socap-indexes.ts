/**
 * One-time SOCAP index builder.
 *
 * Run with:
 *   npx tsx scripts/create-socap-indexes.ts
 *
 * Loads .env, connects once, builds all known SOCAP indexes, then exits.
 */
import 'dotenv/config';

import { disconnect } from '../src/lib/mongodb';
import { createCampaignIndexes } from '../src/lib/models/socap/campaigns';
import { createTweetIndexes } from '../src/lib/models/socap/tweets';
import { createMetricSnapshotIndexes } from '../src/lib/models/socap/metric-snapshots';
import { createEngagementIndexes } from '../src/lib/models/socap/engagements';
import { createQuoteTweetIndexes } from '../src/lib/models/socap/quote-tweets';
import { createNestedQuoteTweetIndexes } from '../src/lib/models/socap/nested-quote-tweets';
import { createSecondOrderEngagementIndexes } from '../src/lib/models/socap/second-order-engagements';
import { createReplyIndexes } from '../src/lib/models/socap/replies';

async function main() {
  console.log('🚀 Creating SOCAP indexes...');

  await createCampaignIndexes();
  console.log('✅ Campaign indexes created');

  await createTweetIndexes();
  console.log('✅ Tweet indexes created');

  await createMetricSnapshotIndexes();
  console.log('✅ Metric snapshot indexes created');

  await createEngagementIndexes();
  console.log('✅ Engagement indexes created');

  await createQuoteTweetIndexes();
  console.log('✅ Quote tweet indexes created');

  await createNestedQuoteTweetIndexes();
  console.log('✅ Nested quote tweet indexes created');

  await createSecondOrderEngagementIndexes();
  console.log('✅ Second-order engagement indexes created');

  await createReplyIndexes();
  console.log('✅ Reply indexes created');

  console.log('🎉 All SOCAP indexes created.');
}

main()
  .then(async () => {
    await disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Failed to create SOCAP indexes:', err);
    await disconnect();
    process.exit(1);
  });

