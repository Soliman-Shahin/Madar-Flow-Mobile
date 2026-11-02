import { Injectable } from '@angular/core';

export type StorageType = 'local' | 'session';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private prefix = 'madarflow_';
  private storage: Storage;

  constructor() {
    this.storage = localStorage;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  setStorage(type: StorageType): void {
    this.storage = type === 'local' ? localStorage : sessionStorage;
  }

  set<T>(key: string, value: T): void {
    try {
      this.storage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (error) {
      console.warn('Browser storage operation failed');
    }
  }

  get<T>(key: string): T | null {
    try {
      const item = this.storage.getItem(this.prefix + key);
      return item ? (JSON.parse(item) as T) : null;
    } catch (error) {
      console.warn('Browser storage operation failed');
      return null;
    }
  }

  remove(key: string): void {
    try {
      this.storage.removeItem(this.prefix + key);
    } catch (error) {
      console.warn('Browser storage operation failed');
    }
  }

  /**
   * Device-level choices that must outlive a sign-out: replaying the whole
   * onboarding, or flipping the language back, after every logout is wrong.
   */
  private static readonly DEVICE_KEYS = [
    'onboarding_status',
    'app_version',
    'user-lang',
    // The "share anonymous usage data" answer is asked once per device, not at every sign-in.
    'telemetry_consent',
  ];

  clear(): void {
    try {
      const keep = StorageService.DEVICE_KEYS.map((k) => this.prefix + k);
      // Only clear keys with our prefix, except the device-level ones
      Object.keys(this.storage)
        .filter((k) => k.startsWith(this.prefix) && !keep.includes(k))
        .forEach((k) => this.storage.removeItem(k));
    } catch (error) {
      console.warn('Browser storage operation failed');
    }
  }
}
