import { describe, expect, it } from 'vitest';
import {
  AGENT_SEEDS,
  DEFAULT_AGENTS,
  MAX_AGENTS,
  MIN_AGENTS,
  clampAgentCount,
  parseAgentCount,
  startingState,
} from '../src/agents/seeds';
import { SPOT_MAP } from '../src/world/layout';

describe('agent roster', () => {
  it('has a unique agent for every supported slot', () => {
    expect(AGENT_SEEDS).toHaveLength(MAX_AGENTS);
    expect(new Set(AGENT_SEEDS.map((seed) => seed.id)).size).toBe(MAX_AGENTS);
    expect(new Set(AGENT_SEEDS.map((seed) => seed.name)).size).toBe(MAX_AGENTS);
  });

  it('clamps the requested count between min and max', () => {
    expect(clampAgentCount(0)).toBe(MIN_AGENTS);
    expect(clampAgentCount(6)).toBe(6);
    expect(clampAgentCount(MAX_AGENTS + 5)).toBe(MAX_AGENTS);
    expect(clampAgentCount(Number.NaN)).toBe(DEFAULT_AGENTS);
  });

  it('parses the query parameter with a safe fallback', () => {
    expect(parseAgentCount(null)).toBe(DEFAULT_AGENTS);
    expect(parseAgentCount('')).toBe(DEFAULT_AGENTS);
    expect(parseAgentCount('abc')).toBe(DEFAULT_AGENTS);
    expect(parseAgentCount('10')).toBe(10);
    expect(parseAgentCount('99')).toBe(MAX_AGENTS);
  });

  it('gives every agent a distinct, existing starting spot', () => {
    for (const count of [2, 6, 10, 15]) {
      const plan = startingState(count);
      expect(plan).toHaveLength(count);
      expect(new Set(plan.map((entry) => entry.seedIndex)).size).toBe(count);
      const spots = plan.map((entry) => entry.spot);
      expect(new Set(spots).size).toBe(count);
      for (const id of spots) expect(SPOT_MAP.has(id)).toBe(true);
    }
  });
});
