import * as THREE from 'three';

const WIDTH = 96;
const HEIGHT = 54;
const PAD_X = 6;
const PAD_Y = 5;
const CHAR_W = 4;
const CHAR_H = 6;
const CHAR_GAP = 2;
const LINE_H = 8;
const ROWS = Math.floor((HEIGHT - PAD_Y * 2 - CHAR_H) / LINE_H) + 1;
const MAX_CHARS = Math.floor((WIDTH - PAD_X * 2 + CHAR_GAP) / (CHAR_W + CHAR_GAP));

type Rgb = [number, number, number];

const PALETTES: [Rgb, Rgb][] = [
  [[116, 232, 255], [235, 255, 255]],
  [[128, 245, 190], [224, 255, 236]],
  [[255, 206, 120], [255, 245, 214]],
  [[188, 176, 255], [242, 238, 255]],
  [[224, 238, 248], [140, 220, 255]],
];

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TypingLine {
  /** Total dashes on this line once it finishes typing. */
  target: number;
  /** Dashes revealed so far. */
  typed: number;
  indent: number;
  pause: number;
}

/**
 * Dynamic terminal content: random-length dash lines type themselves and
 * scroll. Drawn into a DataTexture so it also works without a DOM canvas.
 */
export class TypingScreen {
  readonly texture: THREE.DataTexture;

  private readonly data = new Uint8Array(WIDTH * HEIGHT * 4);
  private readonly background = new Uint8Array(WIDTH * HEIGHT * 4);
  private readonly rng: () => number;
  private readonly base: Rgb;
  private readonly accent: Rgb;
  private readonly speed: number;
  private readonly lines: TypingLine[] = [];
  private hold = 0;
  private charAcc = 0;
  private blink = 0;
  private drawAcc = 0;

  constructor(seed = 1) {
    this.rng = mulberry32(seed * 2654435761 + 12345);
    const [base, accent] = PALETTES[Math.floor(this.rng() * PALETTES.length)]!;
    this.base = base;
    this.accent = accent;
    this.speed = 13 + this.rng() * 9;
    this.paintBackground();

    const initialRows = 3 + Math.floor(this.rng() * 3);
    for (let i = 0; i < initialRows; i += 1) {
      const line = this.makeLine();
      line.typed =
        i === initialRows - 1 ? Math.floor(line.target * (0.25 + this.rng() * 0.55)) : line.target;
      this.lines.push(line);
    }

    this.texture = new THREE.DataTexture(this.data, WIDTH, HEIGHT, THREE.RGBAFormat);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.draw();
  }

  update(dt: number): void {
    this.blink += dt;
    const line = this.lines[this.lines.length - 1];

    if (line && line.typed < line.target) {
      this.charAcc += dt * this.speed;
      while (line.typed < line.target && this.charAcc >= 1) {
        line.typed += 1;
        this.charAcc -= 1;
      }
      this.hold = 0;
    } else {
      this.hold += dt;
      if (this.hold >= (line?.pause ?? 0.3)) {
        this.startLine();
        this.hold = 0;
      }
    }

    this.drawAcc += dt;
    if (this.drawAcc >= 1 / 20) {
      this.drawAcc = 0;
      this.draw();
    }
  }

  private startLine(): void {
    const line = this.makeLine();
    line.typed = 0;
    this.lines.push(line);
    if (this.lines.length > ROWS) this.lines.shift();
  }

  private makeLine(): TypingLine {
    const blank = this.rng() < 0.08;
    const indent = this.rng() < 0.2 ? 1 + Math.floor(this.rng() * 3) : 0;
    const max = MAX_CHARS - indent;
    const target = blank
      ? 0
      : Math.min(max, 2 + Math.floor(Math.pow(this.rng(), 1.35) * (max - 2)));
    return { target, typed: 0, indent, pause: 0.12 + this.rng() * 0.55 };
  }

  private paintBackground(): void {
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const index = (y * WIDTH + x) * 4;
        const dx = (x / WIDTH - 0.5) * 2;
        const dy = (y / HEIGHT - 0.5) * 2;
        const vignette = Math.max(0.18, 1 - (dx * dx + dy * dy) * 0.42);
        this.background[index] = Math.round(3 + 6 * vignette);
        this.background[index + 1] = Math.round(7 + 10 * vignette);
        this.background[index + 2] = Math.round(12 + 15 * vignette);
        this.background[index + 3] = 255;
      }
    }
  }

  private draw(): void {
    this.data.set(this.background);

    const rows = Math.min(this.lines.length, ROWS);
    const first = this.lines.length - rows;
    for (let row = 0; row < rows; row += 1) {
      const line = this.lines[first + row]!;
      const y = PAD_Y + (rows - 1 - row) * LINE_H;
      const chars = Math.floor(line.typed);

      for (let char = 0; char < chars; char += 1) {
        const x = PAD_X + (line.indent + char) * (CHAR_W + CHAR_GAP);
        if (x + CHAR_W > WIDTH - PAD_X) break;
        const warm = char % 7 === 3 || char % 11 === 7;
        const color = warm ? this.accent : this.base;
        const glow = 0.7 + 0.3 * Math.abs(Math.sin(char * 1.7 + row * 2.3));
        this.bar(x, y + 2, CHAR_W, 2, color, glow);
      }

      if (row === rows - 1 && Math.floor(this.blink * 2.2) % 2 === 0) {
        const x = PAD_X + (line.indent + chars) * (CHAR_W + CHAR_GAP);
        this.bar(x, y, CHAR_W, CHAR_H, this.accent, 1);
      }
    }

    this.texture.needsUpdate = true;
  }

  private bar(x: number, y: number, w: number, h: number, [r, g, b]: Rgb, strength: number): void {
    for (let py = y; py < y + h; py += 1) {
      if (py < 0 || py >= HEIGHT) continue;
      for (let px = x; px < x + w; px += 1) {
        if (px < 0 || px >= WIDTH) continue;
        const index = (py * WIDTH + px) * 4;
        this.data[index] = Math.round(r * strength);
        this.data[index + 1] = Math.round(g * strength);
        this.data[index + 2] = Math.round(b * strength);
        this.data[index + 3] = 255;
      }
    }
  }
}
