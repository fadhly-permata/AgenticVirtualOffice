import { describe, expect, it } from 'vitest';
import { idleScreenTexture, tvSlides, tvStaticFrames } from '../src/core/textures';
import { TypingScreen } from '../src/core/typing';

describe('screen content', () => {
  it('types animated dash lines into its texture', () => {
    const screen = new TypingScreen(3);
    const before = new Uint8Array(screen.texture.image.data as Uint8Array);
    for (let frame = 0; frame < 240; frame += 1) screen.update(1 / 60);
    const after = screen.texture.image.data as Uint8Array;

    let changed = 0;
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] !== after[index]) changed += 1;
    }
    expect(changed).toBeGreaterThan(50);
  });

  it('keeps the idle screen dark and free of pattern stripes', () => {
    const data = idleScreenTexture().image.data as Uint8Array;
    let max = 0;
    let min = 255;
    for (let index = 0; index < data.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[index + channel]!;
        max = Math.max(max, value);
        min = Math.min(min, value);
      }
    }

    expect(max).toBeLessThan(30);
    expect(max - min).toBeLessThan(25);
  });

  it('provides distinct TV slides and static frames', () => {
    const slides = tvSlides();
    expect(slides.length).toBeGreaterThanOrEqual(6);
    expect(new Set(slides.map((slide) => slide.texture.image.data)).size).toBe(slides.length);
    expect(tvStaticFrames().length).toBeGreaterThanOrEqual(2);
  });
});
