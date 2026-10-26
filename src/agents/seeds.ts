import type { AgentSeed } from './agent';

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
];

/** Start the scene at a believable mid-morning snapshot. */
export const STARTING_STATE: { seedIndex: number; spot: string; holdFor: number }[] = [
  { seedIndex: 0, spot: 'desk-1', holdFor: 26 },
  { seedIndex: 1, spot: 'desk-2', holdFor: 34 },
  { seedIndex: 2, spot: 'desk-3', holdFor: 20 },
  { seedIndex: 3, spot: 'meet-n2', holdFor: 14 },
  { seedIndex: 4, spot: 'coffee-1', holdFor: 24 },
];
