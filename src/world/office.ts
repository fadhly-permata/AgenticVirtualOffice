import * as THREE from 'three';
import type { DayCycle } from '../core/dayNight';
import { smoothstep } from '../core/math';
import { C, mat } from '../core/palette';
import {
  fabricWeave,
  glowSprite,
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
  DESK_SEAT_Z,
  DESK_X,
  DESK_Z,
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

/** Window band shared by the glass panes and the wall cut-outs. */
const WINDOW_CENTER_Y = 2.32;
const WINDOW_HEIGHT = 1.95;
const WINDOW_OPEN_Y0 = 1.3;
const WINDOW_OPEN_Y1 = 3.34;

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
} as const;

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
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;

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

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xdff0ff, 0xcdb59a, 0.8);
    this.sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -24;
    this.sun.shadow.camera.right = 24;
    this.sun.shadow.camera.top = 24;
    this.sun.shadow.camera.bottom = -24;
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

    this.root.add(this.buildBase());
    this.root.add(this.buildFloors());
    this.root.add(this.buildOuterWalls());
    this.root.add(this.buildPartitions());
    this.root.add(this.buildWorkspace());
    this.root.add(this.buildMeeting());
    this.root.add(this.buildPantry());
    this.root.add(this.buildLounge());
    this.root.add(this.buildPendants());
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
    DESK_X.forEach((x, i) => g.add(this.buildDesk(x, i)));
    g.add(this.buildCabinet(1.55, 1.15));
    g.add(this.plant(12.0, 1.2, 1.1, 0.4));
    g.add(this.plant(0.9, 9.6, 0.85, 1.7));
    return g;
  }

  private buildDesk(x: number, index: number): THREE.Group {
    const g = new THREE.Group();
    const z = DESK_Z;

    g.add(rbox(1.9, 0.09, 1.0, 0.04, M.deskTop, x, 0.74, z));
    g.add(this.contact(x, z, 2.55, 1.65, 0.26));
    g.add(box(0.07, 0.72, 0.86, mat(C.metal), x - 0.86, 0.36, z));
    g.add(box(0.07, 0.72, 0.86, mat(C.metal), x + 0.86, 0.36, z));

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

    g.add(box(0.36, 0.03, 0.2, mat(C.dark), x, 0.795, z - 0.34));
    g.add(box(0.06, 0.3, 0.06, mat(C.dark), x, 0.95, z - 0.34));
    g.add(rbox(0.94, 0.58, 0.06, 0.02, mat(C.dark), x, 1.28, z - 0.34));
    g.add(plane(0.84, 0.47, screenMat, x, 1.28, z - 0.303));

    g.add(rbox(0.6, 0.03, 0.18, 0.012, mat(0x39424a), x, 0.795, z + 0.2));
    g.add(rbox(0.09, 0.035, 0.14, 0.03, mat(0x39424a), x + 0.42, 0.795, z + 0.17));

    const pad = box(0.3, 0.012, 0.22, mat(C.paper), x + 0.5, 0.8, z - 0.12);
    pad.rotation.y = 0.25;
    g.add(pad);
    g.add(this.mug(x - 0.62, 0.79, z + 0.06, C.coral));

    if (index === 1) g.add(this.deskLamp(x + 0.72, z - 0.26));
    if (index === 0 || index === 3) g.add(this.smallPlant(x - 0.78, 0.79, z - 0.3));

    g.add(this.chair(x, DESK_SEAT_Z, Math.PI));
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

  /** Soft blob under a piece of furniture so it does not float. */
  private contact(x: number, z: number, w: number, d: number, opacity = 0.22): THREE.Mesh {
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
    mesh.position.set(x, 0.05, z);
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

  // (moved to lines 119-122 for correct class structure)


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
  }
}
