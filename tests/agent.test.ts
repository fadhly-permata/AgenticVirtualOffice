import { describe, expect, it } from 'vitest';
import { Agent } from '../src/agents/agent';
import { buildNavGraph, OFFICE_DEPTH, OFFICE_WIDTH, spot } from '../src/world/layout';

const seed = {
  id: 'tester',
  name: 'Tester',
  color: '#ffffff',
  look: { shirt: 0x336655, pants: 0x223344, skin: 0xddaa88, hair: 0x221a16 },
};

function runUntilSettled(agent: Agent, maxSeconds = 40): number {
  let now = 0;
  for (let frame = 0; frame < maxSeconds * 60 && agent.mode === 'walking'; frame += 1) {
    now += 1 / 60;
    agent.update(1 / 60, now);
    expect(agent.group.position.x).toBeGreaterThanOrEqual(-0.1);
    expect(agent.group.position.x).toBeLessThanOrEqual(OFFICE_WIDTH + 0.1);
    expect(agent.group.position.z).toBeGreaterThanOrEqual(-0.1);
    expect(agent.group.position.z).toBeLessThanOrEqual(OFFICE_DEPTH + 0.1);
  }
  return now;
}

describe('Agent', () => {
  it('walks from a desk to the pantry and settles there', () => {
    const nav = buildNavGraph();
    const agent = new Agent(seed, nav, spot('desk-1'), 5);
    const target = spot('coffee-1');

    agent.assign(target, 7);
    expect(agent.mode).toBe('walking');
    expect(agent.busyUntil).toBe(Number.POSITIVE_INFINITY);

    const now = runUntilSettled(agent);
    expect(agent.mode).toBe('settled');
    expect(agent.group.position.x).toBeCloseTo(target.x, 2);
    expect(agent.group.position.z).toBeCloseTo(target.z, 2);
    expect(agent.busyUntil).toBeCloseTo(now + 7, 3);
  });

  it('crosses rooms through the navigation graph', () => {
    const nav = buildNavGraph();
    const agent = new Agent(seed, nav, spot('desk-5'), 5);
    agent.assign(spot('sofa-1'), 4);
    runUntilSettled(agent);
    expect(agent.group.position.x).toBeCloseTo(17.4, 2);
    expect(agent.group.position.z).toBeCloseTo(18, 2);
  });

  it('can be released back to the autopilot', () => {
    const nav = buildNavGraph();
    const agent = new Agent(seed, nav, spot('desk-2'), 5);
    agent.pinned = true;
    agent.busyUntil = Number.POSITIVE_INFINITY;

    agent.release();
    expect(agent.pinned).toBe(false);
    expect(agent.busyUntil).toBe(0);
  });
});
