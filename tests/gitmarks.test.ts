import { describe, expect, it } from 'vitest';
import type { ScmFile } from '../src/chat/types';
import { marksFor, statusLetter } from '../src/chat/gitmarks';

function file(path: string, index: string, worktree: string, untracked = false): ScmFile {
  const counts = { added: 0, deleted: 0 };
  return { path, origin: path, index, worktree, untracked, staged: counts, unstaged: counts };
}

describe('status letter', () => {
  it.each([
    [' M', 'M'],
    ['M ', 'M'],
    ['MM', 'M'],
    ['A ', 'A'],
    [' D', 'D'],
    ['R ', 'R'],
    ['C ', 'C'],
    ['T ', 'T'],
    ['', ''],
  ])('porcelain "%s" jadi "%s"', (code, want) => {
    expect(statusLetter(file('a.ts', code[0] ?? '', code[1] ?? ''))).toBe(want);
  });

  it('untracked jadi U walau hurufnya pertanyaan', () => {
    expect(statusLetter(file('baru.ts', '?', '?', true))).toBe('U');
    expect(statusLetter(file('baru.ts', '?', '?'))).toBe('U');
  });
});

describe('marks for the tree', () => {
  it('menandai file dan semua folder induknya', () => {
    const marks = marksFor([file('src/deep/a.ts', '', 'M')]);
    expect(marks.get('src/deep/a.ts')).toBe('M');
    expect(marks.get('src/deep')).toBe('M');
    expect(marks.get('src')).toBe('M');
    expect(marks.has('src/deep/a.ts/')).toBe(false);
  });

  it('folder memakai huruf anak yang paling penting', () => {
    const marks = marksFor([
      file('docs/baru.md', '?', '?', true),
      file('docs/hapus.md', '', 'D'),
      file('docs/ubah.md', '', 'M'),
    ]);
    expect(marks.get('docs')).toBe('M');
    expect(marks.get('docs/baru.md')).toBe('U');
    expect(marks.get('docs/hapus.md')).toBe('D');
  });

  it('huruf tak dikenal tidak menimpa yang dikenal', () => {
    const marks = marksFor([file('x/z.ts', 'T', ''), file('x/a.ts', 'A', '')]);
    expect(marks.get('x/z.ts')).toBe('T');
    expect(marks.get('x/a.ts')).toBe('A');
    expect(marks.get('x')).toBe('A');
  });

  it('repo bersih memberi peta kosong', () => {
    expect(marksFor([]).size).toBe(0);
  });
});
