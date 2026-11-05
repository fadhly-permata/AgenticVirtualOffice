import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DayCycle } from '../src/core/dayNight';
import { OFFICE_DEPTH, OFFICE_WIDTH } from '../src/world/layout';
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

    const bounds = new THREE.Box3().setFromObject(world.building);
    expect(bounds.min.x).toBeCloseTo(-0.8, 1);
    expect(bounds.max.x).toBeCloseTo(26.8, 1);
    expect(bounds.min.z).toBeCloseTo(-0.8, 1);
    expect(bounds.max.z).toBeCloseTo(21.8, 1);
    expect(bounds.min.y).toBeLessThan(0);
    expect(bounds.max.y).toBeGreaterThan(4);
  });

  it('surrounds the building with a garden, trees, birds and a pet pen', () => {
    const world = new OfficeWorld();
    expect(world.treeCount).toBe(12);
    expect(world.birdCount).toBeGreaterThanOrEqual(3);
    expect(world.catCount).toBe(1);
    expect(world.dogCount).toBe(1);

    const bounds = new THREE.Box3().setFromObject(world.surroundings);
    expect(bounds.min.x).toBeLessThan(-14);
    expect(bounds.min.z).toBeLessThan(-14);
    expect(bounds.max.x).toBeGreaterThan(OFFICE_WIDTH + 13);
    expect(bounds.max.z).toBeGreaterThan(OFFICE_DEPTH + 13);
    expect(bounds.max.y).toBeGreaterThan(8);
  });

  it('lets the cat and dog wander and sometimes chase each other', () => {
    const world = new OfficeWorld();
    expect(world.petsChasing).toBe(false);

    let sawChase = false;
    let sawForaging = false;
    let sawDogOutside = false;
    let sawDogBack = false;
    let sawCatOutside = false;
    let sawCatBack = false;
    let sawBallCarried = false;
    let sawGrooming = false;
    const ballHome = world.ballSpot;
    let ballTravel = 0;
    for (let step = 0; step < 1800; step += 1) {
      world.update(0.1, new Set(), false);
      sawChase = sawChase || world.petsChasing;
      sawForaging = sawForaging || world.groundBirdCount > 0;
      if (world.dogsOutside > 0) sawDogOutside = true;
      else if (sawDogOutside) sawDogBack = true;
      if (world.catsOutside > 0) sawCatOutside = true;
      else if (sawCatOutside) sawCatBack = true;
      sawBallCarried = sawBallCarried || world.ballCarried;
      sawGrooming = sawGrooming || world.catGrooming;
      const spot = world.ballSpot;
      ballTravel = Math.max(ballTravel, Math.hypot(spot.x - ballHome.x, spot.z - ballHome.z));
    }
    expect(world.chaseCount).toBeGreaterThan(0);
    expect(sawChase).toBe(true);
    expect(sawForaging).toBe(true);
    expect(world.birdChaseCount).toBeGreaterThan(0);
    expect(world.birdEscapeCount).toBeGreaterThan(0);
    // Both pets slip out the gate to play, then walk themselves back in.
    expect(sawDogOutside).toBe(true);
    expect(sawDogBack).toBe(true);
    expect(sawCatOutside).toBe(true);
    expect(sawCatBack).toBe(true);
    // The dog picks the ball up, carries it, and drops it somewhere new.
    expect(sawBallCarried).toBe(true);
    expect(world.fetchCount).toBeGreaterThan(0);
    expect(ballTravel).toBeGreaterThan(0.5);
    // The cat now and then stops to groom itself.
    expect(sawGrooming).toBe(true);
  });

  it('lets birds wander at random and settle on trees or grass', () => {
    const world = new OfficeWorld();
    expect(world.perchedCount).toBe(2);

    const seen = new Set<number>();
    for (let step = 0; step < 1200; step += 1) {
      world.update(0.1, new Set(), false);
      seen.add(world.perchedCount);
    }
    // Every bird takes off at some point, and at least one lands again.
    expect(seen.has(0)).toBe(true);
    expect([...seen].some((count) => count > 0)).toBe(true);
  });

  it('keeps the visible sun on the light ray', () => {
    const world = new OfficeWorld();
    world.applyDay(new DayCycle(8.1, 0));
    const centre = new THREE.Vector3(OFFICE_WIDTH / 2, 0, OFFICE_DEPTH / 2);
    const light = world.sun.position.clone().sub(centre).normalize();
    const disc = world.sunDisc.position.clone().sub(centre).normalize();

    expect(disc.dot(light)).toBeGreaterThan(0.9999);
    expect(world.sunDisc.visible).toBe(true);

    world.applyDay(new DayCycle(23, 0));
    expect(world.sunDisc.visible).toBe(false);
  });

  it('applies every time of day and animation tick safely', () => {
    const world = new OfficeWorld();
    for (const hour of [0, 4, 6.5, 12, 18.2, 23]) {
      expect(() => world.applyDay(new DayCycle(hour, 0))).not.toThrow();
    }
    expect(() => world.update(1 / 60, new Set(['desk-1', 'desk-4']), true)).not.toThrow();
  });
});
