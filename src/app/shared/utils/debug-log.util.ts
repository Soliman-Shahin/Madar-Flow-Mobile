import { environment } from 'src/environments/environment';

/**
 * Development-only diagnostic logging.
 *
 * Production builds log nothing, so sync/cache internals (which can include
 * entity payloads) never reach the device console or log collectors.
 * Use `console.warn` / `console.error` for conditions that must always surface.
 */
export function debugLog(...args: unknown[]): void {
  if (!environment.production) {
    console.debug(...args);
  }
}
