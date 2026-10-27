import * as THREE from 'three';
import { t } from '../i18n';
import { clamp, smoothstep } from './math';

const SKY = {
  night: { top: 0x0c1424, bottom: 0x1a2740, glow: 0x2a3d5c },
  day: { top: 0xbfe3f7, bottom: 0xf8ecdb, glow: 0xfff6e2 },
  dusk: { top: 0xf1b9a1, bottom: 0xf7c9a4, glow: 0xffb178 },
} as const;

export interface SkyColors {
  top: string;
  bottom: string;
  glow: string;
}

/**
 * Simulated clock. One in-game day lasts roughly 3.5 real minutes at the
 * default speed, which keeps the lighting cycle visible without being busy.
 */
export class DayCycle {
  hours: number;
  hoursPerSecond: number;

  constructor(startHour = 8.1, hoursPerSecond = 0.11) {
    this.hours = ((startHour % 24) + 24) % 24;
    this.hoursPerSecond = Math.max(0, hoursPerSecond);
  }

  update(dt: number): void {
    this.hours = (this.hours + dt * this.hoursPerSecond) % 24;
  }

  setTime(hours: number): void {
    this.hours = ((hours % 24) + 24) % 24;
  }

  setSpeed(hoursPerSecond: number): void {
    this.hoursPerSecond = Math.max(0, hoursPerSecond);
  }

  /** Sine of the sun elevation, from -1 (midnight) to 1 (noon). */
  get sunAltitude(): number {
    return Math.sin(((this.hours - 6) / 12) * Math.PI);
  }

  get dayFactor(): number {
    return smoothstep(0, 0.32, this.sunAltitude);
  }

  get nightFactor(): number {
    return 1 - this.dayFactor;
  }

  /** High at sunrise and sunset, zero at noon and midnight. */
  get twilightFactor(): number {
    return clamp(1 - Math.abs(this.sunAltitude) / 0.3);
  }

  /** Label fase dibaca ulang lewat `t()` setiap akses, jadi bahasa ikut berganti tanpa muat ulang. */
  get phaseLabel(): string {
    if (this.hours < 5) return t('office.phaseNight');
    if (this.hours < 10.5) return t('office.phaseMorning');
    if (this.hours < 15) return t('office.phaseMidday');
    if (this.hours < 18.5) return t('office.phaseAfternoon');
    return t('office.phaseNight');
  }

  get timeLabel(): string {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get progress(): number {
    return this.hours / 24;
  }

  sky(): SkyColors {
    const day = this.dayFactor;
    const dusk = this.twilightFactor * 0.8;
    const mix = (key: keyof typeof SKY.day): string => {
      const color = new THREE.Color(SKY.night[key]).lerp(new THREE.Color(SKY.day[key]), day);
      color.lerp(new THREE.Color(SKY.dusk[key]), dusk);
      return `#${color.getHexString()}`;
    };
    return { top: mix('top'), bottom: mix('bottom'), glow: mix('glow') };
  }
}
