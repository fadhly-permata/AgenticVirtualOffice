import { randRange } from '../core/math';
import type { ActivityId } from '../world/layout';

export const ACTIVITIES: ActivityId[] = ['working', 'coffee', 'meeting', 'gaming', 'tv', 'idle'];

export const ACTIVITY_LABEL: Record<ActivityId, string> = {
  working: 'Fokus kerja',
  coffee: 'Ngopi',
  meeting: 'Meeting',
  gaming: 'Main game',
  tv: 'Nonton TV',
  idle: 'Istirahat',
};

/** Min/max stay duration in seconds. */
export const ACTIVITY_DURATION: Record<ActivityId, [number, number]> = {
  working: [34, 72],
  coffee: [18, 30],
  meeting: [28, 50],
  gaming: [24, 44],
  tv: [22, 38],
  idle: [10, 20],
};

/**
 * Relative likelihood of each activity. Office life shifts towards the lounge
 * once it gets dark.
 */
export function weightsFor(night: number): Record<ActivityId, number> {
  const n = Math.min(1, Math.max(0, night));
  return {
    working: 0.52 * (1 - 0.55 * n),
    coffee: 0.13,
    meeting: 0.12 * (1 - 0.45 * n),
    gaming: 0.07 + 0.16 * n,
    tv: 0.06 + 0.12 * n,
    idle: 0.09 + 0.05 * n,
  };
}

export function durationFor(activity: ActivityId, rng: () => number = Math.random): number {
  const [min, max] = ACTIVITY_DURATION[activity];
  return randRange(rng, min, max);
}
