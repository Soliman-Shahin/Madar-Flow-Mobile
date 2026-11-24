import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

interface CacheEntry {
  response: HttpResponse<any>;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50;
const CACHE_TTL = 5 * 60 * 1000;
let isCleanupScheduled = false;

/** Invalidate cached GET responses affected by a mutation. */
export function invalidateHttpCache(path: string): number {
  let removed = 0;
  for (const key of cache.keys()) {
    if (key.includes(path)) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Clear the interceptor's transient GET response cache without touching storage. */
export function clearHttpCache(): number {
  const size = cache.size;
  cache.clear();
  return size;
}

/**
 * Cache key = credential + URL. The cache lives in memory only, but without the credential two
 * accounts used one after the other on the same device (sign out, then sign in or sign up as
 * someone else) shared entries for the TTL, so the second account was served the first account's
 * cached lists, totals and profile data. The full Authorization value is used (not a hash) so
 * keys can never collide; a refreshed token simply starts a fresh partition.
 */
export function httpCacheKey(req: HttpRequest<unknown>): string {
  return `${req.headers.get('Authorization') ?? 'anonymous'}|${req.urlWithParams}`;
}

function isExpired(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp > CACHE_TTL;
}

function cleanupExpired(): void {
  const now = Date.now();
  let cleaned = 0;

  cache.forEach((entry, key) => {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
      cleaned++;
    }
  });

  if (cleaned > 0) {
    debugLog(`🧹 [Cache] Cleaned ${cleaned} expired entries`);
  }
}

export const cacheInterceptor: HttpInterceptorFn = (
  req: HttpRequest<any>,
  next: HttpHandlerFn
): Observable<HttpEvent<any>> => {
  if (!isCleanupScheduled) {
    setInterval(() => cleanupExpired(), 60000);
    isCleanupScheduled = true;
  }

  if (req.method !== 'GET') {
    return next(req);
  }
  const key = httpCacheKey(req);
  const cached = cache.get(key);
  if (cached && !isExpired(cached)) {
    debugLog('✅ [Cache] HIT:', req.urlWithParams);
    return of(cached.response.clone());
  }

  if (cached) {
    cache.delete(key);
  }
  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        if (cache.size >= MAX_CACHE_SIZE) {
          const firstKey = cache.keys().next().value;
          if (firstKey !== undefined) {
            cache.delete(firstKey);
          }
        }

        cache.set(key, {
          response: event.clone(),
          timestamp: Date.now(),
        });
        debugLog('💾 [Cache] STORED:', req.urlWithParams);
      }
    })
  );
};
