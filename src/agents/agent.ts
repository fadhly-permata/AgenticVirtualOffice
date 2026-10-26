import * as THREE from 'three';
import { dampAngle } from '../core/math';
import type { Spot, Vec2 } from '../world/layout';
import type { NavGraph } from '../world/nav';
import { createCharacter, type AgentLook, type CharacterRig } from './character';

export interface AgentSeed {
  id: string;
  name: string;
  color: string;
  look: AgentLook;
}

interface Pose {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  armL: number;
  armR: number;
  armZL: number;
  armZR: number;
  bodyY: number;
  lean: number;
  headX: number;
  headY: number;
}

const POSE_KEYS: (keyof Pose)[] = [
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'armL',
  'armR',
  'armZL',
  'armZR',
  'bodyY',
  'lean',
  'headX',
  'headY',
];

function makePose(): Pose {
  return {
    hipL: 0,
    hipR: 0,
    kneeL: 0,
    kneeR: 0,
    armL: 0,
    armR: 0,
    armZL: 0.06,
    armZR: -0.06,
    bodyY: 0,
    lean: 0,
    headX: 0,
    headY: 0,
  };
}

/**
 * One office employee. Walks the nav graph to spots and plays a small
 * procedural animation for whatever activity the spot represents.
 *
 * `pinned` agents ignore the autopilot until released, which is the hook used
 * by the external OpenCode bridge.
 */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly group = new THREE.Group();

  pinned = false;
  mode: 'walking' | 'settled' = 'settled';
  spot: Spot;
  busyUntil: number;
  onSettled?: (agent: Agent) => void;

  private readonly nav: NavGraph;
  private readonly rig: CharacterRig;
  private readonly speed = 3.05;
  private path: Vec2[] = [];
  private stayFor: number;
  private facing: number;
  private targetFacing: number;
  private walkPhase = 0;
  private elapsed = 0;
  private pose: Pose;
  private target: Pose;

  constructor(seed: AgentSeed, nav: NavGraph, start: Spot, holdFor = 24) {
    this.id = seed.id;
    this.name = seed.name;
    this.color = seed.color;
    this.nav = nav;
    this.spot = start;
    this.stayFor = holdFor;
    this.busyUntil = holdFor;
    this.facing = start.facing;
    this.targetFacing = start.facing;

    this.group.position.set(start.x, 0, start.z);
    this.group.rotation.y = start.facing;
    this.rig = createCharacter(seed.look);
    this.group.add(this.rig.group);

    this.pose = makePose();
    this.target = makePose();
    this.computeTarget();
    for (const key of POSE_KEYS) this.pose[key] = this.target[key];
    this.applyPose();
  }

  get activity() {
    return this.spot.activity;
  }

  /** Detach from the autopilot and let it resume later. */
  release(): void {
    this.pinned = false;
    this.busyUntil = 0;
  }

  assign(next: Spot, stayFor: number): void {
    const fromNode = this.nav.nearest({ x: this.group.position.x, z: this.group.position.z });
    this.spot = next;
    this.stayFor = stayFor;
    this.mode = 'walking';
    this.busyUntil = Number.POSITIVE_INFINITY;

    const ids = this.nav.findPath(fromNode, next.node);
    const points: Vec2[] = ids.map((id) => ({ ...this.nav.position(id) }));
    if (points.length === 0) {
      points.push({ x: this.group.position.x, z: this.group.position.z });
    }
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - next.x, last.z - next.z) > 0.01) {
      points.push({ x: next.x, z: next.z });
    }
    this.path = points;

    const dx = next.x - this.group.position.x;
    const dz = next.z - this.group.position.z;
    if (Math.hypot(dx, dz) > 0.05) this.targetFacing = Math.atan2(dx, dz);
  }

  update(dt: number, now: number): void {
    if (this.mode === 'walking') this.step(dt, now);
    this.elapsed += dt;
    this.computeTarget();

    const k = 1 - Math.exp(-11 * dt);
    for (const key of POSE_KEYS) {
      this.pose[key] += (this.target[key] - this.pose[key]) * k;
    }
    this.applyPose();
  }

  private step(dt: number, now: number): void {
    const point = this.path[0];
    if (!point) {
      this.arrive(now);
      return;
    }

    const dx = point.x - this.group.position.x;
    const dz = point.z - this.group.position.z;
    const distance = Math.hypot(dx, dz);
    const travel = this.speed * dt;

    if (distance <= 0.03 || distance <= travel) {
      this.group.position.set(point.x, 0, point.z);
      this.path.shift();
      if (this.path.length === 0) {
        this.arrive(now);
        return;
      }
    } else {
      this.group.position.x += (dx / distance) * travel;
      this.group.position.z += (dz / distance) * travel;
      this.targetFacing = Math.atan2(dx, dz);
    }

    this.walkPhase += dt * 9.5;
    this.facing = dampAngle(this.facing, this.targetFacing, 14, dt);
    this.group.rotation.y = this.facing;
  }

  private arrive(now: number): void {
    this.mode = 'settled';
    this.path = [];
    this.group.position.set(this.spot.x, 0, this.spot.z);
    this.facing = this.spot.facing;
    this.targetFacing = this.facing;
    this.group.rotation.y = this.facing;
    this.busyUntil = now + this.stayFor;
    this.onSettled?.(this);
  }

  private computeTarget(): void {
    const t = this.target;
    const time = this.elapsed;

    if (this.mode === 'walking') {
      const swing = Math.sin(this.walkPhase);
      t.hipL = swing * 0.55;
      t.hipR = -swing * 0.55;
      t.kneeL = Math.max(0, -swing) * 0.8;
      t.kneeR = Math.max(0, swing) * 0.8;
      t.armL = -swing * 0.5;
      t.armR = swing * 0.5;
      t.armZL = 0.08;
      t.armZR = -0.08;
      t.bodyY = Math.abs(Math.cos(this.walkPhase)) * 0.03;
      t.lean = 0.06;
      t.headX = 0;
      t.headY = 0;
      return;
    }

    const seated = this.spot.seatHeight > 0;
    t.hipL = seated ? -1.4 : 0;
    t.hipR = seated ? -1.4 : 0;
    t.kneeL = seated ? 1.35 : 0;
    t.kneeR = seated ? 1.35 : 0;
    t.bodyY = seated ? this.spot.seatHeight - this.rig.hipHeight : 0;
    t.lean = 0;
    t.headX = 0;
    t.headY = 0;
    t.armZL = 0.06;
    t.armZR = -0.06;

    switch (this.spot.activity) {
      case 'working': {
        const typing = Math.sin(time * 9) * 0.09 + Math.sin(time * 4.3) * 0.05;
        t.armL = -1.02 + typing;
        t.armR = -1.02 - typing;
        t.lean = 0.1;
        t.headX = 0.16;
        break;
      }
      case 'meeting': {
        t.armL = -0.82 + Math.sin(time * 1.6) * 0.06;
        t.armR = -0.88;
        t.headX = 0.04;
        t.headY = Math.sin(time * 0.9) * 0.22;
        break;
      }
      case 'coffee': {
        if (seated) {
          t.armL = -0.7;
          t.armR = -0.8;
        } else {
          const sip = Math.max(0, Math.sin(time * 0.7));
          t.armR = -1.15 - sip * 0.85;
          t.armL = -0.15;
        }
        t.headX = 0.06;
        t.headY = Math.sin(time * 0.5) * 0.15;
        break;
      }
      case 'gaming': {
        const mash = Math.sin(time * 13) * 0.06;
        t.armL = -0.95 + mash;
        t.armR = -0.95 - mash;
        t.armZL = 0.16;
        t.armZR = -0.16;
        t.lean = 0.12;
        t.headX = 0.08;
        t.headY = Math.sin(time * 3.1) * 0.05;
        break;
      }
      case 'tv': {
        t.armL = -0.45;
        t.armR = -0.45;
        t.lean = -0.06;
        t.headX = 0.05;
        t.headY = Math.sin(time * 0.55) * 0.16;
        break;
      }
      case 'idle':
      default: {
        t.armL = 0.04 + Math.sin(time * 1.4) * 0.04;
        t.armR = 0.04 - Math.sin(time * 1.4) * 0.04;
        t.headX = -0.04;
        t.headY = Math.sin(time * 0.4) * 0.25;
        break;
      }
    }
  }

  private applyPose(): void {
    const rig = this.rig;
    rig.body.position.y = this.pose.bodyY;
    rig.legL.rotation.x = this.pose.hipL;
    rig.legR.rotation.x = this.pose.hipR;
    rig.shinL.rotation.x = this.pose.kneeL;
    rig.shinR.rotation.x = this.pose.kneeR;
    rig.upper.rotation.x = this.pose.lean;
    rig.armL.rotation.x = this.pose.armL;
    rig.armR.rotation.x = this.pose.armR;
    rig.armL.rotation.z = this.pose.armZL;
    rig.armR.rotation.z = this.pose.armZR;
    rig.head.rotation.x = this.pose.headX;
    rig.head.rotation.y = this.pose.headY;

    const settled = this.mode === 'settled';
    rig.mug.visible = settled && this.spot.activity === 'coffee';
    rig.gamepad.visible = settled && this.spot.activity === 'gaming';
  }
}
