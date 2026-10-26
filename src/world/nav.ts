import type { Vec2 } from './layout';

interface Edge {
  to: string;
  cost: number;
}

/** Weighted, undirected navigation graph used by the agents. */
export class NavGraph {
  private readonly nodes = new Map<string, Vec2>();
  private readonly edges = new Map<string, Edge[]>();

  add(id: string, position: Vec2): void {
    if (this.nodes.has(id)) throw new Error(`Duplicate nav node "${id}"`);
    this.nodes.set(id, { ...position });
    this.edges.set(id, []);
  }

  connect(a: string, b: string): void {
    const pa = this.position(a);
    const pb = this.position(b);
    const cost = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    this.neighbors(a).push({ to: b, cost });
    this.neighbors(b).push({ to: a, cost });
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  get size(): number {
    return this.nodes.size;
  }

  position(id: string): Vec2 {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown nav node "${id}"`);
    return node;
  }

  /** Closest node to a world position, used when an agent is mid-walk. */
  nearest(position: Vec2): string {
    let bestId = '';
    let best = Number.POSITIVE_INFINITY;
    for (const [id, node] of this.nodes) {
      const d = (node.x - position.x) ** 2 + (node.z - position.z) ** 2;
      if (d < best) {
        best = d;
        bestId = id;
      }
    }
    if (!bestId) throw new Error('Navigation graph is empty');
    return bestId;
  }

  neighbors(id: string): Edge[] {
    const list = this.edges.get(id);
    if (!list) throw new Error(`Unknown nav node "${id}"`);
    return list;
  }

  /** Dijkstra path including both endpoints. Empty array when unreachable. */
  findPath(start: string, goal: string): string[] {
    if (!this.nodes.has(start) || !this.nodes.has(goal)) return [];
    if (start === goal) return [start];

    const dist = new Map<string, number>([[start, 0]]);
    const previous = new Map<string, string>();
    const open = new Set<string>([start]);

    while (open.size > 0) {
      let current = '';
      let best = Number.POSITIVE_INFINITY;
      for (const id of open) {
        const d = dist.get(id) ?? Number.POSITIVE_INFINITY;
        if (d < best) {
          best = d;
          current = id;
        }
      }
      if (current === goal) break;
      open.delete(current);

      for (const edge of this.neighbors(current)) {
        const next = best + edge.cost;
        if (next < (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
          dist.set(edge.to, next);
          previous.set(edge.to, current);
          open.add(edge.to);
        }
      }
    }

    if (!previous.has(goal)) return [];
    const path: string[] = [goal];
    let cursor = goal;
    while (cursor !== start) {
      const before = previous.get(cursor);
      if (!before) return [];
      cursor = before;
      path.unshift(cursor);
    }
    return path;
  }

  pathPoints(start: string, goal: string): Vec2[] {
    return this.findPath(start, goal).map((id) => this.position(id));
  }
}
