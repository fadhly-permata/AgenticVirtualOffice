import { type ActivityId, isBreakRoom, type Spot, spotsFor } from '../world/layout';
import { ACTIVITIES, durationFor, type FloorMode, weightsFor } from './activities';

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
 * likelihood shifts with the simulated time of day. In live mode the desks and
 * the meeting table belong to running sessions, so free hands only ever land on
 * a spot in a break room.
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
      if (agent.pinned) continue;
      // Tujuan yang dipilih saat lantai masih demo bisa jadi terlarang sekarang.
      const stranded = agent.mode === 'walking' && !this.allowed(agent.spot);
      if (!stranded && (agent.mode === 'walking' || now < agent.busyUntil)) continue;

      taken.delete(agent.spot.id);
      const next = this.pick(agent, taken, night);
      if (!next) {
        taken.add(agent.spot.id);
        agent.busyUntil = now + 6;
        continue;
      }

      taken.add(next.id);
      agent.assign(next, durationFor(next.activity, this.rng));
    }
  }

  /** Whether a free agent may sit in, or walk towards, this spot. */
  private allowed(spot: Spot): boolean {
    return this.mode === 'demo' || isBreakRoom(spot);
  }

  private pick(agent: AutopilotAgent, taken: Set<string>, night: number): Spot | null {
    const weights = weightsFor(night);
    const pools = new Map<ActivityId, Spot[]>();
    for (const activity of ACTIVITIES) {
      if (activity === agent.spot.activity) continue;
      const free = spotsFor(activity).filter(
        (candidate) => !taken.has(candidate.id) && this.allowed(candidate),
      );
      if (free.length > 0) pools.set(activity, free);
    }
    if (pools.size === 0) return null;

    const candidates = [...pools.keys()];
    const total = candidates.reduce((sum, activity) => sum + weights[activity], 0);
    let roll = this.rng() * total;
    let chosen = candidates[candidates.length - 1]!;
    for (const activity of candidates) {
      roll -= weights[activity];
      if (roll <= 0) {
        chosen = activity;
        break;
      }
    }

    const pool = pools.get(chosen)!;
    return pool[Math.floor(this.rng() * pool.length)] ?? null;
  }
}
