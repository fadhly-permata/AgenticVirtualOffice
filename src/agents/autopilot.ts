import { type ActivityId, type Spot, spotsFor } from '../world/layout';
import { ACTIVITIES, durationFor, FREE_TIME_POOL, type FloorMode, weightsFor } from './activities';

export interface AutopilotAgent {
  id: string;
  pinned: boolean;
  mode: 'walking' | 'settled';
  spot: Spot;
  busyUntil: number;
  assign(spot: Spot, stayFor: number): void;
}

/**
 * Chooses a new activity for every agent whose stay expired. Activity
 * likelihood shifts with the simulated time of day. In live mode the pool is
 * limited to the common areas, so a free agent never pretends to work.
 */
export class Autopilot {
  private mode: FloorMode = 'demo';

  constructor(
    private readonly agents: AutopilotAgent[],
    private readonly rng: () => number = Math.random,
  ) {}

  get floorMode(): FloorMode {
    return this.mode;
  }

  setFloorMode(mode: FloorMode): void {
    this.mode = mode;
  }

  update(now: number, night: number): void {
    const taken = new Set(this.agents.map((agent) => agent.spot.id));

    for (const agent of this.agents) {
      if (agent.pinned || agent.mode === 'walking' || now < agent.busyUntil) continue;

      const next = this.pick(agent, taken, night);
      if (!next) {
        agent.busyUntil = now + 6;
        continue;
      }

      taken.delete(agent.spot.id);
      taken.add(next.id);
      agent.assign(next, durationFor(next.activity, this.rng));
    }
  }

  private pick(agent: AutopilotAgent, taken: Set<string>, night: number): Spot | null {
    const weights = weightsFor(night);
    const allowed = new Set(FREE_TIME_POOL[this.mode]);
    const candidates = ACTIVITIES.filter(
      (activity) =>
        allowed.has(activity) &&
        activity !== agent.spot.activity &&
        spotsFor(activity).some((spot) => !taken.has(spot.id)),
    );
    if (candidates.length === 0) return null;

    const total = candidates.reduce((sum, activity) => sum + weights[activity], 0);
    let roll = this.rng() * total;
    let chosen: ActivityId = candidates[candidates.length - 1];
    for (const activity of candidates) {
      roll -= weights[activity];
      if (roll <= 0) {
        chosen = activity;
        break;
      }
    }

    const pool = spotsFor(chosen).filter((spot) => !taken.has(spot.id));
    const picked = pool[Math.floor(this.rng() * pool.length)];
    return picked ?? pool[0] ?? null;
  }
}
