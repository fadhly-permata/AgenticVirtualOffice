import { describe, expect, it } from 'vitest';
import { createCatalogCache } from '../server/catalog.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('model catalog cache', () => {
  it('keeps a late answer inside the tool it was fetched for', async () => {
    const cache = createCatalogCache();
    const stale = deferred();
    const loaded = cache.load('opencode|/ws', () => stale.promise);
    const fresh = await cache.load('claude|/ws', () => Promise.resolve({ groups: ['opus'] }));

    stale.resolve({ groups: ['qwen'] });
    await loaded;

    expect(fresh).toEqual({ groups: ['opus'] });
    expect(cache.peek('claude|/ws')).toEqual({ groups: ['opus'] });
    expect(cache.peek('opencode|/ws')).toEqual({ groups: ['qwen'] });
    await expect(cache.load('claude|/ws', () => Promise.reject(new Error('tidak boleh diambil lagi')))).resolves.toEqual({
      groups: ['opus'],
    });
  });

  it('shares one in-flight fetch per key and refetches after the ttl', async () => {
    let clock = 1_000;
    const cache = createCatalogCache({ ttlMs: 500, now: () => clock });
    let calls = 0;
    const produce = () => {
      calls += 1;
      return Promise.resolve({ n: calls });
    };

    const [a, b] = await Promise.all([cache.load('claude|/ws', produce), cache.load('claude|/ws', produce)]);
    expect([a, b]).toEqual([{ n: 1 }, { n: 1 }]);
    expect(calls).toBe(1);

    clock = 1_600;
    expect(await cache.load('claude|/ws', produce)).toEqual({ n: 2 });
    expect(calls).toBe(2);
  });

  it('forgets a failed fetch so the next caller retries', async () => {
    const cache = createCatalogCache();
    await expect(cache.load('claude|/ws', () => Promise.reject(new Error('bridge mati')))).rejects.toThrow('bridge mati');
    expect(cache.peek('claude|/ws')).toBe(null);
    expect(await cache.load('claude|/ws', () => Promise.resolve({ ok: true }))).toEqual({ ok: true });
  });

  it('drops everything on clear', async () => {
    const cache = createCatalogCache();
    await cache.load('claude|/ws', () => Promise.resolve({ ok: true }));
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
