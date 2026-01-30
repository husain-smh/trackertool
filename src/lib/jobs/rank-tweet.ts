import {
  getTweetById,
  getEngagersCollection,
  updateEngagerRanking,
  updateTweetStatus,
  updateTweetStatistics,
} from '../models/tweet-analysis';
import { getFollowingIndexCollection, FollowingIndexEntry } from '../models/ranker';

/**
 * Background job to rank all engagers for a tweet
 * Uses the existing following_index to calculate importance scores
 */
export async function rankTweetEngagers(tweet_id: string): Promise<void> {
  console.log(`🔄 Starting ranking job for tweet ${tweet_id}`);
  const startTime = Date.now();
  
  try {
    // Check if tweet exists
    const tweet = await getTweetById(tweet_id);
    if (!tweet) {
      throw new Error(`Tweet ${tweet_id} not found`);
    }
    
    // Get all engagers for this tweet
    const engagersCollection = await getEngagersCollection();
    const engagers = await engagersCollection.find({ tweet_id }).toArray();
    
    if (engagers.length === 0) {
      console.log(`⚠️ No engagers found for tweet ${tweet_id}`);
      await updateTweetStatus(tweet_id, 'completed');
      return;
    }
    
    console.log(`📊 Ranking ${engagers.length} engagers...`);
    
    // Get all user IDs to lookup
    const userIds = engagers.map(e => e.userId);
    
    // Lookup importance scores from following_index
    const followingIndexCollection = await getFollowingIndexCollection();
    const indexEntries = await followingIndexCollection
      .find({ followed_user_id: { $in: userIds } })
      .toArray();
    
    // Create lookup map
    const indexMap = new Map<string, FollowingIndexEntry>();
    indexEntries.forEach(entry => {
      indexMap.set(entry.followed_user_id, entry);
    });
    
    console.log(`✅ Found ${indexEntries.length} entries in following_index`);
    
    // Update each engager with their ranking data
    let updatedCount = 0;
    let withScoreCount = 0;
    
    for (const engager of engagers) {
      const indexEntry = indexMap.get(engager.userId);
      
      const importance_score = indexEntry?.importance_score || 0;
      const followed_by_usernames = indexEntry?.followed_by.map(f => f.username) || [];
      
      if (importance_score > 0) {
        withScoreCount++;
      }
      
      await updateEngagerRanking(
        tweet_id,
        engager.userId,
        importance_score,
        followed_by_usernames
      );
      
      updatedCount++;
      
      // Log progress every 50 engagers
      if (updatedCount % 50 === 0) {
        console.log(`   Progress: ${updatedCount}/${engagers.length} engagers ranked`);
      }
    }
    
    console.log(`✅ Updated ${updatedCount} engagers with ranking data`);
    console.log(`   ${withScoreCount} engagers have importance score > 0`);
    console.log(`   ${updatedCount - withScoreCount} engagers have no importance score`);
    
    // Update tweet statistics
    await updateTweetStatistics(tweet_id);
    
    // Mark tweet as completed
    await updateTweetStatus(tweet_id, 'completed');
    
    const duration = Date.now() - startTime;
    console.log(`✅ Ranking complete for tweet ${tweet_id} in ${duration}ms`);
    
  } catch (error) {
    console.error(`❌ Ranking failed for tweet ${tweet_id}:`, error);
    
    // Mark tweet as failed
    await updateTweetStatus(
      tweet_id,
      'failed',
      error instanceof Error ? error.message : 'Unknown error'
    );
    
    throw error;
  }
}

