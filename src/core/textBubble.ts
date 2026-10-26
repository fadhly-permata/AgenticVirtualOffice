/**
 * Text bubble painted on a canvas and used as a sprite texture over an agent's
 * head. Kept apart from `textures.ts` because this one needs the DOM: the text
 * is measured with the browser's font metrics, so the office stays renderable
 * in Node tests as long as no bubble copy is set.
 */

export const BUBBLE_WIDTH = 512;
export const BUBBLE_HEIGHT = 160;
const PAD_X = 22;
const PAD_TOP = 20;
const LINE_HEIGHT = 44;
const FONT = '600 34px system-ui, "Segoe UI", sans-serif';
const MAX_LINES = 2;

export function createBubbleCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = BUBBLE_WIDTH;
  canvas.height = BUBBLE_HEIGHT;
  return canvas;
}

function wrap(context: CanvasRenderingContext2D, text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= BUBBLE_WIDTH - PAD_X * 2) {
      current = candidate;
      continue;
    }
    if (!current) break;
    lines.push(current);
    current = word;
    if (lines.length === MAX_LINES) break;
  }
  if (current && lines.length < MAX_LINES) lines.push(current);

  if (lines.length === MAX_LINES) {
    const rest = words.slice(lines.join(' ').split(/\s+/).length).length;
    if (rest) {
      let last = lines[MAX_LINES - 1];
      while (last && context.measureText(`${last}…`).width > BUBBLE_WIDTH - PAD_X * 2) {
        last = last.slice(0, -1);
      }
      lines[MAX_LINES - 1] = `${last}…`;
    }
  }
  return lines;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

/** Draws `text` inside a speech bubble; the caller flags the texture as dirty. */
export function paintBubble(canvas: HTMLCanvasElement, text: string, accent: string): void {
  const context = canvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, BUBBLE_WIDTH, BUBBLE_HEIGHT);

  const body = { x: 6, y: 4, width: BUBBLE_WIDTH - 12, height: BUBBLE_HEIGHT - 34 };
  context.fillStyle = 'rgba(16, 18, 22, 0.28)';
  roundRect(context, body.x + 3, body.y + 6, body.width, body.height, 22);
  context.fill();

  context.fillStyle = '#f7f5f0';
  context.strokeStyle = 'rgba(24, 26, 31, 0.75)';
  context.lineWidth = 3;
  roundRect(context, body.x, body.y, body.width, body.height, 22);
  context.fill();
  context.stroke();

  // Tail pointing down at the head.
  context.beginPath();
  context.moveTo(BUBBLE_WIDTH / 2 - 16, body.y + body.height - 1);
  context.lineTo(BUBBLE_WIDTH / 2, BUBBLE_HEIGHT - 4);
  context.lineTo(BUBBLE_WIDTH / 2 + 16, body.y + body.height - 1);
  context.closePath();
  context.fillStyle = '#f7f5f0';
  context.fill();
  context.strokeStyle = 'rgba(24, 26, 31, 0.75)';
  context.beginPath();
  context.moveTo(BUBBLE_WIDTH / 2 - 16, body.y + body.height - 2);
  context.lineTo(BUBBLE_WIDTH / 2, BUBBLE_HEIGHT - 4);
  context.lineTo(BUBBLE_WIDTH / 2 + 16, body.y + body.height - 2);
  context.stroke();

  context.fillStyle = accent;
  roundRect(context, body.x + 10, body.y + 14, 8, body.height - 28, 4);
  context.fill();

  context.font = FONT;
  context.textBaseline = 'top';
  context.fillStyle = '#1a1c21';
  const lines = wrap(context, text);
  lines.forEach((line, index) => {
    context.fillText(line, PAD_X + 12, PAD_TOP + index * LINE_HEIGHT);
  });
}
