import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  ActionPerformed,
  PushNotificationSchema,
  PushNotifications,
  Token,
} from '@capacitor/push-notifications';
import {
  ActionPerformed as LocalNotificationActionPerformed,
  LocalNotifications,
} from '@capacitor/local-notifications';
import { firstValueFrom } from 'rxjs';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import { ApiService } from './api.service';
import { BRAND } from 'src/app/config/brand.config';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

export type PushPermissionState =
  | 'unavailable'
  | 'prompt'
  | 'granted'
  | 'denied';

const DEVICE_ID_KEY = 'push_device_id';
const PENDING_NOTIFICATION_KEY = 'pending_push_notification_id';
const SEEN_NOTIFICATION_IDS_KEY = 'seen_push_notification_ids';
const NOTIFICATIONS_ENABLED_KEY = 'notifications';
const CHANNEL_ID = 'madar_flow_general';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private listenersRegistered = false;
  private registrationRequested = false;

  constructor(
    private apiService: ApiService,
    private tokenService: TokenService,
    private router: Router,
    private zone: NgZone
  ) {}

  async initializeIfEnabled(): Promise<PushPermissionState> {
    if (!this.isSupported()) return 'unavailable';

    await this.registerListeners();
    await this.createAndroidChannel();

    const permission = await this.getPermissionState();
    const enabled = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false';
    if (enabled && this.isAuthenticated()) {
      if (permission === 'granted') {
        await this.requestNativeRegistration();
      } else if (permission === 'prompt') {
        const enabledPermission = await this.enable();
        await this.processPendingNavigation();
        return enabledPermission;
      } else {
        localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
      }
    }

    await this.processPendingNavigation();
    return permission;
  }

  async enable(): Promise<PushPermissionState> {
    if (!this.isSupported()) return 'unavailable';

    await this.registerListeners();
    await this.createAndroidChannel();

    let permission = await PushNotifications.checkPermissions();
    if (
      permission.receive === 'prompt' ||
      permission.receive === 'prompt-with-rationale'
    ) {
      permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive !== 'granted') {
      localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
      return 'denied';
    }

    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
    if (this.isAuthenticated()) await this.requestNativeRegistration();
    return 'granted';
  }

  async disable(): Promise<void> {
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
    if (!this.isSupported()) return;

    await this.deactivateCurrentDevice();
    try {
      await PushNotifications.unregister();
    } catch {
      // The backend association is already inactive; native cleanup can retry later.
    }
    this.registrationRequested = false;
  }

  async deactivateCurrentDevice(): Promise<void> {
    if (!this.isSupported() || !this.isAuthenticated()) return;

    const deviceId = this.getOrCreateDeviceId();
    try {
      await firstValueFrom(
        this.apiService.delete(`/push/devices/${encodeURIComponent(deviceId)}`)
      );
    } catch {
      // Logout and notification disable must remain usable while offline.
    } finally {
      this.registrationRequested = false;
    }
  }

  async processPendingNavigation(): Promise<void> {
    const notificationId = localStorage.getItem(PENDING_NOTIFICATION_KEY);
    if (!notificationId || !this.isAuthenticated()) return;

    localStorage.removeItem(PENDING_NOTIFICATION_KEY);
    await this.zone.run(() =>
      this.router.navigate(['/notifications', notificationId])
    );
  }

  private async registerListeners(): Promise<void> {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    await PushNotifications.addListener('registration', (token: Token) => {
      void this.registerTokenWithBackend(token.value);
    });

    await PushNotifications.addListener('registrationError', () => {
      this.registrationRequested = false;
      console.warn('[Push] Native registration failed');
    });

    await PushNotifications.addListener(
      'pushNotificationReceived',
      (notification: PushNotificationSchema) => {
        void this.presentForegroundNotification(notification);
      }
    );

    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: ActionPerformed) => {
        this.handleNotificationTap(action.notification);
      }
    );

    await LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action: LocalNotificationActionPerformed) => {
        this.handleNotificationData(action.notification.extra);
      }
    );

    App.addListener('resume', () => {
      if (localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false') {
        void this.initializeIfEnabled();
      }
    });
  }

  private async requestNativeRegistration(): Promise<void> {
    if (this.registrationRequested) return;
    this.registrationRequested = true;
    try {
      await PushNotifications.register();
    } catch {
      this.registrationRequested = false;
      console.warn('[Push] Unable to request native registration');
    }
  }

  private async registerTokenWithBackend(token: string): Promise<void> {
    if (!token || !this.isAuthenticated()) return;

    try {
      const appInfo = await App.getInfo();
      await firstValueFrom(
        this.apiService.post('/push/devices', {
          deviceId: this.getOrCreateDeviceId(),
          token,
          platform: 'android',
          appVersion: appInfo.version,
        })
      );
      this.registrationRequested = false;
      debugLog('[Push] Device registration synchronized');
    } catch {
      this.registrationRequested = false;
      console.warn('[Push] Backend device registration failed');
    }
  }

  private handleNotificationTap(notification: PushNotificationSchema): void {
    this.handleNotificationData(notification.data);
  }

  private handleNotificationData(
    data: Record<string, unknown> | undefined
  ): void {
    const notificationId = this.getSafeNotificationId(data);
    if (!notificationId) return;

    this.rememberNotification(notificationId);
    localStorage.setItem(PENDING_NOTIFICATION_KEY, notificationId);
    void this.processPendingNavigation();
  }

  private async presentForegroundNotification(
    notification: PushNotificationSchema
  ): Promise<void> {
    const notificationId = this.getSafeNotificationId(notification.data);
    if (!notificationId || !this.rememberNotification(notificationId)) return;

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: this.toLocalNotificationId(notificationId),
            title: notification.title || BRAND.productName,
            body: notification.body || '',
            channelId: CHANNEL_ID,
            smallIcon: 'ic_stat_notification',
            autoCancel: true,
            foreground: true,
            extra: {
              notificationId,
              type:
                typeof notification.data?.['type'] === 'string'
                  ? notification.data['type']
                  : 'info',
              routeKey: 'notification-detail',
            },
          },
        ],
      });
    } catch {
      console.warn('[Push] Unable to present foreground notification');
    }
  }

  private getSafeNotificationId(data: Record<string, unknown> | undefined) {
    if (data?.['routeKey'] !== 'notification-detail') return null;
    const id = data?.['notificationId'];
    return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id) ? id : null;
  }

  private rememberNotification(id: string): boolean {
    const ids = this.getSeenNotificationIds();
    if (ids.includes(id)) return false;

    localStorage.setItem(
      SEEN_NOTIFICATION_IDS_KEY,
      JSON.stringify([id, ...ids].slice(0, 100))
    );
    return true;
  }

  private toLocalNotificationId(notificationId: string): number {
    return parseInt(notificationId.slice(-8), 16) | 0;
  }

  private getSeenNotificationIds(): string[] {
    try {
      const value = JSON.parse(
        localStorage.getItem(SEEN_NOTIFICATION_IDS_KEY) || '[]'
      );
      return Array.isArray(value)
        ? value.filter((id) => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private getOrCreateDeviceId(): string {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  }

  private async createAndroidChannel(): Promise<void> {
    if (Capacitor.getPlatform() !== 'android') return;
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: `${BRAND.productName} notifications`,
      description: `General ${BRAND.productName} notifications`,
      importance: 4,
      visibility: 1,
      vibration: true,
    });
  }

  private async getPermissionState(): Promise<PushPermissionState> {
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'granted') return 'granted';
    if (permission.receive === 'denied') return 'denied';
    return 'prompt';
  }

  async getCurrentPermissionState(): Promise<PushPermissionState> {
    if (!this.isSupported()) return 'unavailable';
    return this.getPermissionState();
  }

  private isSupported(): boolean {
    return (
      Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    );
  }

  private isAuthenticated(): boolean {
    const token = this.tokenService.getAccessToken();
    return !!token && !this.tokenService.isTokenExpired(token);
  }
}
