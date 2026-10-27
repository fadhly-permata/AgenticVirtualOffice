import type { Catalog } from '../types';

/**
 * Labels the office scene and the HUD read through `t()` every time they are
 * asked for, so switching language repaints the roster and the clock chip
 * without a reload. Indonesian strings mirror the pre-i18n literals exactly.
 */
export const office: Catalog = {
  working: ['Fokus kerja', 'Working'],
  coffee: ['Ngopi', 'Coffee break'],
  meeting: ['Meeting', 'In a meeting'],
  gaming: ['Main game', 'Gaming'],
  tv: ['Nonton TV', 'Watching TV'],
  chatting: ['Ngobrol', 'Chatting'],
  idle: ['Istirahat', 'Taking a break'],

  phaseMorning: ['Pagi', 'Morning'],
  phaseMidday: ['Siang', 'Midday'],
  phaseAfternoon: ['Sore', 'Afternoon'],
  phaseNight: ['Malam', 'Night'],
};
