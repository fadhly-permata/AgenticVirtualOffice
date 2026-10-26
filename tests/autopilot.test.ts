import { describe, expect, it } from 'vitest';
import { ACTIVITY_DURATION, durationFor, weightsFor } from '../src/agents/activities';
import { Autopilot, type AutopilotAgent } from '../src/agents/autopilot';
import { SPOT_MAP, spot, type Spot } from '../src/world/layout';

class FakeAgent implements AutopilotAgent {
  pinned = false;
  mode: 'walking' | 'settled' = 'settled';
  busyUntil = 0;
  assigned: Spot[] = [];

  constructor(
    readonly id: string,
    public spot: Spot,
  ) {}

  assign(next: Spot): void {
    this.spot = next;
    this.assigned.push(next);
    this.mode = 'walking';
  }
}

function makeRng(seed = 1): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

describe('activities', () => {
  it('keeps weights positive for every activity', () => {
    for (const night of [0, 0.5, 1]) {
      for (const weight of Object.values(weightsFor(night))) {
        expect(weight).toBeGreaterThan(0);
      }
    }
  });

  it('moves the office towards leisure at night', () => {
    const day = weightsFor(0);
    const night = weightsFor(1);
    expect(night.working).toBeLessThan(day.working);
    expect(night.gaming).toBeGreaterThan(day.gaming);
    expect(night.tv).toBeGreaterThan(day.tv);
  });

  it('keeps generated durations inside their range', () => {
    for (const [activity, [min, max]] of Object.entries(ACTIVITY_DURATION)) {
      const low = durationFor(activity as keyof typeof ACTIVITY_DURATION, () => 0);
      const high = durationFor(activity as keyof typeof ACTIVITY_DURATION, () => 0.999);
      expect(low).toBeGreaterThanOrEqual(min);
      expect(high).toBeLessThanOrEqual(max);
    }
  });
});

describe('autopilot', () => {
  it('assigns a free spot to every idle agent', () => {
    const agents = [
      new FakeAgent('a', spot('desk-1')),
      new FakeAgent('b', spot('desk-2')),
      new FakeAgent('c', spot('sofa-1')),
    ];
    const autopilot = new Autopilot(agents, makeRng(7));
    autopilot.update(100, 0);

    for (const agent of agents) {
      expect(agent.assigned).toHaveLength(1);
    }
    const targets = agents.map((agent) => agent.spot.id);
    expect(new Set(targets).size).toBe(targets.length);
    for (const target of targets) {
      expect(SPOT_MAP.has(target)).toBe(true);
    }
  });

  it('skips pinned, walking and busy agents', () => {
    const pinned = new FakeAgent('pinned', spot('desk-3'));
    pinned.pinned = true;
    const walking = new FakeAgent('walking', spot('sofa-2'));
    walking.mode = 'walking';
    const busy = new FakeAgent('busy', spot('coffee-1'));
    busy.busyUntil = 200;

    const autopilot = new Autopilot([pinned, walking, busy], makeRng(3));
    autopilot.update(100, 0.4);

    expect(pinned.assigned).toHaveLength(0);
    expect(walking.assigned).toHaveLength(0);
    expect(busy.assigned).toHaveLength(0);
  });

  it('never sends two agents to the same spot', () => {
    const agents = [
      new FakeAgent('a', spot('desk-1')),
      new FakeAgent('b', spot('desk-2')),
      new FakeAgent('c', spot('desk-3')),
      new FakeAgent('d', spot('desk-4')),
      new FakeAgent('e', spot('desk-5')),
    ];
    const autopilot = new Autopilot(agents, makeRng(11));

    for (let tick = 0; tick < 25; tick += 1) {
      autopilot.update(tick * 10, 0.2);
      for (const agent of agents) {
        agent.mode = 'settled';
        agent.busyUntil = 0;
      }
      const targets = agents.map((agent) => agent.spot.id);
      expect(new Set(targets).size).toBe(targets.length);
    }
  });
});
