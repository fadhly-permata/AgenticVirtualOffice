import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DayCycle } from '../src/core/dayNight';
import { OfficeWorld } from '../src/world/office';

describe('OfficeWorld', () => {
  it('builds a finite, populated diorama without a renderer', () => {
    const world = new OfficeWorld();
    let meshes = 0;

    world.root.traverse((object) => {
      expect(Number.isFinite(object.position.x)).toBe(true);
      expect(Number.isFinite(object.position.y)).toBe(true);
      expect(Number.isFinite(object.position.z)).toBe(true);
      expect(Number.isFinite(object.scale.x)).toBe(true);
      if (object instanceof THREE.Mesh) meshes += 1;
    });

    expect(meshes).toBeGreaterThan(200);

    const bounds = new THREE.Box3().setFromObject(world.root);
    expect(bounds.min.x).toBeCloseTo(-0.8, 1);
    expect(bounds.max.x).toBeCloseTo(26.8, 1);
    expect(bounds.min.z).toBeCloseTo(-0.8, 1);
    expect(bounds.max.z).toBeCloseTo(21.8, 1);
    expect(bounds.min.y).toBeLessThan(0);
    expect(bounds.max.y).toBeGreaterThan(4);
  });

  it('applies every time of day and animation tick safely', () => {
    const world = new OfficeWorld();
    for (const hour of [0, 4, 6.5, 12, 18.2, 23]) {
      expect(() => world.applyDay(new DayCycle(hour, 0))).not.toThrow();
    }
    expect(() => world.update(1 / 60, new Set(['desk-1', 'desk-4']), true)).not.toThrow();
  });
});
