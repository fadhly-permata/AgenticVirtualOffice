import type { AgentSeed } from './agent';

export const MIN_AGENTS = 2;
export const DEFAULT_AGENTS = 5;
export const MAX_AGENTS = 15;

/** Roster for up to fifteen OpenCode agents. Sari, Nadia and the other women have long hair. */
export const AGENT_SEEDS: AgentSeed[] = [
  {
    id: 'budi',
    name: 'Budi',
    color: '#3f8f83',
    look: { shirt: 0x3f8f83, pants: 0x37424e, skin: 0xd8a273, hair: 0x2a211b },
  },
  {
    id: 'sari',
    name: 'Sari',
    color: '#e07a5f',
    look: { shirt: 0xe07a5f, pants: 0x3d4654, skin: 0xe8bd93, hair: 0x3a2a22, longHair: true },
  },
  {
    id: 'rian',
    name: 'Rian',
    color: '#5a7d9a',
    look: { shirt: 0x5a7d9a, pants: 0x2f3944, skin: 0xc98f62, hair: 0x1f1a17 },
  },
  {
    id: 'nadia',
    name: 'Nadia',
    color: '#8a6aa8',
    look: { shirt: 0x8a6aa8, pants: 0x404654, skin: 0xe3b18a, hair: 0x2b1e1a, longHair: true },
  },
  {
    id: 'tegar',
    name: 'Tegar',
    color: '#e2b44a',
    look: { shirt: 0xe2b44a, pants: 0x35404b, skin: 0xb97c4f, hair: 0x171310 },
  },
  {
    id: 'ayu',
    name: 'Ayu',
    color: '#6f9e8b',
    look: { shirt: 0x6f9e8b, pants: 0x3b4450, skin: 0xecc39a, hair: 0x33241d, longHair: true },
  },
  {
    id: 'dimas',
    name: 'Dimas',
    color: '#b96a4b',
    look: { shirt: 0xb96a4b, pants: 0x303a45, skin: 0xcf9569, hair: 0x201a16 },
  },
  {
    id: 'putri',
    name: 'Putri',
    color: '#d98aa0',
    look: { shirt: 0xd98aa0, pants: 0x424b5a, skin: 0xe9c1a2, hair: 0x2a1d19, longHair: true },
  },
  {
    id: 'bayu',
    name: 'Bayu',
    color: '#466a8a',
    look: { shirt: 0x466a8a, pants: 0x2d3641, skin: 0xc4875b, hair: 0x181412 },
  },
  {
    id: 'lestari',
    name: 'Lestari',
    color: '#7fae9e',
    look: { shirt: 0x7fae9e, pants: 0x3a434e, skin: 0xd9a87e, hair: 0x241b17, longHair: true },
  },
  {
    id: 'fajar',
    name: 'Fajar',
    color: '#c47f4e',
    look: { shirt: 0xc47f4e, pants: 0x333d48, skin: 0xbd8054, hair: 0x1c1713 },
  },
  {
    id: 'citra',
    name: 'Citra',
    color: '#b4709e',
    look: { shirt: 0xb4709e, pants: 0x3f4755, skin: 0xecbf96, hair: 0x2d201b, longHair: true },
  },
  {
    id: 'andi',
    name: 'Andi',
    color: '#8a9a5b',
    look: { shirt: 0x8a9a5b, pants: 0x353f4a, skin: 0xd09b6d, hair: 0x221c17 },
  },
  {
    id: 'dewi',
    name: 'Dewi',
    color: '#7fa6c9',
    look: { shirt: 0x7fa6c9, pants: 0x414a58, skin: 0xe5b78f, hair: 0x30221c, longHair: true },
  },
  {
    id: 'gilang',
    name: 'Gilang',
    color: '#6f6a8f',
    look: { shirt: 0x6f6a8f, pants: 0x2f3943, skin: 0xc08a5f, hair: 0x1a1512 },
  },
];

/** Unique starting seats for the roster, in a believable mid-morning snapshot. */
const STARTING_PLAN: { spot: string; holdFor: number }[] = [
  { spot: 'desk-1', holdFor: 26 },
  { spot: 'desk-2', holdFor: 34 },
  { spot: 'desk-3', holdFor: 20 },
  { spot: 'meet-n2', holdFor: 14 },
  { spot: 'coffee-1', holdFor: 24 },
  { spot: 'desk-4', holdFor: 18 },
  { spot: 'meet-n1', holdFor: 29 },
  { spot: 'coffee-2', holdFor: 22 },
  { spot: 'sofa-1', holdFor: 31 },
  { spot: 'desk-5', holdFor: 17 },
  { spot: 'meet-n3', holdFor: 25 },
  { spot: 'coffee-3', holdFor: 33 },
  { spot: 'sofa-2', holdFor: 19 },
  { spot: 'meet-s1', holdFor: 28 },
  { spot: 'sofa-3', holdFor: 23 },
];

export interface StartingAgent {
  seedIndex: number;
  spot: string;
  holdFor: number;
}

export function clampAgentCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AGENTS;
  return Math.min(MAX_AGENTS, Math.max(MIN_AGENTS, Math.trunc(value)));
}

/** Reads `?agents=N`; anything missing or invalid falls back to the default. */
export function parseAgentCount(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_AGENTS;
  return clampAgentCount(Number.parseInt(value, 10));
}

/** Assigns the first `count` roster entries to distinct seats. */
export function startingState(count: number): StartingAgent[] {
  return STARTING_PLAN.slice(0, clampAgentCount(count)).map((entry, seedIndex) => ({
    seedIndex,
    ...entry,
  }));
}
