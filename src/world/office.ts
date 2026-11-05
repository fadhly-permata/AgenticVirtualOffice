import * as THREE from 'three';
import type { DayCycle } from '../core/dayNight';
import { smoothstep } from '../core/math';
import { C, mat } from '../core/palette';
import {
  fabricWeave,
  glowSprite,
  grassNoise,
  idleScreenTexture,
  plasterNoise,
  softShadow,
  tvSlides as createTvSlides,
  tvStaticFrames,
  woodGrain,
  type TvSlide,
} from '../core/textures';
import { TypingScreen } from '../core/typing';
import { ball, box, cyl, plane, rbox } from './kit';
import {
  DESK_ROW_Z,
  DESK_SEAT_OFFSET,
  DESK_X,
  OFFICE_DEPTH,
  OFFICE_WIDTH,
  PARTITION_HEIGHT,
  ROOMS,
  WALL_HEIGHT,
  type Partition,
  type Rect,
  type RoomId,
} from './layout';

interface ScreenRef {
  material: THREE.MeshStandardMaterial;
  spotId: string;
  typing: TypingScreen;
  idle: THREE.DataTexture;
  active: boolean;
}

interface LampRef {
  light: THREE.PointLight;
  strength: number;
}

interface SteamPuff {
  mesh: THREE.Mesh;
  phase: number;
  baseX: number;
  baseY: number;
  baseZ: number;
}

interface PlantRef {
  node: THREE.Object3D;
  phase: number;
}

/** Bulb halo that brightens as the room gets darker. */
interface GlowRef {
  material: THREE.SpriteMaterial;
}

/** Where a bird can settle: a tree crown or a patch of lawn. */
interface PerchSpot {
  x: number;
  y: number;
  z: number;
  /** Lawn perches let the bird hop, peck and get chased by the pets. */
  ground: boolean;
}

/** One bird: crossing the garden, resting in a tree, or foraging on the lawn. */
interface BirdRef {
  group: THREE.Group;
  wings: THREE.Object3D[];
  state: 'fly' | 'perch';
  /** Air waypoint while cruising; the perch itself while landing. */
  target: THREE.Vector3;
  perch: PerchSpot | null;
  speed: number;
  heading: number;
  timer: number;
  phase: number;
  rng: () => number;
  /** Foraging hop tween: -1 when standing still. */
  hopT: number;
  hopTimer: number;
  hopFrom: THREE.Vector3;
  hopTo: THREE.Vector3;
}

/** One pet: idling, wandering, or caught in a chase around the pen. */
interface PetRef {
  group: THREE.Group;
  kind: 'cat' | 'dog';
  legs: THREE.Object3D[];
  tail: THREE.Object3D;
  /** Ground target in world XZ; the chasing pair keeps retargeting each frame. */
  target: THREE.Vector2;
  state: 'idle' | 'wander' | 'chase' | 'flee';
  /** Set when this pet is stalking a lawn bird instead of the other pet. */
  prey: BirdRef | null;
  timer: number;
  cooldown: number;
  heading: number;
  stride: number;
  phase: number;
  rng: () => number;
}

/** Window band shared by the glass panes and the wall cut-outs. */
const WINDOW_CENTER_Y = 2.32;
const WINDOW_HEIGHT = 1.95;
const WINDOW_OPEN_Y0 = 1.3;
const WINDOW_OPEN_Y1 = 3.34;

/** How far the garden terrace reaches beyond the wall line, and its surface height. */
const GARDEN_MARGIN = 15.2;
const GARDEN_TOP = -0.42;

/** Sun disc sits on the light's own ray, far enough to read as sky. */
const SUN_DISTANCE = 88;
const SUN_RADIUS = 1.5;

/** Fenced corner paddock on the empty front-right lawn. */
const PEN = { x0: 29.4, x1: 37.8, z0: 25.7, z1: 31.3 };
/** Doghouse footprint inside the pen, kept clear by wandering pets. */
const HOUSE = { x0: 35.6, x1: 37.45, z0: 29.45, z1: 30.95 };

const FLOOR_COLOR: Record<RoomId, number> = {
  workspace: C.floorWorkspace,
  meeting: C.floorMeeting,
  pantry: C.floorPantry,
  lounge: C.floorLounge,
};

/** Shared textured materials; the procedural maps keep the palette colour. */
const M = {
  deskTop: mat(C.deskTop, { map: woodGrain(1.6, 1), roughness: 0.66 }),
  oak: mat(C.wood, { map: woodGrain(1.3, 1), roughness: 0.7 }),
  oakDark: mat(C.woodDark, { map: woodGrain(1.3, 1), roughness: 0.68 }),
  oakPale: mat(0xd9cbbd, { map: woodGrain(1.2, 1), roughness: 0.9 }),
  plaster: mat(C.wall, { map: plasterNoise(3, 3), roughness: 1 }),
  plasterShade: mat(C.wallShade, { map: plasterNoise(2, 2), roughness: 1 }),
  sage: mat(C.sage, { map: fabricWeave(2, 2), roughness: 0.95 }),
  sageDeep: mat(C.sageDeep, { map: fabricWeave(2, 2), roughness: 0.95 }),
  rug: mat(C.rug, { map: fabricWeave(4, 4), roughness: 1 }),
  rugEdge: mat(C.rugEdge, { map: fabricWeave(4, 4), roughness: 1 }),
  cushion: mat(0x9cb9a5, { map: fabricWeave(3, 3), roughness: 0.95 }),
  bean: mat(C.coral, { map: fabricWeave(3, 3), roughness: 0.95 }),
  beanDeep: mat(0xd0684f, { map: fabricWeave(3, 3), roughness: 0.95 }),
  treeLeaf: mat(C.treeLeaf, { roughness: 0.9, flatShading: true }),
  treeLeafLight: mat(C.treeLeafLight, { roughness: 0.9, flatShading: true }),
} as const;

/** Small deterministic PRNG, so every bird wanders differently but reproducibly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nudges a palette colour up or down in lightness. */
function tint(hex: number, amount: number): number {
  return new THREE.Color(hex).offsetHSL(0, 0, amount).getHex();
}

/** Quantised tone buckets, so floors reuse a handful of materials. */
const TONES = [-0.05, -0.026, 0, 0.022, 0.045];

function toneFor(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  const noise = value - Math.floor(value);
  return TONES[Math.floor(noise * TONES.length)] ?? 0;
}

/** Splits a partition into the solid runs between its door gaps. */
function subtractGaps(partition: Partition): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let cursor = partition.from;
  for (const gap of [...partition.gaps].sort((a, b) => a.from - b.from)) {
    if (gap.from > cursor) runs.push({ from: cursor, to: Math.min(gap.from, partition.to) });
    cursor = Math.max(cursor, gap.to);
  }
  if (cursor < partition.to) runs.push({ from: cursor, to: partition.to });
  return runs;
}

/**
 * The office diorama. Geometry is authored in code on a metre-like grid:
 * 26 x 21 units split into four equal rooms with glass and solid partitions.
 */
export class OfficeWorld {
  readonly root = new THREE.Group();
  /** Walls, floors and furniture; the unit-test extents apply to this alone. */
  readonly building = new THREE.Group();
  /** Garden, trees, pet pen, birds and the sun disc around the building. */
  readonly surroundings = new THREE.Group();
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  readonly sunDisc: THREE.Mesh;
  treeCount = 0;
  birdCount = 0;
  catCount = 0;
  dogCount = 0;
  /** How many chases have started since the page loaded. */
  chaseCount = 0;
  /** Chases aimed at a lawn bird, and birds that bolted because of one. */
  birdChaseCount = 0;
  birdEscapeCount = 0;

  private readonly sunGlow: THREE.Sprite;
  private readonly birds: BirdRef[] = [];
  private readonly perches: PerchSpot[] = [];
  private readonly pets: PetRef[] = [];
  private readonly screens: ScreenRef[] = [];
  private readonly lampLights: LampRef[] = [];
  private readonly lampMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly steam: SteamPuff[] = [];
  private readonly plants: PlantRef[] = [];
  private readonly windowMaterial: THREE.MeshStandardMaterial;
  private readonly bulbMaterial: THREE.MeshStandardMaterial;
  private readonly glassMaterial: THREE.MeshStandardMaterial;
  private readonly glows: GlowRef[] = [];
  private readonly contactMaterials = new Map<number, THREE.MeshBasicMaterial>();
  private tvMaterial: THREE.MeshStandardMaterial | null = null;
  private tvContainer = new THREE.Group();
  private elapsed = 0;
  private tvLight: THREE.PointLight | null = null;
  private readonly tvChannels: TvSlide[] = [];
  private readonly tvStatic: THREE.DataTexture[] = [];
  private tvSlideIndex = 0;
  private tvSlideAge = 0;
  private tvTexture: THREE.DataTexture | null = null;

  /** Birds currently resting on a tree or on the lawn, for live checks. */
  get perchedCount(): number {
    return this.birds.filter((bird) => bird.state === 'perch').length;
  }

  /** Birds foraging on the lawn right now. */
  get groundBirdCount(): number {
    return this.birds.filter((bird) => bird.state === 'perch' && bird.perch?.ground).length;
  }

  /** Foraging birds inside the pen, where the pets can give chase. */
  get penBirdCount(): number {
    return this.birds.filter(
      (bird) =>
        bird.state === 'perch' &&
        bird.perch?.ground === true &&
        bird.group.position.x > PEN.x0 - 0.4 &&
        bird.group.position.x < PEN.x1 + 0.4 &&
        bird.group.position.z > PEN.z0 - 0.4 &&
        bird.group.position.z < PEN.z1 + 0.4,
    ).length;
  }

  /** Whether the cat and dog are mid-chase right now. */
  get petsChasing(): boolean {
    return this.pets.some((pet) => pet.state === 'chase' || pet.state === 'flee');
  }

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xdff0ff, 0xcdb59a, 0.8);
    this.sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -34;
    this.sun.shadow.camera.right = 34;
    this.sun.shadow.camera.top = 34;
    this.sun.shadow.camera.bottom = -34;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.sun.target.position.set(OFFICE_WIDTH / 2, 0, OFFICE_DEPTH / 2);
    this.root.add(this.sun, this.sun.target, this.hemi);

    this.windowMaterial = new THREE.MeshStandardMaterial({
      color: 0xcfeaf6,
      emissive: new THREE.Color(0x9fd3e8),
      emissiveIntensity: 0.3,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.bulbMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff2d4,
      emissive: new THREE.Color(0xffd9a0),
      emissiveIntensity: 0.2,
      roughness: 0.6,
    });
    this.glassMaterial = new THREE.MeshStandardMaterial({
      color: C.glass,
      transparent: true,
      opacity: 0.19,
      roughness: 0.05,
      metalness: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lampMaterials.push(this.bulbMaterial);

    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff1c6, toneMapped: false });
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS, 24, 16), sunMaterial);
    this.sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowSprite(),
        color: 0xffd27a,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.sunGlow.scale.setScalar(11);
    this.sunDisc.add(this.sunGlow);
    // applyDay puts it on the light ray as soon as the first frame runs.
    this.sunDisc.position.set(OFFICE_WIDTH / 2, 40, OFFICE_DEPTH / 2 + 60);

    this.building.add(
      this.buildBase(),
      this.buildFloors(),
      this.buildOuterWalls(),
      this.buildPartitions(),
      this.buildWorkspace(),
      this.buildMeeting(),
      this.buildPantry(),
      this.buildLounge(),
      this.buildPendants(),
    );
    this.root.add(this.building);

    this.surroundings.add(this.buildGarden());
    this.buildScenery();
    this.root.add(this.surroundings);
  }

  // ---------------------------------------------------------------- shell ---

  private buildBase(): THREE.Group {
    const g = new THREE.Group();
    g.add(
      rbox(
        OFFICE_WIDTH + 1.4,
        1.2,
        OFFICE_DEPTH + 1.4,
        0.22,
        mat(C.slab),
        OFFICE_WIDTH / 2,
        -0.6,
        OFFICE_DEPTH / 2,
      ),
    );
    g.add(
      rbox(
        OFFICE_WIDTH + 1.62,
        0.16,
        OFFICE_DEPTH + 1.62,
        0.07,
        mat(C.slabEdge),
        OFFICE_WIDTH / 2,
        -0.14,
        OFFICE_DEPTH / 2,
      ),
    );
    return g;
  }

  private buildFloors(): THREE.Group {
    const g = new THREE.Group();
    for (const id of Object.keys(ROOMS) as RoomId[]) {
      const rect = ROOMS[id];
      g.add(this.floorUnderlay(rect));
      if (id === 'pantry') g.add(this.tiledFloor(rect, FLOOR_COLOR[id], 1.3));
      else if (id === 'meeting') g.add(this.tiledFloor(rect, FLOOR_COLOR[id], 2.6));
      else g.add(this.plankFloor(rect, FLOOR_COLOR[id], id === 'lounge' ? 1.6 : 1.05));
    }
    return g;
  }

  /** Dark base plane that reads as the seams between planks and tiles. */
  private floorUnderlay(rect: Rect): THREE.Mesh {
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(rect.w - 0.02, rect.d - 0.02),
      mat(C.seam, { roughness: 1 }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.set(rect.x + rect.w / 2, 0.004, rect.z + rect.d / 2);
    under.receiveShadow = true;
    return under;
  }

  private floorSlab(
    x: number,
    z: number,
    w: number,
    d: number,
    color: number,
    tone: number,
  ): THREE.Mesh {
    const slab = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      mat(tint(color, tone), { roughness: 1 }),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(x, 0.014, z);
    slab.receiveShadow = true;
    return slab;
  }

  private plankFloor(rect: Rect, color: number, boardDepth: number): THREE.Group {
    const g = new THREE.Group();
    const rows = Math.max(2, Math.round(rect.d / boardDepth));
    const depth = rect.d / rows;
    for (let row = 0; row < rows; row += 1) {
      g.add(
        this.floorSlab(
          rect.x + rect.w / 2,
          rect.z + depth * (row + 0.5),
          rect.w - 0.02,
          depth - 0.045,
          color,
          toneFor(row, 3),
        ),
      );
    }
    return g;
  }

  private tiledFloor(rect: Rect, color: number, tile: number): THREE.Group {
    const g = new THREE.Group();
    const cols = Math.max(2, Math.round(rect.w / tile));
    const rows = Math.max(2, Math.round(rect.d / tile));
    const w = rect.w / cols;
    const d = rect.d / rows;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        g.add(
          this.floorSlab(
            rect.x + w * (col + 0.5),
            rect.z + d * (row + 0.5),
            w - 0.05,
            d - 0.05,
            color,
            toneFor(col, row),
          ),
        );
      }
    }
    return g;
  }

  private buildOuterWalls(): THREE.Group {
    const g = new THREE.Group();
    const wall = M.plaster;
    const trim = mat(C.trim, { roughness: 0.9 });

    // Back wall (z = 0) and left wall (x = 0); the other two sides stay open
    // so the isometric camera can look inside. The shells are built around the
    // window openings so the glass is genuinely see-through from both sides.
    g.add(
      this.outerWall('x', -0.3, OFFICE_WIDTH + 0.3, wall, [
        { from: 0.9, to: 12.1 },
        { from: 14.4, to: 18.8 },
      ]),
    );
    g.add(box(OFFICE_WIDTH + 0.6, 0.18, 0.06, trim, OFFICE_WIDTH / 2, 0.09, 0.035));
    g.add(box(OFFICE_WIDTH + 0.78, 0.1, 0.42, trim, OFFICE_WIDTH / 2, WALL_HEIGHT + 0.05, -0.12));

    g.add(this.outerWall('z', -0.3, OFFICE_DEPTH + 0.3, wall, [{ from: 6.4, to: 9.6 }]));
    g.add(box(0.06, 0.18, OFFICE_DEPTH + 0.6, trim, 0.035, 0.09, OFFICE_DEPTH / 2));
    g.add(box(0.42, 0.1, OFFICE_DEPTH + 0.78, trim, -0.12, WALL_HEIGHT + 0.05, OFFICE_DEPTH / 2));

    // Windows behind the desks and in the meeting room.
    g.add(this.windowStrip(6.5, 0.02, 11.2, 'z', 5));
    g.add(this.windowStrip(16.6, 0.02, 4.4, 'z', 2));
    g.add(this.whiteboard(22.3, 0.04));
    // Workspace window on the left wall.
    g.add(this.windowStrip(8.0, 0.02, 3.2, 'x', 2));

    g.add(this.wallClock(5.3));
    g.add(this.wallArt(0.04, 2.55, 3.1, Math.PI / 2, 1.35, 0.95, 0xe0a574));
    return g;
  }

  /** Runs the plaster shell between window openings, leaving the panes clear. */
  private outerWall(
    axis: 'x' | 'z',
    from: number,
    to: number,
    material: THREE.Material,
    holes: { from: number; to: number }[],
  ): THREE.Group {
    const g = new THREE.Group();
    const thickness = 0.3;

    const add = (a: number, b: number, y: number, height: number) => {
      if (b - a < 0.01) return;
      const mid = (a + b) / 2;
      g.add(
        axis === 'x'
          ? box(b - a, height, thickness, material, mid, y, -thickness / 2)
          : box(thickness, height, b - a, material, -thickness / 2, y, mid),
      );
    };

    let cursor = from;
    for (const hole of [...holes].sort((a, b) => a.from - b.from)) {
      add(cursor, hole.from, WALL_HEIGHT / 2, WALL_HEIGHT);
      add(hole.from, hole.to, WINDOW_OPEN_Y0 / 2, WINDOW_OPEN_Y0);
      add(
        hole.from,
        hole.to,
        WINDOW_OPEN_Y1 + (WALL_HEIGHT - WINDOW_OPEN_Y1) / 2,
        WALL_HEIGHT - WINDOW_OPEN_Y1,
      );
      cursor = hole.to;
    }
    add(cursor, to, WALL_HEIGHT / 2, WALL_HEIGHT);

    return g;
  }

  private windowStrip(
    center: number,
    offset: number,
    width: number,
    axis: 'x' | 'z',
    panes: number,
  ): THREE.Group {
    const g = new THREE.Group();
    const frameMat = mat(C.frame, { metalness: 0.25, roughness: 0.55 });
    const height = WINDOW_HEIGHT;
    const y = WINDOW_CENTER_Y;

    if (axis === 'z') {
      g.add(plane(width - 0.16, height - 0.16, this.windowMaterial, center, y, offset + 0.02));
      g.add(box(width, 0.09, 0.1, frameMat, center, y - height / 2, offset + 0.05));
      g.add(box(width, 0.09, 0.1, frameMat, center, y + height / 2, offset + 0.05));
      for (let i = 0; i <= panes; i += 1) {
        g.add(box(0.07, height, 0.1, frameMat, center - width / 2 + (width / panes) * i, y, offset + 0.05));
      }
      g.add(box(width + 0.2, 0.08, 0.26, mat(C.trim), center, y - height / 2 - 0.06, offset + 0.09));
    } else {
      const glass = plane(width - 0.16, height - 0.16, this.windowMaterial, offset + 0.02, y, center);
      glass.rotation.y = Math.PI / 2;
      g.add(glass);
      g.add(box(0.1, 0.09, width, frameMat, offset + 0.05, y - height / 2, center));
      g.add(box(0.1, 0.09, width, frameMat, offset + 0.05, y + height / 2, center));
      for (let i = 0; i <= panes; i += 1) {
        g.add(box(0.1, height, 0.07, frameMat, offset + 0.05, y, center - width / 2 + (width / panes) * i));
      }
      g.add(box(0.26, 0.08, width + 0.2, mat(C.trim), offset + 0.09, y - height / 2 - 0.06, center));
    }

    return g;
  }

  private whiteboard(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.add(box(4.8, 1.85, 0.07, mat(C.frame, { metalness: 0.2, roughness: 0.5 }), x, 2.15, z + 0.02));
    g.add(plane(4.6, 1.65, mat(0xf7faf7), x, 2.15, z + 0.07));

    const inks = [0x6f9e8b, 0xe07a5f, 0x5a7d9a, 0xe2b44a];
    const columns = [
      { start: x - 2.05, widths: [1.85, 1.2, 0.9] },
      { start: x + 0.35, widths: [1.5, 1.1, 1.35] },
    ];
    for (let column = 0; column < columns.length; column += 1) {
      const { start, widths } = columns[column];
      for (let row = 0; row < widths.length; row += 1) {
        const width = widths[row];
        const line = box(
          width,
          0.035,
          0.012,
          mat(inks[(column * widths.length + row) % inks.length]),
          start + width / 2,
          2.62 - row * 0.33,
          z + 0.08,
        );
        line.castShadow = false;
        g.add(line);
      }
    }
    g.add(box(3.6, 0.06, 0.14, mat(C.metal), x, 1.16, z + 0.12));
    g.add(cyl(0.02, 0.02, 0.16, mat(0xe07a5f), x - 1.2, 1.23, z + 0.12, 8));
    g.add(cyl(0.02, 0.02, 0.16, mat(0x5a7d9a), x - 1.0, 1.23, z + 0.12, 8));
    return g;
  }

  private wallClock(z: number): THREE.Group {
    const g = new THREE.Group();
    const rim = cyl(0.34, 0.34, 0.04, mat(C.frame, { metalness: 0.3 }), 0.05, 2.95, z, 24);
    rim.rotation.z = Math.PI / 2;
    g.add(rim);
    const face = cyl(0.29, 0.29, 0.045, mat(0xfaf6ee), 0.07, 2.95, z, 24);
    face.rotation.z = Math.PI / 2;
    g.add(face);
    const minute = box(0.015, 0.24, 0.03, mat(C.dark), 0.1, 2.99, z);
    minute.rotation.x = 0.5;
    g.add(minute);
    const hour = box(0.015, 0.15, 0.035, mat(C.dark), 0.1, 2.93, z + 0.06);
    hour.rotation.x = -1.1;
    g.add(hour);
    return g;
  }

  private wallArt(
    x: number,
    y: number,
    z: number,
    rotationY: number,
    w: number,
    h: number,
    accent: number,
  ): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = rotationY;
    g.add(box(w + 0.1, h + 0.1, 0.05, M.oakDark, 0, 0, 0));
    g.add(plane(w, h, mat(accent), 0, 0, 0.032));
    g.add(plane(w * 0.4, h * 0.4, mat(C.paper), 0.18, 0.1, 0.034));
    g.add(plane(w * 0.5, h * 0.12, mat(0xf4eee5), -0.1, -0.22, 0.034));
    return g;
  }

  // ----------------------------------------------------------- partitions ---

  private buildPartitions(): THREE.Group {
    const g = new THREE.Group();
    const partitions: Partition[] = [
      { axis: 'x', at: 13, from: 0, to: 10.5, gaps: [{ from: 6.8, to: 8.6 }], style: 'glass' },
      { axis: 'x', at: 13, from: 10.5, to: 21, gaps: [{ from: 18.2, to: 20.0 }], style: 'solid' },
      { axis: 'z', at: 10.5, from: 0, to: 13, gaps: [{ from: 4.4, to: 6.2 }], style: 'glass' },
      { axis: 'z', at: 10.5, from: 13, to: 26, gaps: [{ from: 14.8, to: 16.6 }], style: 'solid' },
    ];

    for (const partition of partitions) {
      for (const run of subtractGaps(partition)) {
        g.add(
          partition.style === 'glass'
            ? this.glassWall(partition, run.from, run.to)
            : this.solidWall(partition, run.from, run.to),
        );
      }
      for (const gap of partition.gaps) {
        g.add(this.doorFrame(partition, gap.from, gap.to, partition.style === 'glass'));
      }
    }

    return g;
  }

  private glassWall(partition: Partition, from: number, to: number): THREE.Group {
    const g = new THREE.Group();
    const h = PARTITION_HEIGHT;
    const len = to - from;
    const mid = (from + to) / 2;
    const frameMat = mat(C.frame, { metalness: 0.35, roughness: 0.45 });

    const addPost = (offset: number) => {
      if (partition.axis === 'x') g.add(box(0.13, h, 0.13, frameMat, partition.at, h / 2, offset));
      else g.add(box(0.13, h, 0.13, frameMat, offset, h / 2, partition.at));
    };

    const panels = Math.max(1, Math.round(len / 2.3));
    for (let i = 0; i <= panels; i += 1) addPost(from + (len / panels) * i);

    if (partition.axis === 'x') {
      const pane = box(0.05, h - 0.2, len - 0.06, this.glassMaterial, partition.at, h / 2, mid);
      pane.castShadow = false;
      pane.receiveShadow = false;
      g.add(pane);
      g.add(box(0.15, 0.08, len, frameMat, partition.at, 0.04, mid));
      g.add(box(0.15, 0.07, len, frameMat, partition.at, h - 0.035, mid));
    } else {
      const pane = box(len - 0.06, h - 0.2, 0.05, this.glassMaterial, mid, h / 2, partition.at);
      pane.castShadow = false;
      pane.receiveShadow = false;
      g.add(pane);
      g.add(box(len, 0.08, 0.15, frameMat, mid, 0.04, partition.at));
      g.add(box(len, 0.07, 0.15, frameMat, mid, h - 0.035, partition.at));
    }

    return g;
  }

  private solidWall(partition: Partition, from: number, to: number): THREE.Group {
    const g = new THREE.Group();
    const h = PARTITION_HEIGHT;
    const len = to - from;
    const mid = (from + to) / 2;
    const body = M.plasterShade;
    const trim = mat(C.trim, { roughness: 0.9 });

    if (partition.axis === 'x') {
      g.add(box(0.18, h, len, body, partition.at, h / 2, mid));
      g.add(box(0.24, 0.16, len, trim, partition.at, 0.08, mid));
      g.add(box(0.26, 0.08, len, trim, partition.at, h + 0.04, mid));
    } else {
      g.add(box(len, h, 0.18, body, mid, h / 2, partition.at));
      g.add(box(len, 0.16, 0.24, trim, mid, 0.08, partition.at));
      g.add(box(len, 0.08, 0.26, trim, mid, h + 0.04, partition.at));
    }

    return g;
  }

  private doorFrame(
    partition: Partition,
    from: number,
    to: number,
    glass: boolean,
  ): THREE.Group {
    const g = new THREE.Group();
    const h = PARTITION_HEIGHT;
    const doorH = 2.3;
    const mid = (from + to) / 2;
    const postMat = glass ? mat(C.frame, { metalness: 0.35, roughness: 0.45 }) : M.plasterShade;
    const headerMat = glass ? postMat : M.plasterShade;

    if (partition.axis === 'x') {
      g.add(box(0.16, h, 0.16, postMat, partition.at, h / 2, from));
      g.add(box(0.16, h, 0.16, postMat, partition.at, h / 2, to));
      g.add(box(0.16, h - doorH, to - from, headerMat, partition.at, doorH + (h - doorH) / 2, mid));
      g.add(box(0.24, 0.02, to - from, mat(C.trim), partition.at, 0.02, mid));
    } else {
      g.add(box(0.16, h, 0.16, postMat, from, h / 2, partition.at));
      g.add(box(0.16, h, 0.16, postMat, to, h / 2, partition.at));
      g.add(box(to - from, h - doorH, 0.16, headerMat, mid, doorH + (h - doorH) / 2, partition.at));
      g.add(box(to - from, 0.02, 0.24, mat(C.trim), mid, 0.02, partition.at));
    }

    return g;
  }

  // ------------------------------------------------------------ workspace ---

  private buildWorkspace(): THREE.Group {
    const g = new THREE.Group();
    DESK_ROW_Z.forEach((rowZ, row) => {
      DESK_X.forEach((x, i) => {
        const desk = this.buildDesk(row * DESK_X.length + i);
        desk.position.set(x, 0, rowZ);
        g.add(desk);
      });
    });
    g.add(this.buildCabinet(1.55, 1.15));
    g.add(this.plant(12.0, 1.2, 1.1, 0.4));
    g.add(this.plant(0.9, 9.6, 0.85, 1.7));
    return g;
  }

  private buildDesk(index: number): THREE.Group {
    const g = new THREE.Group();

    g.add(rbox(1.9, 0.09, 1.0, 0.04, M.deskTop, 0, 0.74, 0));
    g.add(this.contact(0, 0, 2.55, 1.65, 0.26));
    g.add(box(0.07, 0.72, 0.86, mat(C.metal), -0.86, 0.36, 0));
    g.add(box(0.07, 0.72, 0.86, mat(C.metal), 0.86, 0.36, 0));

    const idle = idleScreenTexture();
    const screenMat = new THREE.MeshStandardMaterial({
      map: idle,
      emissiveMap: idle,
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.06,
      roughness: 0.3,
      metalness: 0,
    });
    this.screens.push({
      material: screenMat,
      spotId: `desk-${index + 1}`,
      typing: new TypingScreen(index + 1),
      idle,
      active: false,
    });

    g.add(box(0.36, 0.03, 0.2, mat(C.dark), 0, 0.795, -0.34));
    g.add(box(0.06, 0.3, 0.06, mat(C.dark), 0, 0.95, -0.34));
    g.add(rbox(0.94, 0.58, 0.06, 0.02, mat(C.dark), 0, 1.28, -0.34));
    g.add(plane(0.84, 0.47, screenMat, 0, 1.28, -0.303));

    g.add(rbox(0.6, 0.03, 0.18, 0.012, mat(0x39424a), 0, 0.795, 0.2));
    g.add(rbox(0.09, 0.035, 0.14, 0.03, mat(0x39424a), 0.42, 0.795, 0.17));

    const pad = box(0.3, 0.012, 0.22, mat(C.paper), 0.5, 0.8, -0.12);
    pad.rotation.y = 0.25;
    g.add(pad);
    g.add(this.mug(-0.62, 0.79, 0.06, C.coral));

    if (index % 5 === 1) g.add(this.deskLamp(0.72, -0.26));
    if (index % 5 === 0 || index % 5 === 3) g.add(this.smallPlant(-0.78, 0.79, -0.3));

    g.add(this.chair(0, DESK_SEAT_OFFSET, Math.PI));
    return g;
  }

  private buildCabinet(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.add(rbox(2.2, 0.78, 0.8, 0.05, M.oak, x, 0.39, z));
    g.add(box(2.28, 0.04, 0.88, M.oakDark, x, 0.79, z));

    const bookColors = [C.coral, 0x5a7d9a, C.mustard, C.sage, 0x8a6aa8];
    for (let i = 0; i < 6; i += 1) {
      const w = 0.12 + (i % 3) * 0.03;
      g.add(
        box(
          w,
          0.26 + (i % 2) * 0.07,
          0.2,
          mat(bookColors[i % bookColors.length]),
          x - 0.86 + i * 0.17,
          0.94,
          z,
        ),
      );
    }
    g.add(this.smallPlant(x + 0.88, 0.81, z));
    g.add(this.contact(x, z, 2.9, 1.4, 0.2));
    return g;
  }

  private deskLamp(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.add(cyl(0.11, 0.13, 0.03, mat(C.dark), x, 0.795, z, 14));

    const arm = box(0.035, 0.34, 0.035, mat(C.frame), x, 0.96, z);
    arm.rotation.z = 0.12;
    g.add(arm);
    const shade = cyl(0.09, 0.16, 0.14, mat(C.mustard), x - 0.05, 1.11, z, 16);
    shade.rotation.z = 0.2;
    g.add(shade);
    g.add(ball(0.05, this.bulbMaterial, x - 0.06, 1.03, z, 10));
    return g;
  }

  private smallPlant(x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.add(cyl(0.09, 0.075, 0.12, mat(0xc98d6a), x, y + 0.06, z, 12));
    g.add(ball(0.11, mat(C.leaf), x, y + 0.19, z, 8));
    g.add(ball(0.08, mat(C.leafLight), x + 0.07, y + 0.25, z - 0.03, 8));
    g.add(ball(0.07, mat(C.leaf), x - 0.06, y + 0.24, z + 0.04, 8));
    return g;
  }

  // -------------------------------------------------------------- meeting ---

  private buildMeeting(): THREE.Group {
    const g = new THREE.Group();
    const cx = 19.5;
    const cz = 4.6;

    g.add(rbox(6.0, 0.12, 2.2, 0.05, M.deskTop, cx, 0.74, cz));
    g.add(this.contact(cx, cz, 7.0, 3.2, 0.2));
    for (const dx of [-2.86, 2.86]) {
      for (const dz of [-0.95, 0.95]) {
        g.add(box(0.12, 0.72, 0.12, mat(C.metal), cx + dx, 0.36, cz + dz));
      }
    }

    for (const x of [17.2, 19.5, 21.8]) {
      g.add(this.chair(x, 3.05, 0));
      g.add(this.chair(x, 6.15, Math.PI));
    }

    g.add(this.laptop(18.0, cz - 0.1, 0.2));
    g.add(this.laptop(21.2, cz + 0.2, -0.35));
    g.add(this.mug(19.4, 0.81, cz - 0.4, C.mustard));
    g.add(this.mug(20.3, 0.81, cz + 0.35, C.coral));
    const papers = box(0.72, 0.015, 0.5, mat(C.paper), 18.5, 0.805, cz + 0.4);
    papers.rotation.y = 0.2;
    g.add(papers);
    g.add(this.smallPlant(cx, 0.81, cz));

    g.add(this.sideboard(16.6, 0.72));
    g.add(this.plant(25.2, 9.5, 1.05, 1.2));
    return g;
  }

  private sideboard(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.add(this.contact(x, z, 3.3, 1.1, 0.2));
    g.add(rbox(2.8, 0.68, 0.55, 0.04, M.oak, x, 0.34, z));
    g.add(box(2.86, 0.04, 0.6, M.oakDark, x, 0.69, z));
    g.add(this.smallPlant(x - 1.0, 0.71, z));
    g.add(box(0.5, 0.16, 0.3, mat(C.paper), x + 0.7, 0.78, z));
    return g;
  }

  private laptop(x: number, z: number, rotation: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0.8, z);
    g.rotation.y = rotation;
    g.add(rbox(0.46, 0.02, 0.32, 0.01, mat(0xcdd3d6), 0, 0.01, 0));
    const lid = rbox(0.46, 0.3, 0.02, 0.01, mat(0xcdd3d6), 0, 0.15, -0.2);
    lid.rotation.x = -0.25;
    g.add(lid);
    const screen = plane(
      0.4,
      0.24,
      mat(0x24323d, { emissive: 0x8fd3f4, emissiveIntensity: 0.35 }),
      0,
      0.15,
      -0.185,
    );
    screen.rotation.x = -0.25;
    g.add(screen);
    return g;
  }

  // --------------------------------------------------------------- pantry ---

  private buildPantry(): THREE.Group {
    const g = new THREE.Group();
    const wood = M.oakPale;
    const porcelain = mat(C.porcelain, { roughness: 0.4 });

    g.add(this.contact(0.62, 14.15, 1.75, 6.4, 0.24));
    g.add(rbox(0.95, 0.86, 5.7, 0.04, wood, 0.52, 0.43, 14.15));
    g.add(rbox(1.05, 0.09, 5.85, 0.03, porcelain, 0.52, 0.9, 14.15));
    g.add(box(0.04, 0.7, 5.7, mat(0xeae2d6), 0.05, 1.35, 14.15));

    // Cabinet doors and handles.
    for (const z of [12.2, 14.15, 16.1]) {
      g.add(box(0.03, 0.7, 1.6, mat(0xe8ddd0), 1.0, 0.45, z));
      g.add(box(0.025, 0.03, 0.22, mat(C.metal), 1.03, 0.68, z - 0.55));
    }

    // Upper cabinets.
    g.add(box(0.4, 0.75, 4.3, mat(0xe8ddd0), 0.22, 2.5, 13.35));
    g.add(box(0.42, 0.03, 4.3, M.oakDark, 0.22, 2.11, 13.35));
    for (const z of [12.4, 13.35, 14.3]) {
      g.add(box(0.02, 0.55, 0.8, mat(0xdccfc0), 0.43, 2.5, z));
    }

    // Sink and tap.
    g.add(box(0.72, 0.05, 0.6, mat(0xb9c2c6, { metalness: 0.4, roughness: 0.35 }), 0.5, 0.95, 15.6));
    g.add(cyl(0.025, 0.025, 0.34, mat(C.metal), 0.26, 1.12, 15.6, 10));
    g.add(box(0.3, 0.04, 0.04, mat(C.metal), 0.38, 1.29, 15.6));

    // Coffee machine.
    g.add(rbox(0.46, 0.62, 0.44, 0.03, mat(0x3c454c, { metalness: 0.3, roughness: 0.5 }), 0.62, 1.25, 13.4));
    g.add(box(0.05, 0.1, 0.22, mat(0x22282d), 0.86, 1.14, 13.4));
    g.add(box(0.02, 0.04, 0.08, mat(0xe07a5f, { emissive: 0xe07a5f, emissiveIntensity: 0.6 }), 0.87, 1.44, 13.4));
    g.add(box(0.26, 0.03, 0.26, mat(0x2b3238), 0.75, 0.97, 13.4));
    g.add(cyl(0.045, 0.04, 0.09, mat(C.paper), 0.74, 1.02, 13.4, 12));

    // Kettle and cups.
    g.add(cyl(0.1, 0.12, 0.24, mat(0xe8e2d8), 0.55, 1.06, 14.55, 14));
    g.add(box(0.03, 0.1, 0.1, mat(0x3c454c), 0.55, 1.12, 14.68));
    for (let i = 0; i < 3; i += 1) {
      g.add(cyl(0.045, 0.045, 0.09, mat(i === 1 ? C.mustard : C.paper), 0.34 + i * 0.14, 0.99, 12.6, 10));
    }

    // Round table and stools.
    g.add(this.contact(7.2, 15.8, 3.3, 3.3, 0.2));
    g.add(cyl(1.4, 1.4, 0.08, M.deskTop, 7.2, 0.72, 15.8, 32));
    g.add(cyl(0.16, 0.2, 0.66, mat(C.metal), 7.2, 0.36, 15.8, 12));
    g.add(cyl(0.5, 0.55, 0.06, mat(C.metal), 7.2, 0.03, 15.8, 20));
    g.add(this.stool(5.5, 15.8, Math.PI / 2));
    g.add(this.stool(8.9, 15.8, -Math.PI / 2));
    g.add(this.stool(7.2, 17.5, Math.PI));
    g.add(this.mug(6.2, 0.76, 15.3, C.coral));
    g.add(this.mug(8.0, 0.76, 16.2, C.mustard));
    g.add(this.smallPlant(7.7, 0.76, 15.5));
    g.add(box(0.55, 0.08, 0.4, M.oak, 6.6, 0.78, 16.3));

    // Appliance corner.
    g.add(this.contact(0.9, 19.5, 1.8, 1.8, 0.24));
    g.add(rbox(1.05, 2.0, 1.05, 0.05, mat(0xece7df), 0.9, 1.0, 19.5));
    g.add(box(0.03, 0.02, 0.98, mat(0xb8b2a8), 1.44, 1.43, 19.5));
    g.add(box(0.04, 0.45, 0.03, mat(C.metal), 1.45, 1.15, 19.16));
    g.add(box(0.04, 0.3, 0.03, mat(C.metal), 1.45, 1.78, 19.16));

    g.add(this.contact(0.9, 17.5, 1.05, 1.0, 0.18));
    g.add(box(0.56, 0.95, 0.5, mat(0xf1ece3), 0.9, 0.48, 17.5));
    g.add(cyl(0.2, 0.17, 0.42, mat(0x9fd2e8, { transparent: true, opacity: 0.85 }), 0.9, 1.17, 17.5, 16));
    g.add(box(0.06, 0.08, 0.12, mat(C.metal), 1.2, 0.8, 17.5));
    g.add(box(0.06, 0.08, 0.12, mat(C.metal), 1.2, 0.62, 17.5));

    g.add(this.plant(12.1, 20.2, 1.0, 2.2));
    g.add(cyl(0.22, 0.2, 0.4, mat(0x9aa3a8), 2.7, 0.2, 19.9, 12));
    g.add(this.sofaRun(7.2, 20.3, 0, C.coral));

    this.buildSteam();
    g.add(this.steamGroup());

    return g;
  }

  private steamGroup(): THREE.Group {
    const g = new THREE.Group();
    for (const puff of this.steam) g.add(puff.mesh);
    return g;
  }

  private buildSteam(): void {
    for (let i = 0; i < 4; i += 1) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        roughness: 1,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06 + i * 0.012, 10, 8), material);
      mesh.position.set(0.7, 1.6 + i * 0.08, 13.4);
      this.steam.push({
        mesh,
        phase: i / 4,
        baseX: 0.7,
        baseY: 1.55 + i * 0.05,
        baseZ: 13.4,
      });
    }
  }

  private stool(x: number, z: number, rotation: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotation;
    g.add(cyl(0.3, 0.28, 0.09, mat(C.mustard), 0, 0.66, 0, 18));
    g.add(cyl(0.04, 0.05, 0.6, mat(C.metal), 0, 0.33, 0, 8));
    g.add(cyl(0.22, 0.24, 0.05, mat(C.metal), 0, 0.03, 0, 14));
    return g;
  }

  // --------------------------------------------------------------- lounge ---

  private buildLounge(): THREE.Group {
    const g = new THREE.Group();

    // Rug.
    g.add(box(7.5, 0.015, 4.4, M.rugEdge, 19.0, 0.015, 16.2));
    g.add(box(7.1, 0.02, 4.0, M.rug, 19.0, 0.024, 16.2));

    // Sofa along the south edge, facing the TV wall.
    const sofa = M.sage;
    const sofaDeep = M.sageDeep;
    g.add(this.contact(19.4, 18.1, 6.3, 1.9, 0.26));
    g.add(rbox(5.5, 0.42, 1.4, 0.1, sofa, 19.4, 0.32, 18.05));
    g.add(rbox(5.5, 0.72, 0.3, 0.1, sofaDeep, 19.4, 0.86, 18.62));
    g.add(rbox(0.36, 0.58, 1.4, 0.1, sofa, 16.62, 0.58, 18.05));
    g.add(rbox(0.36, 0.58, 1.4, 0.1, sofa, 22.18, 0.58, 18.05));
    for (const x of [17.55, 19.4, 21.25]) {
      g.add(rbox(1.62, 0.16, 1.1, 0.07, M.cushion, x, 0.58, 18.0));
    }
    g.add(rbox(0.42, 0.42, 0.16, 0.06, mat(C.mustard), 16.95, 0.76, 18.35));
    g.add(rbox(0.42, 0.42, 0.16, 0.06, mat(C.coral), 21.85, 0.76, 18.35));

    // Coffee table.
    g.add(this.contact(19.4, 15.0, 3.3, 1.7, 0.18));
    g.add(rbox(2.8, 0.09, 1.2, 0.04, M.deskTop, 19.4, 0.42, 15.0));
    for (const dx of [-1.25, 1.25]) {
      for (const dz of [-0.48, 0.48]) {
        g.add(box(0.06, 0.4, 0.06, M.oakDark, 19.4 + dx, 0.2, 15.0 + dz));
      }
    }
    const book1 = box(0.34, 0.05, 0.26, mat(C.coral), 18.85, 0.49, 14.75);
    book1.rotation.y = 0.18;
    g.add(book1);
    const book2 = box(0.3, 0.04, 0.22, mat(C.mustard), 18.9, 0.535, 14.8);
    book2.rotation.y = -0.12;
    g.add(book2);
    g.add(this.mug(20.3, 0.465, 15.15, C.paper));
    g.add(this.smallPlant(19.7, 0.465, 15.3));
    g.add(box(0.16, 0.03, 0.06, mat(0x2b3238), 20.55, 0.48, 14.7));

    // Slatted media wall holding the TV, kept below the partition top.
    g.add(this.contact(21.4, 11.2, 4.4, 1.2, 0.22));
    g.add(rbox(4.0, 0.5, 0.65, 0.05, M.oakDark, 21.4, 0.28, 11.05));
    g.add(box(4.4, 2.28, 0.06, M.oakDark, 21.4, 1.72, 10.63));
    for (let i = 0; i < 15; i += 1) {
      const slat = box(
        0.07,
        2.18,
        0.035,
        mat(0x8a5f3c, { roughness: 0.8 }),
        19.4 + i * 0.286,
        1.72,
        10.672,
      );
      slat.castShadow = false;
      g.add(slat);
    }
    g.add(box(0.7, 0.6, 0.1, mat(0x2b3238), 21.4, 1.95, 10.7));
    g.add(rbox(3.2, 1.8, 0.09, 0.02, mat(0x20262b), 21.4, 1.95, 10.775));

    this.tvChannels.push(...createTvSlides());
    this.tvStatic.push(...tvStaticFrames());
    const firstChannel = this.tvChannels[0];
    const firstMap = firstChannel?.texture ?? null;
    this.tvTexture = firstMap;
    this.tvMaterial = new THREE.MeshStandardMaterial({
      map: firstMap,
      emissiveMap: firstMap,
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.9,
      roughness: 0.28,
      metalness: 0,
    });
    g.add(this.tvContainer);
    g.add(plane(3.02, 1.62, this.tvMaterial, 21.4, 1.95, 10.828));
    g.add(box(0.46, 0.04, 0.05, mat(0x14181c), 21.4, 1.02, 10.755));
    g.add(rbox(1.5, 0.13, 0.12, 0.02, mat(0x1c2126), 21.7, 0.62, 11.0));

    this.tvLight = new THREE.PointLight(firstChannel?.accent ?? 0x88ccff, 0.55, 14, 1.7);
    this.tvLight.position.set(21.4, 1.9, 12.7);
    g.add(this.tvLight);

    // Console, controllers, LED strip.
    g.add(rbox(0.5, 0.11, 0.34, 0.03, mat(0xf1ece3), 19.9, 0.59, 11.05));
    g.add(box(0.12, 0.02, 0.05, mat(0x8fd3f4, { emissive: 0x8fd3f4, emissiveIntensity: 0.8 }), 19.9, 0.65, 10.9));
    g.add(rbox(0.16, 0.05, 0.1, 0.02, mat(0x2b3238), 20.5, 0.55, 11.12));
    g.add(rbox(0.16, 0.05, 0.1, 0.02, mat(0x2b3238), 20.9, 0.55, 11.12));
    g.add(box(2.6, 0.035, 0.03, mat(0x8fd3f4, { emissive: 0x8fd3f4, emissiveIntensity: 0.5 }), 21.4, 0.05, 10.7));

    // Bean bag, low enough for the seated pose.
    g.add(this.contact(23.8, 16.9, 2.5, 2.1, 0.24));
    const bean = ball(0.85, M.bean, 23.8, 0.22, 16.8, 20);
    bean.scale.set(1.15, 0.38, 1.15);
    g.add(bean);
    const beanBack = ball(0.5, M.beanDeep, 23.8, 0.45, 17.2, 16);
    beanBack.scale.set(1.3, 0.6, 0.6);
    g.add(beanBack);

    // Floor lamp.
    g.add(cyl(0.22, 0.24, 0.04, mat(C.metal), 14.5, 0.02, 12.6, 14));
    g.add(cyl(0.03, 0.03, 1.7, mat(C.frame), 14.5, 0.86, 12.6, 8));
    g.add(cyl(0.3, 0.42, 0.4, mat(C.paper), 14.5, 1.86, 12.6, 20));
    g.add(ball(0.1, this.bulbMaterial, 14.5, 1.72, 12.6, 10));
    g.add(this.glow(14.5, 1.7, 12.6, 1.0));
    const lamp = new THREE.PointLight(0xffd9a4, 0, 10, 1.7);
    lamp.position.set(14.5, 1.6, 12.6);
    g.add(lamp);
    this.lampLights.push({ light: lamp, strength: 7 });

    g.add(this.plant(25.2, 19.8, 1.05, 2.8));
    g.add(this.plant(14.3, 20.3, 0.9, 0.9));
    g.add(this.sofaRun(14.55, 16.6, -Math.PI / 2));
    g.add(this.wallArt(13.12, 2.0, 13.6, Math.PI / 2, 1.2, 1.5, 0x8a6aa8));

    return g;
  }

  private buildPendants(): THREE.Group {
    const g = new THREE.Group();
    const spots: [number, number][] = [
      [6.6, 3.6],
      [19.5, 4.6],
      [7.2, 15.8],
      [19.4, 15.0],
    ];
    for (const [x, z] of spots) g.add(this.pendant(x, z));
    return g;
  }

  private pendant(x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0, z);

    const ceiling = WALL_HEIGHT + 0.03;
    const shadeTop = 3.46;
    g.add(cyl(0.12, 0.12, 0.04, mat(C.frame, { metalness: 0.4, roughness: 0.45 }), 0, ceiling, 0, 16));
    g.add(cyl(0.014, 0.014, ceiling - shadeTop, mat(C.frame), 0, (ceiling + shadeTop) / 2, 0, 6));
    g.add(cyl(0.34, 0.5, 0.32, mat(C.dark, { metalness: 0.3, roughness: 0.5 }), 0, 3.3, 0, 24));
    g.add(cyl(0.33, 0.33, 0.02, this.bulbMaterial, 0, 3.15, 0, 24));
    g.add(this.glow(0, 3.12, 0, 1.15));
    const light = new THREE.PointLight(0xffd9a4, 0, 20, 1.6);
    light.position.set(0, 3.0, 0);
    g.add(light);
    this.lampLights.push({ light, strength: 16 });
    return g;
  }

  // ------------------------------------------------------------- scenery ----

  /** Grass terrace around the plinth, so the building sits in a garden instead of a void. */
  private buildGarden(): THREE.Group {
    const g = new THREE.Group();
    const w = OFFICE_WIDTH + GARDEN_MARGIN * 2;
    const d = OFFICE_DEPTH + GARDEN_MARGIN * 2;
    const grass = new THREE.MeshStandardMaterial({
      color: C.lawn,
      map: grassNoise(12, 10),
      roughness: 1,
    });
    g.add(rbox(w, 0.78, d, 0.9, grass, OFFICE_WIDTH / 2, GARDEN_TOP - 0.39, OFFICE_DEPTH / 2));
    g.add(
      rbox(
        w + 0.24,
        0.34,
        d + 0.24,
        0.6,
        mat(C.lawnEdge, { roughness: 1 }),
        OFFICE_WIDTH / 2,
        -1.03,
        OFFICE_DEPTH / 2,
      ),
    );
    return g;
  }

  private buildScenery(): void {
    // One tidy row of three trees per side, pushed well out into the clearing.
    // The two open sides stay shorter so the camera keeps its view inside.
    const distance = 13.5;
    const rows: [number, number, number, number, number, number, number][] = [
      // x0, z0, x1, z1, count, minHeight, maxHeight
      [4.0, -distance, 22.0, -distance, 3, 3.8, 4.8],
      [-distance, 3.5, -distance, 17.5, 3, 3.8, 4.8],
      [OFFICE_WIDTH + distance, 3.5, OFFICE_WIDTH + distance, 17.5, 3, 2.8, 3.5],
      [4.0, OFFICE_DEPTH + distance, 22.0, OFFICE_DEPTH + distance, 3, 2.8, 3.5],
    ];
    let index = 0;
    for (const [x0, z0, x1, z1, count, minHeight, maxHeight] of rows) {
      for (let step = 0; step < count; step += 1) {
        const at = count > 1 ? step / (count - 1) : 0.5;
        const seed = index + 1;
        const jitterX = Math.sin(seed * 12.9898) * 0.16;
        const jitterZ = Math.sin(seed * 78.233) * 0.16;
        const height = minHeight + (maxHeight - minHeight) * (0.5 + 0.5 * Math.sin(seed * 2.4));
        this.surroundings.add(
          this.tree(x0 + (x1 - x0) * at + jitterX, z0 + (z1 - z0) * at + jitterZ, height, index * 1.7),
        );
        index += 1;
      }
    }
    this.treeCount = index;

    const bushes: [number, number, number][] = [
      [-14.4, -14.4, 0.55],
      [40.4, -14.4, 0.5],
      [-14.4, 35.4, 0.5],
      [40.4, 35.4, 0.55],
    ];
    for (const [x, z, size] of bushes) this.surroundings.add(this.bush(x, z, size));

    this.buildPen();
    this.buildBirds();
    this.surroundings.add(this.sunDisc);
  }

  /** Straight-line air waypoint somewhere around the building. */
  private birdWaypoint(rng: () => number): THREE.Vector3 {
    const angle = rng() * Math.PI * 2;
    const radius = 6 + rng() * 11;
    return new THREE.Vector3(
      OFFICE_WIDTH / 2 + Math.cos(angle) * radius,
      7.5 + rng() * 4.5,
      OFFICE_DEPTH / 2 + Math.sin(angle) * radius * 0.85,
    );
  }

  /** Tree crowns, or a lawn patch; some lawn landings fall inside the pet pen. */
  private pickPerch(rng: () => number): PerchSpot {
    if (this.perches.length > 0 && rng() < 0.6) {
      return this.perches[Math.floor(rng() * this.perches.length)]!;
    }
    if (rng() < 0.5) {
      return {
        x: PEN.x0 + 0.9 + rng() * (PEN.x1 - PEN.x0 - 1.8),
        y: GARDEN_TOP + 0.09,
        z: PEN.z0 + 0.9 + rng() * (PEN.z1 - PEN.z0 - 1.8),
        ground: true,
      };
    }
    const pad = 1.5;
    for (let tries = 0; tries < 12; tries += 1) {
      const x = -13 + rng() * (OFFICE_WIDTH + 26);
      const z = -13 + rng() * (OFFICE_DEPTH + 26);
      const inside = x > -pad && x < OFFICE_WIDTH + pad && z > -pad && z < OFFICE_DEPTH + pad;
      if (!inside) return { x, y: GARDEN_TOP + 0.07, z, ground: true };
    }
    return { x: -6, y: GARDEN_TOP + 0.07, z: -6, ground: true };
  }

  private perchAt(bird: BirdRef, spot: PerchSpot): void {
    bird.state = 'perch';
    bird.perch = spot;
    bird.group.position.set(spot.x, spot.y, spot.z);
    bird.group.rotation.y = bird.rng() * Math.PI * 2;
    bird.group.rotation.z = 0;
    bird.hopT = -1;
    bird.hopTimer = 0.4 + bird.rng() * 0.8;
    // Lawn landings linger: the bird is looking for food down there.
    bird.timer = spot.ground ? 6 + bird.rng() * 8 : 3 + bird.rng() * 7;
  }

  /** Cruising birds mostly pick another air point; sometimes one drops onto a perch. */
  private chooseNextTarget(bird: BirdRef): void {
    if (bird.rng() < 0.45) {
      const spot = this.pickPerch(bird.rng);
      bird.perch = spot;
      bird.target.set(spot.x, spot.y + 0.2, spot.z);
    } else {
      bird.perch = null;
      bird.target.copy(this.birdWaypoint(bird.rng));
    }
  }

  /** Leaves a perch, startled or done resting, and climbs to a fresh waypoint. */
  private takeOff(bird: BirdRef): void {
    bird.state = 'fly';
    bird.perch = null;
    bird.hopT = -1;
    bird.group.rotation.z = 0;
    bird.target.copy(this.birdWaypoint(bird.rng));
  }

  /** Short hops between pecks while the bird is feeding on the ground. */
  private forage(bird: BirdRef, dt: number): void {
    if (bird.hopT >= 0) {
      bird.hopT = Math.min(1, bird.hopT + dt * 4);
      bird.group.position.lerpVectors(bird.hopFrom, bird.hopTo, bird.hopT);
      bird.group.position.y += Math.sin(bird.hopT * Math.PI) * 0.16;
      if (bird.hopT >= 1 && bird.perch) {
        bird.hopT = -1;
        bird.perch.x = bird.hopTo.x;
        bird.perch.z = bird.hopTo.z;
        bird.hopTimer = 0.6 + bird.rng() * 1.4;
      }
      return;
    }

    bird.hopTimer -= dt;
    if (bird.hopTimer > 0) return;

    const angle = bird.rng() * Math.PI * 2;
    const distance = 0.35 + bird.rng() * 0.55;
    bird.hopFrom.copy(bird.group.position);
    bird.hopTo.set(
      bird.group.position.x + Math.cos(angle) * distance,
      bird.group.position.y,
      bird.group.position.z + Math.sin(angle) * distance,
    );
    bird.group.rotation.y = Math.atan2(-Math.sin(angle), Math.cos(angle));
    bird.hopT = 0;
  }

  private buildBirds(): void {
    const material = mat(0x39424a, { roughness: 0.8 });
    const count = 5;
    for (let index = 0; index < count; index += 1) {
      const rng = mulberry32(0x9e3779b9 + index * 7919);
      const group = new THREE.Group();
      group.scale.setScalar(1.15 + rng() * 0.45);

      const body = box(0.34, 0.05, 0.07, material);
      body.castShadow = false;
      body.receiveShadow = false;
      group.add(body);

      const wings: THREE.Object3D[] = [];
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        const wing = box(0.3, 0.014, 0.34, material, 0, 0, side * 0.2);
        wing.castShadow = false;
        wing.receiveShadow = false;
        pivot.add(wing);
        group.add(pivot);
        wings.push(pivot);
      }

      const bird: BirdRef = {
        group,
        wings,
        state: 'fly',
        target: this.birdWaypoint(rng),
        perch: null,
        speed: 2.6 + rng() * 1.4,
        heading: rng() * Math.PI * 2,
        timer: 0,
        phase: rng() * Math.PI * 2,
        rng,
        hopT: -1,
        hopTimer: 0,
        hopFrom: new THREE.Vector3(),
        hopTo: new THREE.Vector3(),
      };

      // Some birds start on the lawn or in a tree, so the scene opens with both.
      if (index < 2) {
        this.perchAt(bird, this.pickPerch(rng));
      } else {
        group.position.copy(this.birdWaypoint(rng));
      }
      this.birds.push(bird);
      this.surroundings.add(group);
    }
    this.birdCount = count;
  }

  private tree(x: number, z: number, height: number, phase: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, GARDEN_TOP, z);
    g.add(this.contact(0, 0, height * 0.5, height * 0.5, 0.2, 0.012));

    const trunkHeight = height * 0.5;
    g.add(cyl(0.07, 0.13, trunkHeight, mat(C.treeTrunk, { roughness: 1 }), 0, trunkHeight / 2, 0, 7));

    const canopy = new THREE.Group();
    canopy.position.y = trunkHeight + height * 0.18;
    const radius = height * 0.27;
    const blobs: [number, number, number, number][] = [
      [0, 0.12, 0, 1],
      [radius * 0.62, -0.08, radius * 0.18, 0.78],
      [-radius * 0.55, -0.02, -radius * 0.22, 0.7],
      [radius * 0.08, radius * 0.5, -radius * 0.1, 0.6],
    ];
    blobs.forEach(([bx, by, bz, size], index) => {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * size, 0),
        index % 2 === 0 ? M.treeLeaf : M.treeLeafLight,
      );
      leaf.position.set(bx, by, bz);
      leaf.scale.set(1.2, 0.82, 1.2);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      canopy.add(leaf);
    });

    // A crown a bird can settle on, just clear of the top leaf blob.
    this.perches.push({
      x,
      y: GARDEN_TOP + canopy.position.y + 0.12 + radius * 0.82 + 0.06,
      z,
      ground: false,
    });

    g.add(canopy);
    this.plants.push({ node: canopy, phase });
    return g;
  }

  private bush(x: number, z: number, size: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, GARDEN_TOP, z);
    const blobs: [number, number, number, number][] = [
      [0, 0, 0, 1],
      [size * 0.75, -0.08, size * 0.2, 0.7],
      [-size * 0.6, -0.1, -size * 0.15, 0.62],
    ];
    blobs.forEach(([bx, by, bz, scale], index) => {
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(size * scale, 0),
        index % 2 === 0 ? M.treeLeaf : M.treeLeafLight,
      );
      leaf.position.set(bx, size * 0.55 + by, bz);
      leaf.scale.set(1.1, 0.7, 1.1);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      g.add(leaf);
    });
    return g;
  }

  /** Fenced corner paddock with a doghouse, a cat bed and room to run. */
  private buildPen(): void {
    const w = PEN.x1 - PEN.x0;
    const d = PEN.z1 - PEN.z0;
    const hw = w / 2;
    const hd = d / 2;
    const g = new THREE.Group();
    g.position.set((PEN.x0 + PEN.x1) / 2, GARDEN_TOP, (PEN.z0 + PEN.z1) / 2);
    this.surroundings.add(g);

    const sand = mat(0xd9c6a0, { roughness: 1 });
    g.add(rbox(w, 0.06, d, 0.4, sand, 0, 0.045, 0));

    const postAt = (x: number, z: number) => {
      g.add(rbox(0.09, 0.62, 0.09, 0.02, M.oak, x, 0.31, z));
    };
    const railBetween = (ax: number, az: number, bx: number, bz: number) => {
      const length = Math.hypot(bx - ax, bz - az);
      for (const y of [0.24, 0.47]) {
        const rail = box(length, 0.055, 0.055, M.oakDark, (ax + bx) / 2, y, (az + bz) / 2);
        rail.rotation.y = Math.atan2(-(bz - az), bx - ax);
        g.add(rail);
      }
    };

    const gate = 0.95;
    for (const z of [-hd, hd]) {
      for (const x of [-hw, 0, hw]) postAt(x, z);
      railBetween(-hw, z, 0, z);
      railBetween(0, z, hw, z);
    }
    for (const z of [-hd, -gate, gate, hd]) postAt(hw, z);
    railBetween(hw, -hd, hw, 0);
    railBetween(hw, 0, hw, hd);
    // The side facing the building keeps a gate-sized gap.
    for (const z of [-gate, gate]) postAt(-hw, z);
    railBetween(-hw, -hd, -hw, -gate);
    railBetween(-hw, gate, -hw, hd);

    // Doghouse in the far corner.
    const house = new THREE.Group();
    house.position.set(hw - 1.2, 0, hd - 1.05);
    const wood = mat(0xb58355, { roughness: 0.9 });
    house.add(rbox(1.35, 0.9, 1.05, 0.06, wood, 0, 0.45, 0));
    house.add(box(0.46, 0.56, 0.03, mat(0x2c2622, { roughness: 1 }), -0.69, 0.36, 0));
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(0.98, 0.58, 4),
      mat(0xb4563f, { roughness: 0.85, flatShading: true }),
    );
    roof.position.set(0, 1.18, 0);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.05, 1, 0.92);
    roof.castShadow = true;
    roof.receiveShadow = true;
    house.add(roof);
    g.add(house);

    // Cat bed, scratch post and bowls.
    g.add(cyl(0.42, 0.4, 0.11, mat(0xd8795e, { roughness: 0.95 }), -hw + 1.1, 0.115, hd - 1.0, 18));
    g.add(cyl(0.31, 0.31, 0.07, mat(0xf1e4cc, { roughness: 1 }), -hw + 1.1, 0.2, hd - 1.0, 18));

    const post = new THREE.Group();
    post.position.set(-hw + 1.0, 0, -hd + 1.0);
    post.add(rbox(0.58, 0.08, 0.58, 0.06, M.oakPale, 0, 0.04, 0));
    post.add(cyl(0.06, 0.07, 1.05, mat(0xcdbb9a, { roughness: 1 }), 0, 0.56, 0, 8));
    post.add(rbox(0.5, 0.06, 0.5, 0.05, M.oakPale, 0, 1.1, 0));
    post.add(ball(0.06, mat(0xd8795e), 0.24, 0.92, 0.18, 8));
    g.add(post);

    g.add(cyl(0.14, 0.12, 0.07, mat(0x9fb9c9, { roughness: 0.4 }), -hw + 0.55, 0.08, -0.5, 12));
    g.add(cyl(0.14, 0.12, 0.07, mat(0x9b7a56, { roughness: 1 }), -hw + 0.55, 0.08, 0.25, 12));
    g.add(ball(0.13, mat(0xc9d05e, { roughness: 0.95 }), 0.6, 0.17, -1.3, 10));

    this.addPets();
  }

  private addPets(): void {
    const dogParts = this.dogModel();
    const dog = this.petRef('dog', dogParts, mulberry32(0x51ed), 1.35);
    dog.group.position.set(PEN.x1 - 2.7, GARDEN_TOP, PEN.z1 - 2.5);
    dog.heading = -Math.PI / 2;
    dog.group.rotation.y = dog.heading;
    this.surroundings.add(dog.group);
    this.pets.push(dog);

    const catParts = this.catModel();
    const cat = this.petRef('cat', catParts, mulberry32(0xc47), 1.15);
    cat.group.position.set(PEN.x0 + 1.8, GARDEN_TOP, PEN.z0 + 1.2);
    cat.heading = Math.PI / 2;
    cat.group.rotation.y = cat.heading;
    this.surroundings.add(cat.group);
    this.pets.push(cat);

    this.dogCount = 1;
    this.catCount = 1;
  }

  private petRef(
    kind: 'cat' | 'dog',
    parts: { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D },
    rng: () => number,
    scale: number,
  ): PetRef {
    parts.group.scale.setScalar(scale);
    return {
      group: parts.group,
      kind,
      legs: parts.legs,
      tail: parts.tail,
      target: new THREE.Vector2(),
      state: 'idle',
      prey: null,
      timer: 1 + rng() * 2,
      cooldown: 4 + rng() * 4,
      heading: 0,
      stride: 0,
      phase: rng() * Math.PI * 2,
      rng,
    };
  }

  private dogModel(): { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D } {
    const g = new THREE.Group();
    const fur = mat(0xc9945f, { roughness: 0.95 });
    const cream = mat(0xe8d6b8, { roughness: 0.95 });
    const dark = mat(0x332c28, { roughness: 0.7 });

    g.add(rbox(0.95, 0.36, 0.4, 0.17, fur, 0, 0.52, 0));
    const head = new THREE.Group();
    head.position.set(0.5, 0.68, 0);
    head.add(ball(0.2, fur, 0, 0, 0, 10));
    head.add(rbox(0.24, 0.16, 0.18, 0.06, cream, 0.16, -0.05, 0));
    head.add(ball(0.05, dark, 0.29, -0.02, 0, 8));
    for (const side of [-1, 1]) {
      const ear = rbox(0.12, 0.2, 0.07, 0.03, fur, -0.03, 0.15, side * 0.14);
      ear.rotation.z = -0.28;
      head.add(ear);
      head.add(ball(0.03, dark, 0.16, 0.06, side * 0.1, 6));
    }
    g.add(head);
    g.add(box(0.07, 0.18, 0.42, mat(0xb44a3a, { roughness: 0.8 }), 0.36, 0.62, 0));

    const legs: THREE.Object3D[] = [];
    for (const [x, z] of [
      [0.33, 0.15],
      [0.33, -0.15],
      [-0.33, 0.15],
      [-0.33, -0.15],
    ] as [number, number][]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.42, z);
      pivot.add(box(0.11, 0.42, 0.11, cream, 0, -0.21, 0));
      g.add(pivot);
      legs.push(pivot);
    }

    const tail = new THREE.Group();
    tail.position.set(-0.46, 0.66, 0);
    tail.rotation.z = -0.55;
    tail.add(box(0.34, 0.07, 0.07, fur, -0.17, 0, 0));
    g.add(tail);

    g.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return { group: g, legs, tail };
  }

  private catModel(): { group: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D } {
    const g = new THREE.Group();
    const fur = mat(0xc98a5a, { roughness: 0.95 });
    const cream = mat(0xf0e2c8, { roughness: 0.95 });
    const dark = mat(0x2f2a26, { roughness: 0.7 });

    g.add(rbox(0.72, 0.28, 0.3, 0.13, fur, 0, 0.36, 0));
    const head = new THREE.Group();
    head.position.set(0.4, 0.5, 0);
    head.add(ball(0.16, fur, 0, 0, 0, 10));
    head.add(rbox(0.15, 0.1, 0.13, 0.04, cream, 0.13, -0.04, 0));
    head.add(ball(0.025, mat(0xd8795e), 0.2, -0.01, 0, 6));
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.16, 4),
        mat(0xc98a5a, { roughness: 0.95, flatShading: true }),
      );
      ear.position.set(-0.01, 0.14, side * 0.1);
      ear.rotation.y = Math.PI / 4;
      ear.castShadow = true;
      head.add(ear);
      head.add(ball(0.024, dark, 0.13, 0.04, side * 0.075, 6));
    }
    g.add(head);

    const legs: THREE.Object3D[] = [];
    for (const [x, z] of [
      [0.24, 0.1],
      [0.24, -0.1],
      [-0.24, 0.1],
      [-0.24, -0.1],
    ] as [number, number][]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.3, z);
      pivot.add(box(0.075, 0.3, 0.075, cream, 0, -0.15, 0));
      g.add(pivot);
      legs.push(pivot);
    }

    const tail = new THREE.Group();
    tail.position.set(-0.34, 0.46, 0);
    tail.rotation.z = -1.05;
    tail.add(box(0.5, 0.045, 0.045, fur, -0.25, 0, 0));
    g.add(tail);

    g.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return { group: g, legs, tail };
  }

  // ------------------------------------------------------------- shared ----

  private plant(x: number, z: number, scale: number, phase: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(scale);

    g.add(this.contact(0, 0, 1.0, 1.0, 0.2));
    g.add(cyl(0.28, 0.22, 0.42, mat(0xc98d6a), 0, 0.21, 0, 14));
    g.add(cyl(0.24, 0.24, 0.05, mat(C.soil), 0, 0.43, 0, 14));
    g.add(cyl(0.035, 0.045, 0.9, mat(0x8a6a4a), 0, 0.88, 0, 8));

    const leaves = new THREE.Group();
    leaves.position.y = 1.2;
    const leafA = mat(C.leaf, { roughness: 0.85, flatShading: true });
    const leafB = mat(C.leafLight, { roughness: 0.85, flatShading: true });
    const blobs: [number, number, number, number][] = [
      [0, 0.26, 0, 0.55],
      [0.32, 0.06, 0.12, 0.4],
      [-0.3, 0.12, -0.16, 0.42],
      [0.05, 0.44, -0.2, 0.35],
    ];
    blobs.forEach(([bx, by, bz, size], i) => {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), i % 2 === 0 ? leafA : leafB);
      leaf.position.set(bx, by, bz);
      leaf.scale.set(1.25, 0.6, 1.25);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      leaves.add(leaf);
    });
    g.add(leaves);
    this.plants.push({ node: leaves, phase });
    return g;
  }

  private chair(x: number, z: number, rotation: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotation;

    const fabric = M.sageDeep;
    g.add(rbox(0.56, 0.09, 0.52, 0.05, fabric, 0, 0.52, 0));
    const back = rbox(0.54, 0.64, 0.09, 0.05, fabric, 0, 0.9, -0.21);
    back.rotation.x = -0.1;
    g.add(back);
    g.add(cyl(0.035, 0.035, 0.36, mat(C.metal), 0, 0.33, 0, 8));
    g.add(cyl(0.26, 0.28, 0.05, mat(C.metal), 0, 0.07, 0, 12));
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.add(ball(0.05, mat(0x2f3438), Math.cos(a) * 0.22, 0.05, Math.sin(a) * 0.22, 8));
    }
    return g;
  }

  /**
   * A two-seat couch. Authored in local space with the backrest along +z, so
   * the seats face -z and each seat centre sits at local x = +/- 0.95.
   */
  private sofaRun(x: number, z: number, rotation: number, accent: number = C.mustard): THREE.Group {
    const w = 3.9;
    const g = new THREE.Group();
    g.add(this.contact(0, -0.2, w + 0.4, 1.6, 0.26));
    g.add(rbox(w, 0.42, 1.4, 0.1, M.sage, 0, 0.32, 0));
    g.add(rbox(w, 0.72, 0.3, 0.1, M.sageDeep, 0, 0.86, 0.57));
    for (const dx of [-w / 2 + 0.18, w / 2 - 0.18]) {
      g.add(rbox(0.36, 0.58, 1.4, 0.1, M.sage, dx, 0.58, 0));
    }
    for (const dx of [-0.95, 0.95]) {
      g.add(rbox(1.62, 0.16, 1.1, 0.07, M.cushion, dx, 0.58, -0.05));
    }
    g.add(rbox(0.42, 0.42, 0.16, 0.06, mat(accent), -1.3, 0.78, 0.3));
    g.position.set(x, 0, z);
    g.rotation.y = rotation;
    return g;
  }

  /** Soft blob under a piece of furniture so it does not float. */
  private contact(x: number, z: number, w: number, d: number, opacity = 0.22, y = 0.05): THREE.Mesh {
    let material = this.contactMaterials.get(opacity);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        map: softShadow(),
        transparent: true,
        opacity,
        depthWrite: false,
      });
      this.contactMaterials.set(opacity, material);
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Additive halo around a bulb; opacity is driven by applyDay. */
  private glow(x: number, y: number, z: number, size: number, color = 0xffc27a): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: glowSprite(),
      color,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(size);
    this.glows.push({ material });
    return sprite;
  }

  private mug(x: number, y: number, z: number, color: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.add(cyl(0.05, 0.045, 0.1, mat(color), 0, 0.05, 0, 12));
    g.add(cyl(0.04, 0.04, 0.01, mat(0x6f4a32), 0, 0.102, 0, 12));
    g.add(box(0.025, 0.06, 0.02, mat(color), 0.058, 0.055, 0));
    return g;
  }

  // ---------------------------------------------------------- day / night ---

  applyDay(cycle: DayCycle): void {
    const altitude = cycle.sunAltitude;
    const day = cycle.dayFactor;
    const angle = ((cycle.hours - 6) / 12) * Math.PI;
    const cx = OFFICE_WIDTH / 2;
    const cz = OFFICE_DEPTH / 2;

    if (altitude > -0.05) {
      this.sun.position.set(cx + Math.cos(angle) * 46, Math.max(altitude, 0.06) * 58, cz + 24);
      this.sun.intensity = 0.4 + 2.3 * smoothstep(0.02, 0.4, altitude);
      this.sun.color.setHex(0xff9c58).lerp(new THREE.Color(0xfff6e6), smoothstep(0.05, 0.45, altitude));
    } else {
      this.sun.position.set(cx - 34, 44, cz + 20);
      this.sun.intensity = 0.34;
      this.sun.color.setHex(0x93a8d8);
    }

    this.hemi.color.copy(new THREE.Color(0x1a2338).lerp(new THREE.Color(0xdcefff), day));
    this.hemi.groundColor.copy(new THREE.Color(0x191b22).lerp(new THREE.Color(0xcdb39a), day));
    this.hemi.intensity = 0.2 + 0.54 * day;

    const lamp = smoothstep(0.25, 0.85, 1 - day);
    for (const item of this.lampLights) item.light.intensity = item.strength * lamp;
    for (const material of this.lampMaterials) material.emissiveIntensity = 0.08 + 1.6 * lamp;
    for (const glow of this.glows) glow.material.opacity = 0.035 + 0.4 * lamp;

    this.windowMaterial.color.copy(new THREE.Color(0x1a2438).lerp(new THREE.Color(0xcfeaf6), day));
    this.windowMaterial.emissive.copy(new THREE.Color(0x0b1322).lerp(new THREE.Color(0x9fd3e8), day));
    this.windowMaterial.emissiveIntensity = 0.12 + 0.35 * day;

    // The disc rides the light's own ray, so what you see and what casts the
    // shadows cannot drift apart. It leaves the frame when the sun is overhead;
    // that is the camera looking down at the floor, not a missing sun.
    const ray = this.sun.position.clone().sub(new THREE.Vector3(cx, 0, cz)).normalize();
    this.sunDisc.position.set(cx + ray.x * SUN_DISTANCE, ray.y * SUN_DISTANCE, cz + ray.z * SUN_DISTANCE);
    const up = altitude > -0.05;
    this.sunDisc.visible = up;
    const sunMaterial = this.sunDisc.material as THREE.MeshBasicMaterial;
    sunMaterial.color.copy(this.sun.color);
    const glow = this.sunGlow.material as THREE.SpriteMaterial;
    glow.color.copy(this.sun.color);
    glow.opacity = up ? 0.3 + 0.25 * (1 - smoothstep(0.02, 0.4, altitude)) : 0;
  }

  /** Idle pets pick a new spot, wander there, and now and then burst into a chase. */
  private updatePets(dt: number, t: number): void {
    const cat = this.pets.find((pet) => pet.kind === 'cat');
    const dog = this.pets.find((pet) => pet.kind === 'dog');

    for (const pet of this.pets) pet.cooldown = Math.max(0, pet.cooldown - dt);

    const groundBird = this.birds.find(
      (bird) =>
        bird.state === 'perch' &&
        bird.perch?.ground === true &&
        bird.group.position.x > PEN.x0 - 0.4 &&
        bird.group.position.x < PEN.x1 + 0.4 &&
        bird.group.position.z > PEN.z0 - 0.4 &&
        bird.group.position.z < PEN.z1 + 0.4,
    );
    const hunting = this.pets.some((pet) => pet.state === 'chase' && pet.prey);
    if (groundBird && !hunting) {
      // A bird on the sand wins over whatever the pets were doing; whichever
      // pet is free (or closest to free) goes after it.
      for (const pet of this.pets) {
        if ((pet.state === 'chase' || pet.state === 'flee') && !pet.prey) this.endChase(pet);
      }
      const hunter = this.pets.find((pet) => pet.cooldown <= 0) ?? this.pets[0];
      if (hunter) {
        hunter.state = 'chase';
        hunter.prey = groundBird;
        hunter.timer = 3.5;
        hunter.cooldown = 7 + hunter.rng() * 5;
        this.chaseCount += 1;
        this.birdChaseCount += 1;
      }
    } else if (!this.petsChasing && cat && dog) {
      const gap = cat.group.position.distanceTo(dog.group.position);
      if (gap < 2.6 && cat.cooldown <= 0 && dog.cooldown <= 0) this.startChase(cat, dog);
    }

    for (const pet of this.pets) this.stepPet(pet, dt, t);
  }

  private startChase(cat: PetRef, dog: PetRef): void {
    const dogChases = dog.rng() < 0.5;
    const chaser = dogChases ? dog : cat;
    const runner = dogChases ? cat : dog;
    const duration = 3 + chaser.rng() * 2.4;
    chaser.state = 'chase';
    chaser.timer = duration;
    runner.state = 'flee';
    runner.timer = duration;
    chaser.cooldown = 12 + chaser.rng() * 6;
    runner.cooldown = 10 + runner.rng() * 6;
    this.chaseCount += 1;
  }

  private stepPet(pet: PetRef, dt: number, t: number): void {
    pet.timer -= dt;
    const other = this.pets.find((candidate) => candidate !== pet);

    if (pet.state === 'chase' && pet.prey) {
      if (pet.prey.state !== 'perch' || pet.prey.perch?.ground !== true) {
        // The bird got away; give up and sniff around again.
        this.endChase(pet);
      } else {
        pet.target.set(pet.prey.group.position.x, pet.prey.group.position.z);
      }
      if (pet.timer <= 0) this.endChase(pet);
    } else if (pet.state === 'chase' && other) {
      pet.target.set(other.group.position.x, other.group.position.z);
      if (pet.timer <= 0) this.endChase(pet);
    } else if (pet.state === 'flee' && other) {
      const dx = pet.group.position.x - other.group.position.x;
      const dz = pet.group.position.z - other.group.position.z;
      const length = Math.hypot(dx, dz) || 1;
      pet.target.set(
        pet.group.position.x + (dx / length) * 3,
        pet.group.position.z + (dz / length) * 3,
      );
      this.clampPetTarget(pet.target);
      if (pet.timer <= 0) this.endChase(pet);
    } else if (pet.state === 'idle' && pet.timer <= 0) {
      pet.state = 'wander';
      pet.target.copy(this.penTarget(pet.rng));
      pet.timer = 7;
    }

    const speed =
      pet.state === 'chase'
        ? 3.2
        : pet.state === 'flee'
          ? 3.5
          : pet.state === 'wander'
            ? pet.kind === 'dog'
              ? 1.05
              : 0.9
            : 0;

    const dx = pet.target.x - pet.group.position.x;
    const dz = pet.target.y - pet.group.position.z;
    const distance = Math.hypot(dx, dz);
    let moving = false;
    if (speed > 0 && distance > 0.05) {
      const step = Math.min(speed * dt, distance);
      const nx = dx / distance;
      const nz = dz / distance;
      const desired = Math.atan2(-nz, nx);
      let turn = desired - pet.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      pet.heading += THREE.MathUtils.clamp(turn, -9 * dt, 9 * dt);
      pet.group.rotation.y = pet.heading;
      pet.group.position.x += nx * step;
      pet.group.position.z += nz * step;
      this.keepInPen(pet);
      pet.stride += step * 8;
      moving = true;
    }

    if (pet.state === 'wander' && distance < 0.18) {
      pet.state = 'idle';
      pet.timer = 0.8 + pet.rng() * 2.2;
    }

    const running = pet.state === 'chase' || pet.state === 'flee';
    const swing = moving ? Math.sin(pet.stride) * (running ? 0.7 : 0.42) : 0;
    pet.legs.forEach((leg, index) => {
      leg.rotation.z = swing * (index === 0 || index === 3 ? 1 : -1);
    });
    pet.tail.rotation.y =
      Math.sin(t * (pet.kind === 'dog' ? 9 : 4.5) + pet.phase) * (pet.kind === 'dog' ? 0.55 : 0.4);
    pet.group.position.y = GARDEN_TOP + (moving ? Math.abs(Math.sin(pet.stride)) * 0.03 : 0);
  }

  private endChase(pet: PetRef): void {
    pet.state = 'idle';
    pet.prey = null;
    pet.timer = 0.5 + pet.rng() * 1.2;
  }

  /** Keep a pet on the sand and slide it out of the doghouse when it clips a wall. */
  private keepInPen(pet: PetRef): void {
    const { position } = pet.group;
    position.x = THREE.MathUtils.clamp(position.x, PEN.x0 + 0.9, PEN.x1 - 0.9);
    position.z = THREE.MathUtils.clamp(position.z, PEN.z0 + 0.9, PEN.z1 - 0.9);
    const insideHouse =
      position.x > HOUSE.x0 && position.x < HOUSE.x1 && position.z > HOUSE.z0 && position.z < HOUSE.z1;
    if (!insideHouse) return;

    const exits: [number, number][] = [
      [HOUSE.x0, position.z],
      [HOUSE.x1, position.z],
      [position.x, HOUSE.z0],
      [position.x, HOUSE.z1],
    ];
    const nearest = exits.reduce((best, spot) =>
      Math.hypot(spot[0] - position.x, spot[1] - position.z) <
      Math.hypot(best[0] - position.x, best[1] - position.z)
        ? spot
        : best,
    );
    position.x = nearest[0];
    position.z = nearest[1];
  }

  private clampPetTarget(target: THREE.Vector2): void {
    target.x = THREE.MathUtils.clamp(target.x, PEN.x0 + 0.9, PEN.x1 - 0.9);
    target.y = THREE.MathUtils.clamp(target.y, PEN.z0 + 0.9, PEN.z1 - 0.9);
  }

  private penTarget(rng: () => number): THREE.Vector2 {
    for (let tries = 0; tries < 24; tries += 1) {
      const x = PEN.x0 + 1 + rng() * (PEN.x1 - PEN.x0 - 2);
      const z = PEN.z0 + 1 + rng() * (PEN.z1 - PEN.z0 - 2);
      const inHouse =
        x > HOUSE.x0 - 0.35 && x < HOUSE.x1 + 0.35 && z > HOUSE.z0 - 0.35 && z < HOUSE.z1 + 0.35;
      if (!inHouse) return new THREE.Vector2(x, z);
    }
    return new THREE.Vector2((PEN.x0 + PEN.x1) / 2, (PEN.z0 + PEN.z1) / 2);
  }

  update(dt: number, workingSpots: ReadonlySet<string>, gaming: boolean): void {
    this.elapsed += dt;
    const t = this.elapsed;

    for (const screen of this.screens) {
      const active = workingSpots.has(screen.spotId);
      if (active !== screen.active) {
        screen.active = active;
        const map = active ? screen.typing.texture : screen.idle;
        screen.material.map = map;
        screen.material.emissiveMap = map;
        screen.material.emissiveIntensity = active ? 1.25 : 0.06;
      }
      if (active) screen.typing.update(dt);
    }

    if (this.tvMaterial && this.tvChannels.length > 0) {
      this.tvSlideAge += dt;
      if (this.tvSlideAge >= 6.5) {
        this.tvSlideAge = 0;
        this.tvSlideIndex = (this.tvSlideIndex + 1) % this.tvChannels.length;
        if (this.tvLight) this.tvLight.color.setHex(this.tvChannels[this.tvSlideIndex]!.accent);
      }

      const slide = this.tvChannels[this.tvSlideIndex]!;
      const glitching = this.tvSlideAge < 0.2;
      const map = glitching
        ? (this.tvStatic[Math.floor(t * 38) % this.tvStatic.length] ?? slide.texture)
        : slide.texture;
      if (map !== this.tvTexture) {
        this.tvTexture = map;
        this.tvMaterial.map = map;
        this.tvMaterial.emissiveMap = map;
      }
      this.tvMaterial.emissiveIntensity = glitching ? 1.35 : 0.9 + Math.sin(t * 2.2) * 0.04;
    }
    if (this.tvLight) {
      this.tvLight.intensity =
        (gaming ? 0.95 : 0.55) + Math.sin(t * 3.4) * 0.06 + (this.tvSlideAge < 0.2 ? 0.45 : 0);
    }

    for (const puff of this.steam) {
      const cycle = (t * 0.32 + puff.phase) % 1;
      puff.mesh.position.y = puff.baseY + cycle * 0.95;
      puff.mesh.position.x = puff.baseX + Math.sin(cycle * 6 + puff.phase * 3) * 0.05;
      puff.mesh.position.z = puff.baseZ + Math.cos(cycle * 5 + puff.phase * 2) * 0.04;
      (puff.mesh.material as THREE.MeshStandardMaterial).opacity = Math.sin(cycle * Math.PI) * 0.24;
    }

    for (const plant of this.plants) {
      plant.node.rotation.z = Math.sin(t * 0.6 + plant.phase) * 0.02;
    }

    this.updatePets(dt, t);

    for (const bird of this.birds) {
      if (bird.state === 'perch') {
        bird.timer -= dt;
        // Wings tuck up against the body instead of beating.
        bird.wings[0]!.rotation.x = -1.25;
        bird.wings[1]!.rotation.x = 1.25;

        if (bird.perch?.ground) {
          // Feeding on the lawn: peck between hops, and bolt if a pet closes in.
          const peck = Math.sin(t * 7 + bird.phase);
          bird.group.rotation.z = peck > 0.55 ? -0.34 * ((peck - 0.55) / 0.45) : 0;
          const threatened = this.pets.some(
            (pet) => pet.group.position.distanceTo(bird.group.position) < 1.4,
          );
          if (threatened) {
            this.birdEscapeCount += 1;
            this.takeOff(bird);
            continue;
          }
          this.forage(bird, dt);
        } else {
          bird.group.rotation.z = 0;
        }

        if (bird.timer <= 0) this.takeOff(bird);
        continue;
      }

      const delta = bird.target.clone().sub(bird.group.position);
      const distance = delta.length();
      const step = Math.min(bird.speed * dt, distance);
      if (distance > 0.001) {
        // Ease the heading around curves; a bird should bank, not snap.
        const desired = Math.atan2(-delta.z, delta.x);
        let turn = desired - bird.heading;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        bird.heading += THREE.MathUtils.clamp(turn, -3.2 * dt, 3.2 * dt);
        bird.group.rotation.y = bird.heading;
        bird.group.position.addScaledVector(delta.normalize(), step);
      }

      const climbing = delta.y > 0.4;
      const flap = Math.sin(t * (climbing ? 10.5 : 6.5) + bird.phase) * (climbing ? 0.7 : 0.4);
      bird.wings[0]!.rotation.x = flap;
      bird.wings[1]!.rotation.x = -flap;

      if (distance <= step + 0.05) {
        if (bird.perch) this.perchAt(bird, bird.perch);
        else this.chooseNextTarget(bird);
      }
    }
  }
}
