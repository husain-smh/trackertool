/**
 * Performance metrics tracking
 */

interface MetricEntry {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  error?: string;
}

class MetricsTracker {
  private metrics: Map<string, MetricEntry> = new Map();

  /**
   * Start tracking an operation
   */
  start(operation: string, context?: Record<string, any>): string {
    const id = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.metrics.set(id, {
      operation,
      startTime: Date.now(),
      ...context,
    });
    return id;
  }

  /**
   * End tracking an operation
   */
  end(id: string, success: boolean = true, error?: string) {
    const entry = this.metrics.get(id);
    if (!entry) return;

    entry.endTime = Date.now();
    entry.duration = entry.endTime - entry.startTime;
    entry.success = success;
    if (error) entry.error = error;
  }

  /**
   * Get metrics for an operation type
   */
  getMetrics(operation: string): MetricEntry[] {
    return Array.from(this.metrics.values())
      .filter(m => m.operation === operation)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
  }

  /**
   * Get average duration for an operation
   */
  getAverageDuration(operation: string): number {
    const metrics = this.getMetrics(operation);
    if (metrics.length === 0) return 0;

    const durations = metrics
      .filter(m => m.duration !== undefined)
      .map(m => m.duration!);

    if (durations.length === 0) return 0;

    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }

  /**
   * Get success rate for an operation
   */
  getSuccessRate(operation: string): number {
    const metrics = this.getMetrics(operation);
    if (metrics.length === 0) return 0;

    const successful = metrics.filter(m => m.success === true).length;
    return (successful / metrics.length) * 100;
  }

  /**
   * Clear old metrics (keep last 1000 entries)
   */
  clearOldMetrics() {
    const allEntries = Array.from(this.metrics.entries())
      .sort((a, b) => (b[1].startTime || 0) - (a[1].startTime || 0))
      .slice(0, 1000);

    this.metrics.clear();
    allEntries.forEach(([id, entry]) => {
      this.metrics.set(id, entry);
    });
  }
}

export const metricsTracker = new MetricsTracker();

// Clear old metrics every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    metricsTracker.clearOldMetrics();
  }, 10 * 60 * 1000);
}

