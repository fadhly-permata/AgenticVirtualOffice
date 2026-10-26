import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Shadowed box geometry helper. */
export function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Rounded box for soft, toy-like furniture silhouettes. */
export function rbox(
  w: number,
  h: number,
  d: number,
  radius: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const safe = Math.min(radius, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, safe), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cyl(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 16,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function ball(
  radius: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  segments = 16,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2)), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Flat plane, optionally facing a horizontal direction. */
export function plane(
  w: number,
  h: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const child of children) g.add(child);
  return g;
}
