/**
 * Shared utility functions for SOCAP models
 */

/**
 * Round timestamp to the nearest hour
 */
export function roundToHour(timestamp: Date): Date {
  const rounded = new Date(timestamp);
  rounded.setMinutes(0, 0, 0);
  return rounded;
}

