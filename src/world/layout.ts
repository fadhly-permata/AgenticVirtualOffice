import { NavGraph } from './nav';

export type RoomId = 'workspace' | 'meeting' | 'pantry' | 'lounge';
export type ActivityId = 'working' | 'meeting' | 'coffee' | 'gaming' | 'tv' | 'idle';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export const OFFICE_WIDTH = 26;
export const OFFICE_DEPTH = 21;
export const WALL_HEIGHT = 4.2;
export const PARTITION_HEIGHT = 2.9;

export const ROOM_LABEL: Record<RoomId, string> = {
  workspace: 'Ruang Kerja',
  meeting: 'Ruang Meeting',
  pantry: 'Pantry',
  lounge: 'Ruang Santai',
};

export const ROOMS: Record<RoomId, Rect> = {
  workspace: { x: 0, z: 0, w: 13, d: 10.5 },
  meeting: { x: 13, z: 0, w: 13, d: 10.5 },
  pantry: { x: 0, z: 10.5, w: 13, d: 10.5 },
  lounge: { x: 13, z: 10.5, w: 13, d: 10.5 },
};

export function roomAt(x: number, z: number): RoomId {
  if (z < 10.5) return x < 13 ? 'workspace' : 'meeting';
  return x < 13 ? 'pantry' : 'lounge';
}

export interface PartitionGap {
  from: number;
  to: number;
}

/** Interior walls. `at` is the fixed coordinate, `from`/`to` run along the other axis. */
export interface Partition {
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  gaps: PartitionGap[];
  style: 'glass' | 'solid';
}

export const PARTITIONS: Partition[] = [
  { axis: 'x', at: 13, from: 0, to: 10.5, gaps: [{ from: 6.8, to: 8.6 }], style: 'glass' },
  { axis: 'x', at: 13, from: 10.5, to: 21, gaps: [{ from: 18.2, to: 20.0 }], style: 'solid' },
  { axis: 'z', at: 10.5, from: 0, to: 13, gaps: [{ from: 4.4, to: 6.2 }], style: 'glass' },
  { axis: 'z', at: 10.5, from: 13, to: 26, gaps: [{ from: 14.8, to: 16.6 }], style: 'solid' },
];

export interface Spot {
  id: string;
  label: string;
  activity: ActivityId;
  room: RoomId;
  x: number;
  z: number;
  /** Y rotation so the character faces the focus of the activity. */
  facing: number;
  /** Seat height, 0 when the agent stays standing. */
  seatHeight: number;
  /** Navigation node used to reach this spot (generated, equals `s:<id>`). */
  node: string;
}

interface SpotDef extends Omit<Spot, 'node' | 'room'> {}

const HALF_PI = Math.PI / 2;
const NORTH = Math.PI; // facing -z

/** Desk row and where its chairs sit, shared with the furniture builder. */
export const DESK_X = [2.1, 4.35, 6.6, 8.85, 11.1];
export const DESK_Z = 3.6;
export const DESK_SEAT_Z = 4.45;

const SPOT_DEFS: SpotDef[] = [
  // Workspace: five desks facing the back wall, chairs towards the camera.
  ...DESK_X.map((x, i) => ({
    id: `desk-${i + 1}`,
    label: `Meja ${i + 1}`,
    activity: 'working' as const,
    x,
    z: DESK_SEAT_Z,
    facing: NORTH,
    seatHeight: 0.52,
  })),
  {
    id: 'desk-window',
    label: 'Jendela',
    activity: 'idle',
    x: 0.9,
    z: 8.4,
    facing: -HALF_PI,
    seatHeight: 0,
  },

  // Meeting room: three chairs on each long side.
  ...[17.2, 19.5, 21.8].map((x, i) => ({
    id: `meet-n${i + 1}`,
    label: `Meeting utara ${i + 1}`,
    activity: 'meeting' as const,
    x,
    z: 3.05,
    facing: 0,
    seatHeight: 0.52,
  })),
  ...[17.2, 19.5, 21.8].map((x, i) => ({
    id: `meet-s${i + 1}`,
    label: `Meeting selatan ${i + 1}`,
    activity: 'meeting' as const,
    x,
    z: 6.15,
    facing: NORTH,
    seatHeight: 0.52,
  })),
  {
    id: 'meet-window',
    label: 'Jendela meeting',
    activity: 'idle',
    x: 15.2,
    z: 1.4,
    facing: NORTH,
    seatHeight: 0,
  },

  // Pantry: two spots at the counter, three stools at the round table.
  {
    id: 'coffee-1',
    label: 'Coffee machine',
    activity: 'coffee',
    x: 1.5,
    z: 13.4,
    facing: -HALF_PI,
    seatHeight: 0,
  },
  {
    id: 'coffee-2',
    label: 'Coffee machine',
    activity: 'coffee',
    x: 1.5,
    z: 15.2,
    facing: -HALF_PI,
    seatHeight: 0,
  },
  {
    id: 'coffee-3',
    label: 'Meja pantry',
    activity: 'coffee',
    x: 5.5,
    z: 15.8,
    facing: HALF_PI,
    seatHeight: 0.7,
  },
  {
    id: 'coffee-4',
    label: 'Meja pantry',
    activity: 'coffee',
    x: 8.9,
    z: 15.8,
    facing: -HALF_PI,
    seatHeight: 0.7,
  },
  {
    id: 'coffee-5',
    label: 'Meja pantry',
    activity: 'coffee',
    x: 7.2,
    z: 17.5,
    facing: NORTH,
    seatHeight: 0.7,
  },
  {
    id: 'pantry-water',
    label: 'Dispenser',
    activity: 'idle',
    x: 1.7,
    z: 17.6,
    facing: -HALF_PI,
    seatHeight: 0,
  },

  // Lounge: sofa, bean bag, plant corner.
  ...[17.4, 19.4, 21.4].map((x, i) => ({
    id: `sofa-${i + 1}`,
    label: `Sofa ${i + 1}`,
    activity: 'tv' as const,
    x,
    z: 18.0,
    facing: NORTH,
    seatHeight: 0.58,
  })),
  {
    id: 'beanbag',
    label: 'Bean bag',
    activity: 'gaming',
    x: 23.8,
    z: 16.8,
    facing: NORTH,
    seatHeight: 0.5,
  },
  {
    id: 'lounge-plant',
    label: 'Tanaman',
    activity: 'idle',
    x: 24.3,
    z: 20.1,
    facing: -HALF_PI,
    seatHeight: 0,
  },
];

export const SPOTS: Spot[] = SPOT_DEFS.map((spot) => ({
  ...spot,
  room: roomAt(spot.x, spot.z),
  node: `s:${spot.id}`,
}));

export const SPOT_MAP: ReadonlyMap<string, Spot> = new Map(SPOTS.map((s) => [s.id, s]));

export function spot(id: string): Spot {
  const found = SPOT_MAP.get(id);
  if (!found) throw new Error(`Unknown spot "${id}"`);
  return found;
}

export function spotsFor(activity: ActivityId): Spot[] {
  return SPOTS.filter((s) => s.activity === activity);
}

/** Aisle / junction nodes that are not seats themselves. */
interface AisleNode extends Vec2 {
  id: string;
}

const AISLES: AisleNode[] = [
  // Workspace
  { id: 'ws-west', x: 1.6, z: 7.2 },
  { id: 'ws-mid', x: 6.6, z: 7.3 },
  { id: 'ws-hub', x: 9.6, z: 7.9 },
  { id: 'ws-door-a', x: 11.4, z: 7.5 },
  { id: 'ws-door-c', x: 5.3, z: 9.2 },
  // Meeting
  { id: 'mt-door-a', x: 14.3, z: 7.7 },
  { id: 'mt-door-d', x: 15.7, z: 9.2 },
  { id: 'mt-west', x: 14.9, z: 5.4 },
  { id: 'mt-nw', x: 16.0, z: 2.0 },
  { id: 'mt-north', x: 19.5, z: 2.0 },
  { id: 'mt-ne', x: 23.0, z: 2.0 },
  { id: 'mt-east', x: 23.7, z: 4.6 },
  { id: 'mt-se', x: 23.4, z: 7.4 },
  { id: 'mt-south', x: 19.5, z: 7.4 },
  // Pantry
  { id: 'pn-door-c', x: 5.3, z: 11.8 },
  { id: 'pn-north', x: 6.8, z: 12.0 },
  { id: 'pn-west', x: 3.2, z: 14.2 },
  { id: 'pn-coffee', x: 2.5, z: 14.3 },
  { id: 'pn-water', x: 2.9, z: 17.6 },
  { id: 'pn-south', x: 6.6, z: 19.0 },
  { id: 'pn-east', x: 10.6, z: 16.0 },
  { id: 'pn-door-b', x: 11.9, z: 19.1 },
  // Lounge
  { id: 'lg-door-d', x: 15.7, z: 11.7 },
  { id: 'lg-door-b', x: 14.3, z: 19.1 },
  { id: 'lg-north', x: 20.0, z: 12.0 },
  { id: 'lg-ne', x: 24.6, z: 12.0 },
  { id: 'lg-east', x: 24.6, z: 15.8 },
  { id: 'lg-se', x: 24.2, z: 19.4 },
  { id: 'lg-south', x: 19.5, z: 19.4 },
  { id: 'lg-sw', x: 15.0, z: 19.4 },
  { id: 'lg-west', x: 14.8, z: 15.8 },
  { id: 'lg-front-w', x: 17.6, z: 16.6 },
  { id: 'lg-front-e', x: 21.8, z: 16.6 },
];

export interface NavNodeData extends Vec2 {
  id: string;
}

export const NODES: NavNodeData[] = [
  ...AISLES,
  ...SPOTS.map((s) => ({ id: s.node, x: s.x, z: s.z })),
];

const s = (spotId: string) => `s:${spotId}`;

export const EDGES: [string, string][] = [
  // Workspace
  ['ws-west', 'ws-mid'],
  ['ws-west', s('desk-1')],
  ['ws-west', s('desk-window')],
  ['ws-mid', s('desk-1')],
  ['ws-mid', s('desk-2')],
  ['ws-mid', s('desk-3')],
  ['ws-mid', s('desk-4')],
  ['ws-mid', 'ws-hub'],
  ['ws-mid', 'ws-door-c'],
  ['ws-hub', s('desk-4')],
  ['ws-hub', s('desk-5')],
  ['ws-hub', 'ws-door-a'],
  ['ws-hub', 'ws-door-c'],
  ['ws-door-a', 'ws-door-c'],
  // Meeting
  ['mt-door-a', 'mt-west'],
  ['mt-door-a', 'mt-south'],
  ['mt-door-d', 'mt-west'],
  ['mt-door-d', 'mt-south'],
  ['mt-door-d', 'mt-se'],
  ['mt-west', 'mt-nw'],
  ['mt-nw', 'mt-north'],
  ['mt-nw', s('meet-n1')],
  ['mt-north', s('meet-n2')],
  ['mt-ne', s('meet-n3')],
  ['mt-north', 'mt-ne'],
  ['mt-ne', 'mt-east'],
  ['mt-east', 'mt-se'],
  ['mt-se', 'mt-south'],
  ['mt-se', s('meet-s3')],
  ['mt-south', s('meet-s1')],
  ['mt-south', s('meet-s2')],
  ['mt-nw', s('meet-window')],
  // Pantry
  ['pn-door-c', 'pn-north'],
  ['pn-door-c', 'pn-west'],
  ['pn-north', 'pn-west'],
  ['pn-north', 'pn-east'],
  ['pn-west', 'pn-coffee'],
  ['pn-coffee', s('coffee-1')],
  ['pn-coffee', s('coffee-2')],
  ['pn-coffee', 'pn-water'],
  ['pn-water', s('pantry-water')],
  ['pn-water', 'pn-south'],
  ['pn-south', 'pn-east'],
  ['pn-south', 'pn-door-b'],
  ['pn-east', 'pn-door-b'],
  ['pn-west', s('coffee-3')],
  ['pn-east', s('coffee-4')],
  ['pn-south', s('coffee-5')],
  // Lounge
  ['lg-door-d', 'lg-north'],
  ['lg-door-d', 'lg-west'],
  ['lg-north', 'lg-ne'],
  ['lg-ne', 'lg-east'],
  ['lg-east', s('beanbag')],
  ['lg-east', 'lg-se'],
  ['lg-se', s('lounge-plant')],
  ['lg-se', 'lg-south'],
  ['lg-south', 'lg-sw'],
  ['lg-sw', 'lg-door-b'],
  ['lg-sw', 'lg-west'],
  ['lg-west', 'lg-front-w'],
  ['lg-front-w', 'lg-front-e'],
  ['lg-front-w', s('sofa-1')],
  ['lg-front-w', s('sofa-2')],
  ['lg-front-e', s('sofa-3')],
  ['lg-front-e', s('beanbag')],
  // Doors between rooms
  ['ws-door-a', 'mt-door-a'],
  ['ws-door-c', 'pn-door-c'],
  ['mt-door-d', 'lg-door-d'],
  ['pn-door-b', 'lg-door-b'],
];

export function buildNavGraph(): NavGraph {
  const graph = new NavGraph();
  for (const node of NODES) graph.add(node.id, { x: node.x, z: node.z });
  for (const [a, b] of EDGES) graph.connect(a, b);
  return graph;
}
