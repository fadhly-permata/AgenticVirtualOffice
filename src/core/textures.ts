import * as THREE from 'three';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const clampByte = (value: number): number => Math.round(clamp01(value / 255) * 255);

function hash(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

type Painter = (u: number, v: number, x: number, y: number) => [number, number, number];
type Alpha = (u: number, v: number) => number;

function dataTexture(
  size: number,
  paint: Painter,
  alpha: Alpha | null,
  repeatX: number,
  repeatY: number,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const [r, g, b] = paint(u, v, x, y);
      const index = (y * size + x) * 4;
      data[index] = clampByte(r);
      data[index + 1] = clampByte(g);
      data[index + 2] = clampByte(b);
      data[index + 3] = alpha ? Math.round(255 * clamp01(alpha(u, v))) : 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const cache = new Map<string, THREE.DataTexture>();

function cached(key: string, build: () => THREE.DataTexture): THREE.DataTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const texture = build();
  cache.set(key, texture);
  return texture;
}

/**
 * Soft wood grain. Kept near white so it multiplies with the palette colour
 * instead of replacing it.
 */
export function woodGrain(repeatX = 1, repeatY = 1): THREE.DataTexture {
  return cached(`wood:${repeatX}:${repeatY}`, () =>
    dataTexture(
      128,
      (u, v, x, y) => {
        const warp = 0.5 + 0.5 * Math.sin(v * Math.PI * 6.4 + Math.sin(u * Math.PI * 4) * 1.7);
        const grain = 0.5 + 0.5 * Math.sin(v * Math.PI * 26 + warp * 1.6);
        const fleck = hash(x, y) * 7;
        const value = 228 - grain * 20 - fleck;
        return [value, value * 0.985, value * 0.95];
      },
      null,
      repeatX,
      repeatY,
    ),
  );
}

/** Fine upholstery weave, used on sofas, chairs and the rug. */
export function fabricWeave(repeatX = 1, repeatY = 1): THREE.DataTexture {
  return cached(`fabric:${repeatX}:${repeatY}`, () =>
    dataTexture(
      64,
      (u, v, x, y) => {
        const thread = Math.sin(u * Math.PI * 2 * 18) * 0.5 + Math.sin(v * Math.PI * 2 * 18) * 0.5;
        const value = 242 - thread * 6 - hash(x, y) * 6;
        return [value, value, value * 0.99];
      },
      null,
      repeatX,
      repeatY,
    ),
  );
}

/** Barely-there plaster mottling so big wall planes do not read as flat paint. */
export function plasterNoise(repeatX = 1, repeatY = 1): THREE.DataTexture {
  return cached(`plaster:${repeatX}:${repeatY}`, () =>
    dataTexture(
      64,
      (u, _v, x, y) => {
        const value = 249 - hash(x, y) * 5 - Math.sin(u * Math.PI * 8) * 1.4;
        return [value, value, value * 0.997];
      },
      null,
      repeatX,
      repeatY,
    ),
  );
}

/** Radial white blob for additive light halos around bulbs. */
export function glowSprite(): THREE.DataTexture {
  return cached('glow', () =>
    dataTexture(
      64,
      () => [255, 255, 255],
      (u, v) => {
        const distance = Math.hypot(u - 0.5, v - 0.5) * 2;
        return Math.pow(clamp01(1 - distance), 2.4);
      },
      1,
      1,
    ),
  );
}

/** Radial alpha blob (black RGB) used for cheap contact shadows. */
export function softShadow(): THREE.DataTexture {
  return cached('shadow', () =>
    dataTexture(
      96,
      () => [0, 0, 0],
      (u, v) => {
        const distance = Math.hypot(u - 0.5, v - 0.5) * 2;
        return Math.pow(clamp01(1 - distance), 1.7) * 0.92;
      },
      1,
      1,
    ),
  );
}

type Rgb = [number, number, number];

function mixRgb(a: Rgb, b: Rgb, amount: number): Rgb {
  const t = clamp01(amount);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function rectTexture(width: number, height: number, paint: Painter): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x / width, 1 - y / (height - 1), x, y);
      const index = (y * width + x) * 4;
      data[index] = clampByte(r);
      data[index + 1] = clampByte(g);
      data[index + 2] = clampByte(b);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Flat, near-black standby screen. No scanlines or block patterns. */
export function idleScreenTexture(): THREE.DataTexture {
  return cached('screen-idle', () =>
    dataTexture(
      48,
      (u, v) => {
        const dx = (u - 0.5) * 2;
        const dy = (v - 0.5) * 2;
        const vignette = Math.max(0.22, 1 - (dx * dx + dy * dy) * 0.5);
        return [3 + 6 * vignette, 6 + 9 * vignette, 10 + 13 * vignette];
      },
      null,
      1,
      1,
    ),
  );
}

const TV_WIDTH = 168;
const TV_HEIGHT = 90;

export interface TvSlide {
  texture: THREE.DataTexture;
  /** Colour the TV throws into the room. */
  accent: number;
}

let slideCache: TvSlide[] | null = null;

/** Eight procedurally drawn channels, cycled by the TV. */
export function tvSlides(): TvSlide[] {
  if (slideCache) return slideCache;

  const bars: Rgb[] = [
    [235, 235, 230],
    [235, 210, 65],
    [65, 205, 220],
    [70, 200, 115],
    [210, 80, 190],
    [220, 70, 60],
    [55, 75, 205],
  ];

  slideCache = [
    {
      accent: 0xbcd8ff,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v) => {
        if (v < 0.72) return bars[Math.min(bars.length - 1, Math.floor(u * bars.length))]!;
        if (v < 0.83) return [16, 17, 20];
        return Math.floor(u * 8) % 2 === 0 ? [210, 210, 205] : [18, 18, 20];
      }),
    },
    {
      accent: 0xff9d5c,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v) => {
        const horizon = 0.6;
        if (v < horizon) {
          const sky = mixRgb([38, 42, 92], [255, 154, 92], Math.pow(v / horizon, 0.8));
          const sun = Math.hypot((u - 0.7) * 1.87, v - 0.36);
          if (sun < 0.105) return [255, 228, 164];
          if (sun < 0.18) return mixRgb([255, 188, 118], sky, (sun - 0.105) / 0.075 * 0.6);
          const near = horizon - 0.05 - 0.035 * Math.sin(u * 9.5 + 0.6);
          if (v > near) return mixRgb([58, 46, 92], [28, 24, 54], (v - near) / 0.05);
          const far = horizon - 0.15 - 0.05 * Math.sin(u * 6.2 + 2.1);
          if (v > far) return mixRgb([78, 62, 116], [52, 42, 88], (v - far) / 0.1);
          return sky;
        }
        const t = (v - horizon) / (1 - horizon);
        const water = mixRgb([238, 144, 104], [30, 34, 78], smooth(t));
        const shimmer = Math.sin(u * 42 + t * 14) * 0.5 + 0.5;
        const centre = Math.max(0, 1 - Math.abs(u - 0.7) * 5.2);
        return shimmer > 0.64 && centre > 0.15 && t < 0.4
          ? mixRgb(water, [255, 208, 148], centre * 0.6)
          : water;
      }),
    },
    {
      accent: 0x6d84ff,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v, x, y) => {
        const sky = mixRgb([4, 7, 20], [30, 22, 58], smooth(v));
        const moon = Math.hypot((u - 0.78) * 1.87, v - 0.2);
        if (moon < 0.085) return [242, 242, 224];
        if (moon < 0.13) return mixRgb([190, 198, 224], sky, (moon - 0.085) / 0.045);
        if (v < 0.55 && hash(x * 3.1, y * 2.7) > 0.93) return [220, 230, 255];

        const cell = u * 16;
        const building = Math.floor(cell);
        if (hash(building, 8.1) > 0.78) return sky;
        const height = 0.14 + hash(building, 4.2) * 0.4;
        const roof = 0.92 - height;
        if (v < roof) return sky;

        const fx = cell - building;
        const wx = Math.floor(fx * 4);
        const wy = Math.floor((v - roof) * 40);
        const lit = fx > 0.18 && fx < 0.82 && wy % 2 === 0 && hash(building * 9 + wx, wy * 4) > 0.42;
        return lit ? [255, 206, 120] : mixRgb([10, 14, 30], [18, 22, 42], (v - roof) / height);
      }),
    },
    {
      accent: 0x4fd1e0,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v) => {
        const horizon = 0.55;
        if (v < horizon) {
          const sky = mixRgb([112, 192, 236], [238, 246, 232], smooth(v / horizon));
          const sun = Math.hypot((u - 0.3) * 1.87, v - 0.24);
          if (sun < 0.075) return [255, 250, 214];
          if (sun < 0.14) return mixRgb([255, 248, 200], sky, (sun - 0.075) / 0.065);
          return sky;
        }
        const t = (v - horizon) / (1 - horizon);
        const sea = mixRgb([38, 152, 170], [10, 52, 92], smooth(t));
        const wave = Math.sin(u * 38 + t * 9) * Math.sin(u * 12 - t * 5);
        return wave > 0.62 ? mixRgb(sea, [224, 250, 255], 0.32) : sea;
      }),
    },
    {
      accent: 0xff6b6b,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v) => {
        const backdrop = mixRgb([16, 30, 55], [8, 14, 30], smooth(v));
        const glow = Math.max(0, 1 - Math.hypot((u - 0.5) * 1.87, v - 0.42) * 1.4);
        let color = mixRgb(backdrop, [40, 80, 130], glow * 0.5);

        if (v > 0.64) color = mixRgb([30, 55, 90], [14, 24, 44], (v - 0.64) / 0.36);
        for (const anchor of [0.42, 0.58]) {
          if (Math.hypot((u - anchor) * 1.87, v - 0.45) < 0.052) color = [232, 192, 162];
          if (v > 0.52 && v < 0.7 && Math.abs(u - anchor) < 0.055) color = [36, 46, 68];
        }

        if (v > 0.72 && v < 0.84) {
          color = u < 0.12 ? [200, 40, 45] : mixRgb([15, 40, 80], [30, 70, 130], u);
          if (u > 0.12 && v > 0.765 && v < 0.795 && (u * 34) % 3 < 1.8) color = [235, 240, 248];
        }
        if (Math.hypot((u - 0.88) * 1.87, v - 0.12) < 0.042) color = [210, 40, 50];
        return color;
      }),
    },
    {
      accent: 0x9a6bff,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v, x, y) => {
        let color = mixRgb([6, 5, 18], [20, 10, 38], v);
        if (hash(x * 1.3, y * 2.1) > 0.92) color = [200, 215, 255];
        const nebula = Math.hypot((u - 0.25) * 1.87, v - 0.72);
        if (nebula < 0.35) color = mixRgb(color, [82, 32, 104], (1 - nebula / 0.35) * 0.35);

        const px = (u - 0.62) * 1.87;
        const py = v - 0.45;
        const planet = Math.hypot(px, py);
        const ring = Math.hypot(px / 0.38, py / 0.072);
        if (ring > 0.84 && ring < 1.06 && planet > 0.22) {
          return mixRgb([214, 184, 142], [148, 120, 92], (ring - 0.84) / 0.22);
        }
        if (planet < 0.22) {
          const shade = 0.55 + 0.45 * Math.max(0, 1 - Math.hypot(px + 0.08, py + 0.06) / 0.22);
          const band = Math.sin(py * 46) * 0.05;
          return [212 * shade + band * 255, 154 * shade, 112 * shade];
        }
        return color;
      }),
    },
    {
      accent: 0xff4fa3,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v) => {
        let color = mixRgb([18, 4, 26], [8, 2, 12], v);
        const bars = 18;
        const cell = u * bars;
        const index = Math.floor(cell);
        const fx = cell - index;
        const height = 0.18 + hash(index, 1.3) * 0.55;
        const top = 0.88 - height;
        if (fx > 0.18 && fx < 0.82 && v > top) {
          color = mixRgb([255, 60, 160], [60, 200, 255], (v - top) / height);
        }
        if (v > 0.87 && v < 0.9) color = mixRgb(color, [255, 140, 210], 0.4);
        return color;
      }),
    },
    {
      accent: 0x7fe0a0,
      texture: rectTexture(TV_WIDTH, TV_HEIGHT, (u, v) => {
        const horizon = 0.62;
        if (v < horizon) {
          const sky = mixRgb([178, 224, 240], [244, 238, 208], smooth(v / horizon));
          const ridge = horizon - 0.06 - 0.05 * Math.sin(u * 7.3);
          if (v > ridge) return [92, 132, 102];
          return sky;
        }

        const cell = u * 9;
        const tree = Math.floor(cell);
        const fx = cell - tree;
        const height = 0.2 + hash(tree, 7.2) * 0.28;
        const apex = 0.92 - height;
        if (v > apex && Math.abs(fx - 0.5) < (v - apex) * 0.55) return [22, 60, 45];
        return mixRgb([40, 92, 60], [20, 48, 34], (v - horizon) / (1 - horizon));
      }),
    },
  ];

  return slideCache;
}

let staticCache: THREE.DataTexture[] | null = null;

/** Short noise frames used for the channel-change flicker. */
export function tvStaticFrames(): THREE.DataTexture[] {
  if (staticCache) return staticCache;
  staticCache = [0, 1, 2].map((seed) =>
    rectTexture(TV_WIDTH, TV_HEIGHT, (_u, v, x, y) => {
      const noise = hash(x * 1.7 + seed * 13, y * 2.3 + seed * 7);
      const band = Math.sin((v + seed * 0.13) * TV_HEIGHT * 0.8) * 0.12;
      const value = 50 + noise * 160 + band * 90;
      return [value * 0.82, value * 0.9, value];
    }),
  );
  return staticCache;
}
