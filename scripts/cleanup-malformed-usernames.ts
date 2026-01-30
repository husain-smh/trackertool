/**
 * Cleanup Script: Remove malformed usernames from database
 * 
 * This script identifies and removes entries where usernames contain commas
 * (which indicates they were added incorrectly as comma-separated strings)
 * 
 * Usage: npx tsx scripts/cleanup-malformed-usernames.ts
 */

import rankerDbPromise from '../src/lib/mongodb-ranker';

async function cleanupMalformedUsernames() {
  console.log('🔍 Starting cleanup of malformed usernames...\n');
  
  try {
    const db = await rankerDbPromise;
    const collection = db.collection('important_people');
    
    // Find all entries with commas in username (malformed entries)
    const malformedEntries = await collection.find({
      username: { $regex: /,/ }
    }).toArray();
    
    if (malformedEntries.length === 0) {
      console.log('✅ No malformed entries found. Database is clean!');
      process.exit(0);
    }
    
    console.log(`Found ${malformedEntries.length} malformed entry(ies):\n`);
    
    malformedEntries.forEach((entry, index) => {
      console.log(`${index + 1}. Username: "${entry.username}"`);
      console.log(`   Created: ${entry.created_at}`);
      console.log(`   Last Synced: ${entry.last_synced || 'Never'}`);
      console.log(`   Following Count: ${entry.following_count}`);
      console.log('');
    });
    
    // Ask for confirmation (in a real scenario, you might want to use a prompt library)
    console.log('🗑️  Deleting malformed entries...\n');
    
    const result = await collection.deleteMany({
      username: { $regex: /,/ }
    });
    
    console.log(`✅ Successfully deleted ${result.deletedCount} malformed entry(ies)`);
    console.log('\n💡 Tip: You can now add these users individually or as comma-separated values using the Add Person feature.');
    
    // Show what usernames were in the malformed entries
    console.log('\n📝 Extracted usernames from deleted entries:');
    malformedEntries.forEach(entry => {
      const usernames = entry.username.split(',').map((u: string) => u.trim()).filter((u: string) => u.length > 0);
      console.log(`   - ${usernames.join(', ')}`);
    });
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

// Run the cleanup
cleanupMalformedUsernames();

