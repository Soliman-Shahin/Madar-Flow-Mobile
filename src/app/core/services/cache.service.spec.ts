import { fakeAsync, tick } from '@angular/core/testing';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let cache: CacheService;
  beforeEach(() => (cache = new CacheService()));
  afterEach(() => cache.ngOnDestroy());

  it('returns stored values and null for unknown keys, tracking hit rate', () => {
    cache.set('a', { n: 1 });
    expect(cache.get('a')).toEqual({ n: 1 });
    expect(cache.get('missing')).toBeNull();
    expect(cache.getHitRate()).toBe(50);
    expect(cache.getMissRate()).toBe(50);
    cache.resetStats();
    expect(cache.getHitRate()).toBe(0);
  });

  it('expires entries after their TTL', fakeAsync(() => {
    cache.set('k', 'v', 1000);
    expect(cache.has('k')).toBeTrue();
    expect(cache.getRemainingTTL('k')).toBeGreaterThan(0);
    tick(1500);
    expect(cache.has('k')).toBeFalse();
    expect(cache.get('k')).toBeNull();
    expect(cache.getRemainingTTL('k')).toBe(-1);
    cache.ngOnDestroy();
  }));

  it('removes single keys and by prefix', () => {
    cache.set('expenses-1', 1);
    cache.set('expenses-2', 2);
    cache.set('other', 3);
    expect(cache.remove('other')).toBeTrue();
    expect(cache.remove('other')).toBeFalse();
    expect(cache.clearByPrefix('expenses-')).toBe(2);
    expect(cache.getSize()).toBe(0);
  });

  it('getOrSet runs the factory once and then serves from cache', async () => {
    let calls = 0;
    const factory = async () => ++calls;
    expect(await cache.getOrSet('x', factory)).toBe(1);
    expect(await cache.getOrSet('x', factory)).toBe(1);
    expect(calls).toBe(1);
  });

  it('reports stats and clears everything', () => {
    cache.set('a', 'abc');
    expect(cache.cacheStats().totalEntries).toBe(1);
    expect(cache.cacheStats().totalSize).toBeGreaterThan(0);
    expect(cache.getKeys()).toEqual(['a']);
    cache.clear();
    expect(cache.cacheStats().totalEntries).toBe(0);
  });
});
