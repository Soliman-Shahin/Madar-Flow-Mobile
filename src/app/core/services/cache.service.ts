/**
 * Cache Service
 *
 * Enhanced in-memory caching service with TTL and automatic cleanup.
 * Used for caching permissions, plans, and other frequently accessed data.
 */

import { Injectable, signal, computed } from '@angular/core';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

interface CacheEntry<T> {
  value: T;
  expiry: number;
  createdAt: number;
}

interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitRate: number;
  missRate: number;
}

@Injectable({
  providedIn: 'root',
})
export class CacheService {
  private cache = new Map<string, CacheEntry<any>>();
  private cleanupInterval: any;
  private hits = 0;
  private misses = 0;

  // Signals for cache stats
  private cacheStatsSignal = signal<CacheStats>({
    totalEntries: 0,
    totalSize: 0,
    hitRate: 0,
    missRate: 0,
  });

  readonly cacheStats = this.cacheStatsSignal.asReadonly();

  constructor() {
    this.startCleanup();
  }

  // ==================== Public API ====================

  /**
   * Get value from cache
   * Returns null if not found or expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      this.updateStats();
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.misses++;
      this.updateStats();
      return null;
    }

    this.hits++;
    this.updateStats();
    return entry.value as T;
  }

  /**
   * Set value in cache with TTL (time to live in milliseconds)
   * Default TTL: 5 minutes
   */
  set<T>(key: string, value: T, ttl: number = 5 * 60 * 1000): void {
    const now = Date.now();
    this.cache.set(key, {
      value,
      expiry: now + ttl,
      createdAt: now,
    });
    this.updateStats();
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.updateStats();
      return false;
    }

    return true;
  }

  /**
   * Remove specific key from cache
   */
  remove(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.updateStats();
    }
    return deleted;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.updateStats();
  }

  /**
   * Clear cache entries by prefix
   * Useful for clearing related cache entries
   */
  clearByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.updateStats();
    }
    return count;
  }

  /**
   * Get or set pattern
   * If value exists in cache, return it. Otherwise, execute factory and cache result.
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = 5 * 60 * 1000
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Get remaining TTL for a key (in milliseconds)
   * Returns -1 if key doesn't exist or is expired
   */
  getRemainingTTL(key: string): number {
    const entry = this.cache.get(key);
    if (!entry) return -1;

    const remaining = entry.expiry - Date.now();
    return remaining > 0 ? remaining : -1;
  }

  /**
   * Get all cache keys
   */
  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size (number of entries)
   */
  getSize(): number {
    return this.cache.size;
  }

  /**
   * Get cache hit rate
   */
  getHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? (this.hits / total) * 100 : 0;
  }

  /**
   * Get cache miss rate
   */
  getMissRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? (this.misses / total) * 100 : 0;
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.updateStats();
  }

  // ==================== Private Methods ====================

  /**
   * Start automatic cleanup of expired entries
   * Runs every 5 minutes
   */
  private startCleanup(): void {
    // Clear any existing interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Remove expired entries from cache
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      debugLog(`[CacheService] Cleaned up ${removed} expired entries`);
      this.updateStats();
    }
  }

  /**
   * Update cache statistics signal
   */
  private updateStats(): void {
    this.cacheStatsSignal.set({
      totalEntries: this.cache.size,
      totalSize: this.estimateSize(),
      hitRate: this.getHitRate(),
      missRate: this.getMissRate(),
    });
  }

  /**
   * Estimate cache size in bytes (rough estimation)
   */
  private estimateSize(): number {
    let size = 0;
    for (const entry of this.cache.values()) {
      // Rough estimation: JSON stringify length
      try {
        size += JSON.stringify(entry.value).length;
      } catch {
        // Skip if can't stringify
      }
    }
    return size;
  }

  /**
   * Cleanup on service destroy
   */
  ngOnDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// ==================== Cache Key Constants ====================

/**
 * Predefined cache keys for consistency
 */
export const CACHE_KEYS = {
  USER_PERMISSIONS: 'user-permissions',
  USER_PLAN: 'user-plan',
  AVAILABLE_PLANS: 'available-plans',
  USER_PROFILE: 'user-profile',
  CATEGORIES: 'categories',
  EXPENSES_PREFIX: 'expenses-',
  REPORTS_PREFIX: 'reports-',
} as const;

/**
 * Predefined TTL values (in milliseconds)
 */
export const CACHE_TTL = {
  SHORT: 1 * 60 * 1000, // 1 minute
  MEDIUM: 5 * 60 * 1000, // 5 minutes
  LONG: 15 * 60 * 1000, // 15 minutes
  VERY_LONG: 60 * 60 * 1000, // 1 hour
} as const;
