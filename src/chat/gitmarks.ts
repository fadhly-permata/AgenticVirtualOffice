import type { ScmFile } from './types';

/** Huruf yang menentukan warna folder induk: anak paling "penting" yang menang. */
const PRIORITY = ['M', 'A', 'D', 'R', 'C', 'U'];

const rank = (letter: string): number => {
  const index = PRIORITY.indexOf(letter);
  return index < 0 ? PRIORITY.length : index;
};

/**
 * Satu huruf status gaya VSCode dari dua kolom porcelain. worktree dibaca lebih dulu:
 * isi folder kerja yang terlihat user lebih menarik daripada isi index.
 */
export function statusLetter(file: ScmFile): string {
  if (file.untracked || file.worktree === '?') return 'U';
  // Kolom porcelain bisa berupa spasi; server mengirim '' tapi jangan percaya buta.
  const source = file.worktree.trim() || file.index.trim();
  return source ? source[0].toUpperCase() : '';
}

/** Path → huruf status. Folder ikut ditandai dari anak-anaknya, tanpa huruf di barisnya. */
export function marksFor(files: ScmFile[]): Map<string, string> {
  const marks = new Map<string, string>();
  for (const file of files) {
    const letter = statusLetter(file);
    if (!letter) continue;
    marks.set(file.path, letter);
    const parts = file.path.split('/');
    let dir = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      dir = dir ? `${dir}/${parts[index]}` : parts[index];
      const held = marks.get(dir);
      if (!held || rank(letter) < rank(held)) marks.set(dir, letter);
    }
  }
  return marks;
}
