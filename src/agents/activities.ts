import { t } from '../i18n';
import { randRange } from '../core/math';
import type { ActivityId } from '../world/layout';

export const ACTIVITIES: ActivityId[] = [
  'working',
  'coffee',
  'meeting',
  'gaming',
  'tv',
  'chatting',
  'idle',
];

/** Kunci i18n per aktivitas; labelnya dibaca ulang lewat `t()` setiap diambil. */
const ACTIVITY_KEYS: Record<ActivityId, string> = {
  working: 'office.working',
  coffee: 'office.coffee',
  meeting: 'office.meeting',
  gaming: 'office.gaming',
  tv: 'office.tv',
  chatting: 'office.chatting',
  idle: 'office.idle',
};

/**
 * Bentuk ekspor tidak berubah (`Record<ActivityId, string>`), jadi pemanggil lama
 * seperti `src/api.ts` dan HUD tetap pakai kurung siku. Proxy-nya menghitung ulang
 * lewat `t()` saat dibaca, sehingga ganti bahasa ikut tanpa muat ulang.
 */
export const ACTIVITY_LABEL: Record<ActivityId, string> = new Proxy(ACTIVITY_KEYS, {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(target, prop)) {
      return t(target[prop as ActivityId]);
    }
    return Reflect.get(target, prop, receiver);
  },
});

/** Min/max stay duration in seconds. */
export const ACTIVITY_DURATION: Record<ActivityId, [number, number]> = {
  working: [34, 72],
  coffee: [18, 30],
  meeting: [28, 50],
  gaming: [24, 44],
  tv: [22, 38],
  chatting: [16, 34],
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
    chatting: 0.15,
    idle: 0.09 + 0.05 * n,
  };
}

/** 'live' means a real tool drives the floor; 'demo' means the office is only a show. */
export type FloorMode = 'demo' | 'live';

export function durationFor(activity: ActivityId, rng: () => number = Math.random): number {
  const [min, max] = ACTIVITY_DURATION[activity];
  return randRange(rng, min, max);
}
