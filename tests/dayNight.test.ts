import { describe, expect, it } from 'vitest';
import { DayCycle } from '../src/core/dayNight';

describe('DayCycle', () => {
  it('is at full daylight at noon and full night at midnight', () => {
    const clock = new DayCycle(12, 0);
    expect(clock.dayFactor).toBeCloseTo(1, 2);
    expect(clock.nightFactor).toBeCloseTo(0, 2);
    expect(clock.sunAltitude).toBeCloseTo(1, 2);

    clock.setTime(0);
    expect(clock.dayFactor).toBe(0);
    expect(clock.nightFactor).toBe(1);
    expect(clock.sunAltitude).toBeLessThan(0);
  });

  it('advances and wraps around a day', () => {
    const clock = new DayCycle(23.9, 0.2);
    clock.update(2);
    expect(clock.hours).toBeGreaterThanOrEqual(0);
    expect(clock.hours).toBeLessThan(24);
    expect(clock.hours).toBeCloseTo(0.3, 5);
  });

  it('normalises out-of-range times', () => {
    const clock = new DayCycle(8, 0);
    clock.setTime(-3);
    expect(clock.hours).toBeCloseTo(21, 5);
    clock.setTime(27);
    expect(clock.hours).toBeCloseTo(3, 5);
  });

  it('reports phase labels and a padded time', () => {
    const clock = new DayCycle(8.1, 0);
    expect(clock.timeLabel).toBe('08:06');
    expect(clock.phaseLabel).toBe('Pagi');

    clock.setTime(13);
    expect(clock.phaseLabel).toBe('Siang');
    clock.setTime(17.5);
    expect(clock.phaseLabel).toBe('Sore');
    clock.setTime(22);
    expect(clock.phaseLabel).toBe('Malam');
  });

  it('returns valid sky colours that brighten with the sun', () => {
    const clock = new DayCycle(12, 0);
    const noon = clock.sky();
    clock.setTime(0);
    const midnight = clock.sky();

    for (const value of [noon.top, noon.bottom, noon.glow, midnight.top, midnight.bottom]) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(noon.top).not.toBe(midnight.top);
  });

  it('progress stays inside the day', () => {
    const clock = new DayCycle(6, 0);
    expect(clock.progress).toBeCloseTo(0.25, 5);
    clock.setTime(0);
    expect(clock.progress).toBe(0);
  });
});
