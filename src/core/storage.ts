/** Tes unit jalan di node, jadi akses penyimpanan selalu lewat dua fungsi ini. */
export function readStored(key: string): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
}

export function writeStored(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
}
