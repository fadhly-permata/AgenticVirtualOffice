import * as THREE from 'three';

/** Central colour palette for the whole diorama. */
export const C = {
  slab: 0xe5d8c5,
  slabEdge: 0xd0bfa7,
  floorWorkspace: 0xd3b795,
  floorMeeting: 0xc8cec2,
  floorPantry: 0xdfd5c5,
  floorLounge: 0xd0b79b,
  seam: 0xb2946f,
  wall: 0xf5efe6,
  wallShade: 0xe7dece,
  trim: 0xfbf7f1,
  frame: 0x3d4a50,
  metal: 0x9aa3a8,
  dark: 0x2b3238,
  wood: 0xbb8a5c,
  woodDark: 0x97693f,
  deskTop: 0xeee0c9,
  sage: 0x8fae9b,
  sageDeep: 0x6d8f7c,
  coral: 0xe07a5f,
  mustard: 0xe2b44a,
  glass: 0xb6dfee,
  leaf: 0x5f8f63,
  leafLight: 0x7fa970,
  soil: 0x59493c,
  paper: 0xfdfaf4,
  rug: 0xc9a58a,
  rugEdge: 0xb08c72,
  porcelain: 0xf3efe7,
  screenOff: 0x1c242c,
  screenOn: 0xcdefff,
} as const;

export interface MatOptions {
  roughness?: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  flatShading?: boolean;
  depthWrite?: boolean;
  side?: THREE.Side;
  /** Colour map, multiplied with `color`. */
  map?: THREE.Texture | null;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared standard material, cached by colour + options. */
export function mat(color: number, opts: MatOptions = {}): THREE.MeshStandardMaterial {
  const { map, ...rest } = opts;
  const key = `${color}|${JSON.stringify(rest)}|${map?.uuid ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const material = new THREE.MeshStandardMaterial({
    color,
    map: map ?? null,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    flatShading: opts.flatShading ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
    side: opts.side ?? THREE.FrontSide,
  });
  if (opts.emissive !== undefined) {
    material.emissive = new THREE.Color(opts.emissive);
    material.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  cache.set(key, material);
  return material;
}

/** Un-cached emissive material, used when the scene animates it. */
export function liveScreenMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.2,
    roughness: 0.35,
    metalness: 0,
  });
}
