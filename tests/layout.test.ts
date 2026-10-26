import { describe, expect, it } from 'vitest';
import {
  buildNavGraph,
  EDGES,
  NODES,
  PARTITIONS,
  SPOTS,
  spotsFor,
  type Partition,
  type Vec2,
} from '../src/world/layout';

function crossingCoordinate(a: Vec2, b: Vec2, partition: Partition): number | null {
  if (partition.axis === 'x') {
    const da = a.x - partition.at;
    const db = b.x - partition.at;
    if (da * db >= 0) return null;
    const t = (partition.at - a.x) / (b.x - a.x);
    const z = a.z + (b.z - a.z) * t;
    return z >= partition.from && z <= partition.to ? z : null;
  }
  const da = a.z - partition.at;
  const db = b.z - partition.at;
  if (da * db >= 0) return null;
  const t = (partition.at - a.z) / (b.z - a.z);
  const x = a.x + (b.x - a.x) * t;
  return x >= partition.from && x <= partition.to ? x : null;
}

describe('office layout', () => {
  it('has unique spot ids', () => {
    const ids = SPOTS.map((spot) => spot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has spots for every activity', () => {
    for (const activity of ['working', 'meeting', 'coffee', 'gaming', 'tv', 'idle'] as const) {
      expect(spotsFor(activity).length).toBeGreaterThan(0);
    }
  });

  it('has ten desks in two rows of five', () => {
    const desks = spotsFor('working');
    expect(desks).toHaveLength(10);
    const rows = new Set(desks.map((spot) => spot.z));
    expect(rows.size).toBe(2);
    for (const z of rows) {
      expect(desks.filter((spot) => spot.z === z)).toHaveLength(5);
    }
  });

  it('has unique navigation node ids and valid edge endpoints', () => {
    const ids = NODES.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const known = new Set(ids);
    for (const [a, b] of EDGES) {
      expect(known.has(a), `missing node ${a}`).toBe(true);
      expect(known.has(b), `missing node ${b}`).toBe(true);
    }
  });

  it('keeps every nav edge out of solid partitions', () => {
    const graph = buildNavGraph();
    for (const [a, b] of EDGES) {
      const pa = graph.position(a);
      const pb = graph.position(b);
      for (const partition of PARTITIONS) {
        const at = crossingCoordinate(pa, pb, partition);
        if (at === null) continue;
        const throughGap = partition.gaps.some((gap) => at > gap.from && at < gap.to);
        expect(
          throughGap,
          `edge ${a} -> ${b} crosses ${partition.axis}=${partition.at} at ${at.toFixed(2)} outside a door`,
        ).toBe(true);
      }
    }
  });

  it('reaches every spot from the workspace', () => {
    const graph = buildNavGraph();
    for (const spot of SPOTS) {
      const path = graph.findPath('s:desk-1', spot.node);
      expect(path.length, `no path to ${spot.id}`).toBeGreaterThan(0);
      expect(path[0]).toBe('s:desk-1');
      expect(path[path.length - 1]).toBe(spot.node);
    }
  });

  it('places each spot exactly on its own navigation node', () => {
    const graph = buildNavGraph();
    for (const spot of SPOTS) {
      const node = graph.position(spot.node);
      expect(node.x).toBeCloseTo(spot.x, 5);
      expect(node.z).toBeCloseTo(spot.z, 5);
    }
  });
});
