const DEFAULT_TTL_MS = 5 * 60_000;

/**
 * Cache katalog model per tool *dan* per workspace. Kuncinya dipakai sejak
 * promise dibuat, jadi fetch yang selesai setelah pengguna ganti tool hanya
 * bisa menulis ke entri tool lama dan tidak menyingkirkan katalog tool baru.
 */
export function createCatalogCache({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();

  async function load(key, produce) {
    const entry = entries.get(key);
    if (entry?.data && now() - entry.at < ttlMs) return entry.data;
    if (entry?.pending) return entry.pending;

    const pending = produce()
      .then((data) => {
        entries.set(key, { at: now(), data });
        return data;
      })
      .catch((error) => {
        if (entries.get(key)?.pending === pending) entries.delete(key);
        throw error;
      });

    entries.set(key, { at: 0, data: null, pending });
    return pending;
  }

  return {
    load,
    clear: () => entries.clear(),
    peek: (key) => entries.get(key)?.data ?? null,
    size: () => entries.size,
  };
}
