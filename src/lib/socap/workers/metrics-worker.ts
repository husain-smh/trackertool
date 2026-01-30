import { BaseWorker } from './base-worker';
import { Job } from '../job-queue';
import { WorkerState } from '../../models/socap/worker-state';
import { fetchTweetMetrics } from '../../external-api';
import { updateTweetMetrics, getTweetMetrics } from '../../models/socap/tweets';
import { updateWorkerState } from '../../models/socap/worker-state';

/**
 * Metrics Worker
 * Fetches tweet metrics and calculates deltas
 */
export class MetricsWorker extends BaseWorker {
  protected async processJob(job: Job, _state: WorkerState): Promise<void> {
    // Mark state as intentionally unused; kept for interface compatibility
    void _state;
    const tweetId = job.tweet_id;
    
    try {
      // Fetch current metrics from API
      const currentMetrics = await fetchTweetMetrics(tweetId);
      
      // Get last stored baseline
      const lastMetrics = await getTweetMetrics(tweetId);
      
      // Calculate delta (if we have baseline)
      if (lastMetrics) {
        const delta = {
          likes: currentMetrics.likeCount - lastMetrics.likeCount,
          retweets: currentMetrics.retweetCount - lastMetrics.retweetCount,
          quotes: currentMetrics.quoteCount - lastMetrics.quoteCount,
          replies: currentMetrics.replyCount - lastMetrics.replyCount,
          views: currentMetrics.viewCount - lastMetrics.viewCount,
          bookmarks: currentMetrics.bookmarkCount - lastMetrics.bookmarkCount,
        };
        
        console.log(`Metrics delta for tweet ${tweetId}:`, delta);
      }
      
      // Update stored metrics (new baseline)
      await updateTweetMetrics(tweetId, {
        likeCount: currentMetrics.likeCount,
        retweetCount: currentMetrics.retweetCount,
        quoteCount: currentMetrics.quoteCount,
        replyCount: currentMetrics.replyCount,
        viewCount: currentMetrics.viewCount,
        bookmarkCount: currentMetrics.bookmarkCount,
      });
      
      // Mark as successful
      await updateWorkerState(job.campaign_id, tweetId, 'metrics', {
        last_success: new Date(),
      });
      
      console.log(`Metrics updated for tweet ${tweetId}`);
    } catch (error) {
      // If rate limit or credit error, store current baseline before failing
      if (this.isRateLimitError(error) || this.isCreditError(error)) {
        // Try to get current metrics before error
        try {
          const currentMetrics = await fetchTweetMetrics(tweetId);
          await updateTweetMetrics(tweetId, {
            likeCount: currentMetrics.likeCount,
            retweetCount: currentMetrics.retweetCount,
            quoteCount: currentMetrics.quoteCount,
            replyCount: currentMetrics.replyCount,
            viewCount: currentMetrics.viewCount,
            bookmarkCount: currentMetrics.bookmarkCount,
          });
        } catch {
          // If we can't fetch, that's okay - we'll retry later
        }
      }
      
      throw error; // Re-throw to let base worker handle it
    }
  }
  
  /**
   * Check if error is a credit exhaustion error
   */
  protected isCreditError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.message.includes('credit') ||
        error.message.includes('402') ||
        error.message.includes('CREDITS_EXHAUSTED')
      );
    }
    return false;
  }
}

