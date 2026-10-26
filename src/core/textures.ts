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

/** Simple terminal monitor pattern with scanlines and blocks of text. */
export function monitorScreen(): THREE.DataTexture {
  return cached('monitor-screen', () =>
    dataTexture(
      32,
      (u, v, x, y) => {
        const scanline = Math.floor(v * 32) % 2 === 0 ? 0.8 : 1;
        const block = (Math.floor(u * 16) + Math.floor(v * 8)) % 8;
        const isText = ((x + y * 32) % 7 !== 0) ? 0.1 : 0.9;
        const r = scanline * (0.1 + block * 0.05) * isText;
        const g = scanline * (0.2 + block * 0.07) * isText;
        const b = scanline * (0.3 + block * 0.1) * isText;
        return [r * 255, g * 255, b * 255];
      },
      null,
      1,
      1,
    ),
  );
}

/** Alternative monitor pattern with denser text blocks. */
export function monitorScreenDense(): THREE.DataTexture {
  return cached('monitor-screen-dense', () =>
    dataTexture(
      32,
      (u, v, _x, _y) => {
        const scanline = Math.floor(v * 32) % 2 === 0 ? 0.9 : 1;
        // More blocks: 4x4 grid per character cell
        const block = (Math.floor(u * 8) + Math.floor(v * 4)) % 4;
        // Text appears on every other block for density
        const isText = (Math.floor(u * 8) % 2 === 0) ? 0.8 : 0.3;
        const r = scanline * (0.2 + block * 0.1) * isText;
        const g = scanline * (0.3 + block * 0.15) * isText;
        const b = scanline * (0.4 + block * 0.2) * isText;
        return [r * 255, g * 255, b * 255];
      },
      null,
      1,
      1,
    ),
  );
}

/** Alternative monitor pattern with wider characters. */
export function monitorScreenWide(): THREE.DataTexture {
  return cached('monitor-screen-wide', () =>
    dataTexture(
      32,
      (u, v, _x, _y) => {
        const scanline = Math.floor(v * 32) % 2 === 0 ? 0.7 : 1;
        // Wider blocks: 3 columns per character
        const block = (Math.floor(u * 12) + Math.floor(v * 6)) % 12;
        const isText = ((_x + _y * 32) % 5 !== 0) ? 0.2 : 0.9;
        const r = scanline * (0.15 + block * 0.03) * isText;
        const g = scanline * (0.25 + block * 0.05) * isText;
        const b = scanline * (0.35 + block * 0.07) * isText;
        return [r * 255, g * 255, b * 255];
      },
      null,
      1,
      1,
    ),
  );
}

/** Monitor pattern with vertical text bars. */
export function monitorScreenVertical(): THREE.DataTexture {
  return cached('monitor-screen-vertical', () =>
    dataTexture(
      32,
      (u, v, _x, _y) => {
        const scanline = Math.floor(v * 32) % 2 === 0 ? 0.8 : 1;
        // Vertical bars every 3 characters
        const bar = Math.floor(u * 3) % 3;
        // Text only on leftmost bar
        const isText = bar === 0 ? 0.9 : 0.1;
        const r = scanline * (0.2 + bar * 0.1) * isText;
        const g = scanline * (0.3 + bar * 0.15) * isText;
        const b = scanline * (0.4 + bar * 0.2) * isText;
        return [r * 255, g * 255, b * 255];
      },
      null,
      1,
      1,
    ),
  );
}

/** Monitor pattern with diagonal text gradient. */
export function monitorScreenDiagonal(): THREE.DataTexture {
  return cached('monitor-screen-diagonal', () =>
    dataTexture(
      32,
      (u, v, _x, _y) => {
        const scanline = Math.floor(v * 32) % 2 === 0 ? 0.7 : 1;
        // Diagonal gradient: bottom-left to top-right
        const diag = (Math.floor(u * 4) + Math.floor(v * 4)) % 8;
        const isText = diag !== 0 ? 0.3 : 0.9;
        const r = scanline * (0.1 + diag * 0.05) * isText;
        const g = scanline * (0.2 + diag * 0.07) * isText;
        const b = scanline * (0.3 + diag * 0.1) * isText;
        return [r * 255, g * 255, b * 255];
      },
      null,
      1,
      1,
    ),
  );
}

/** TV screen static + logo pattern. */
export function tvScreen(): THREE.DataTexture {
  return cached('tv-screen', () =>
    dataTexture(
      64,
      (u, v, x, y) => {
        const staticNoise = hash(x * 7, y * 7) * 0.5;
        const lowerLeft = u < 0.5 && v < 0.5 ? 0.3 : 1;
        const centerOval = Math.exp(-((u - 0.5) * 4 + (v - 0.5) * 4) * 3);
        const logo = (Math.sin(x * 15) * Math.cos(y * 15) + 1) / 4;
        const value = 0.1 + staticNoise * 0.3 + lowerLeft * 0.2 + centerOval * 0.3 + logo * 0.2;
        const r = value * 15 + staticNoise * 20;
        const g = value * 25 + staticNoise * 10;
        const b = value * 30 + staticNoise * 5;
        return [r * 255, g * 255, b * 255];
      },
      null,
      1,
      1,
    ),
  );
}
