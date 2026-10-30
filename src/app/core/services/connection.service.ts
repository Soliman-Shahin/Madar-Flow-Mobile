import { Injectable, inject } from '@angular/core';
import { Observable, BehaviorSubject, fromEvent, merge, of } from 'rxjs';
import { map, debounceTime, timeout } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { Capacitor } from '@capacitor/core';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

export interface ConnectionStatus {
  online: boolean;
  backendReachable: boolean;
  lastChecked: Date;
}

/**
 * Connection Monitoring Service
 *
 * Features:
 * - Monitors internet connection status
 * - Checks backend API availability
 * - Provides observables for reactive updates
 * - Automatic health check polling
 */
@Injectable({
  providedIn: 'root',
})
export class ConnectionService {
  private connectionStatusSubject = new BehaviorSubject<ConnectionStatus>({
    online: navigator.onLine,
    backendReachable: false,
    lastChecked: new Date(),
  });

  private connectionStatus$ = this.connectionStatusSubject.asObservable();

  private healthCheckInterval: any;
  private recoveryInterval: any;
  private initialized = false;
  private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute

  private http = inject(HttpClient);

  /**
   * Start network listeners and backend health monitoring after application
   * bootstrap. Keeping this explicit prevents HTTP interceptors from running
   * while services that depend on ConnectionService are still being created.
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.initializeConnectionMonitoring();
    this.startHealthCheck();
  }

  /**
   * Get connection status as observable
   */
  getConnectionStatus(): Observable<ConnectionStatus> {
    return this.connectionStatus$;
  }

  /**
   * Get current connection status
   */
  getCurrentStatus(): ConnectionStatus {
    return this.connectionStatusSubject.value;
  }

  /**
   * Check if online
   */
  isOnline(): boolean {
    return this.connectionStatusSubject.value.online;
  }

  /**
   * Check if backend is reachable
   */
  isBackendReachable(): boolean {
    return this.connectionStatusSubject.value.backendReachable;
  }

  /**
   * Set backend reachable status directly
   */
  setBackendReachable(reachable: boolean): void {
    const current = this.connectionStatusSubject.value;
    if (current.backendReachable !== reachable) {
      this.updateConnectionStatus({ 
        backendReachable: reachable,
        ...(reachable ? { online: true } : {})
      });
    }
  }

  /**
   * Initialize connection monitoring
   */
  private async initializeConnectionMonitoring(): Promise<void> {
    const { Network } = await import('@capacitor/network');
    
    // Initial status
    try {
      const status = await Network.getStatus();
      this.updateConnectionStatus({ online: status.connected });
    } catch (e) {
      console.warn('Network getStatus failed, falling back to navigator', e);
    }

    Network.addListener('networkStatusChange', status => {
      this.updateConnectionStatus({ online: status.connected });
      if (status.connected) {
        this.checkBackendHealth();
      } else {
        this.updateConnectionStatus({ backendReachable: false });
      }
    });

    // Monitor browser online/offline events (Fallback for web)
    merge(
      of(navigator.onLine),
      fromEvent(window, 'online').pipe(map(() => true)),
      fromEvent(window, 'offline').pipe(map(() => false))
    )
      .pipe(debounceTime(300))
      .subscribe((online) => {
        this.updateConnectionStatus({ online });

        // If back online, check backend immediately
        if (online) {
          this.checkBackendHealth();
        } else {
          this.updateConnectionStatus({ backendReachable: false });
        }
      });
  }

  /**
   * Start periodic health check
   */
  private startHealthCheck(): void {
    // Initial check
    this.checkBackendHealth();

    // Periodic checks: Try regardless of isOnline() to recover from stuck offline states
    this.healthCheckInterval = setInterval(() => {
      this.checkBackendHealth();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Check backend health
   */
  async checkBackendHealth(): Promise<boolean> {
    try {
      const baseUrl = Capacitor.isNativePlatform()
        ? environment.nativeApiUrl
        : environment.browserApiUrl;
      const healthUrl = `${baseUrl.replace('/v1', '')}/health/detailed?t=${new Date().getTime()}`;

      const response = await this.http
        .get<any>(healthUrl, {
          observe: 'response',
          // Don't retry health checks
          headers: { 'X-Skip-Retry': 'true', 'X-Silent-Error': 'true' },
        })
        .pipe(timeout(3000))
        .toPromise();

      const isHealthy =
        response?.status === 200 && 
        (response?.body?.status === 'healthy' || response?.body?.status === 'degraded');

      this.updateConnectionStatus({
        backendReachable: isHealthy,
        // If the backend is reachable, we must be online, overriding any buggy OS states
        ...(isHealthy ? { online: true } : {})
      });

      return isHealthy;
    } catch (error) {
      console.warn('⚠️ Backend health check failed:', error);
      this.updateConnectionStatus({
        backendReachable: false,
      });
      return false;
    }
  }

  /**
   * Update connection status
   */
  private updateConnectionStatus(updates: Partial<ConnectionStatus>): void {
    const current = this.connectionStatusSubject.value;
    const next = {
      ...current,
      ...updates,
      lastChecked: new Date(),
    };

    this.connectionStatusSubject.next(next);

    // Manage recovery polling
    if (next.online && !next.backendReachable) {
      this.startRecoveryPolling();
    } else {
      this.stopRecoveryPolling();
    }
  }

  private startRecoveryPolling(): void {
    if (this.recoveryInterval) return;
    this.recoveryInterval = setInterval(async () => {
      debugLog('🔄 [ConnectionService] Recovery polling...');
      const isHealthy = await this.checkBackendHealth();
      if (isHealthy) {
        this.stopRecoveryPolling();
      }
    }, 5000); // Poll every 5 seconds until recovered
  }

  private stopRecoveryPolling(): void {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
  }

  /**
   * Cleanup on destroy
   */
  ngOnDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.stopRecoveryPolling();
  }
}
