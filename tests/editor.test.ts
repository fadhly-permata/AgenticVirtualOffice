import { describe, expect, it } from 'vitest';
import { lineDelta, separatorOf, toLF } from '../src/chat/editor';

describe('toLF', () => {
  it('meluruskan CRLF dan CR menjadi LF', () => {
    expect(toLF('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('tidak mengubah teks yang sudah LF', () => {
    expect(toLF('a\nb')).toBe('a\nb');
  });
});

describe('separatorOf', () => {
  it('membaca CRLF sebagai CRLF', () => {
    expect(separatorOf('a\r\nb\r\nc')).toBe('\r\n');
  });

  it('membaca LF sebagai LF', () => {
    expect(separatorOf('a\nb\nc')).toBe('\n');
  });

  it('memilih LF saat teks tanpa baris', () => {
    expect(separatorOf('satu baris')).toBe('\n');
  });

  it('mengikuti mayoritas saat keduanya campur', () => {
    expect(separatorOf('a\r\nb\nc\nd')).toBe('\n');
    expect(separatorOf('a\r\nb\r\nc\nd')).toBe('\r\n');
  });
});

describe('lineDelta', () => {
  it('nol untuk isi yang sama', () => {
    expect(lineDelta('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
  });

  it('menghitung baris baru', () => {
    expect(lineDelta('a\nb', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
  });

  it('menghitung baris hilang', () => {
    expect(lineDelta('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 });
  });

  it('perubahan satu baris = satu tambah dan satu kurang', () => {
    expect(lineDelta('a\nb\nc', 'a\nB\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('mengabaikan spasi di ujung baris', () => {
    expect(lineDelta('a\n  b  ', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });

  it('mengabaikan baris kosong', () => {
    expect(lineDelta('a\n\nb\n', 'a\nb')).toEqual({ added: 0, removed: 0 });
  });

  it('baris yang sama muncul dua kali tetap terhitung', () => {
    expect(lineDelta('x\nx\nx', 'x\nx')).toEqual({ added: 0, removed: 1 });
    expect(lineDelta('x', 'x\nx')).toEqual({ added: 1, removed: 0 });
  });

  it('tidak menganggap pemisah CRLF sebagai isi baris', () => {
    expect(lineDelta('a\r\nb\r\nc', 'a\r\nb\r\nc\r\nd')).toEqual({ added: 1, removed: 0 });
  });
});
