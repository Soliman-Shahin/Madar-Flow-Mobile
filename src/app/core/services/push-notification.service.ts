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
import { LocalNotifications } from '@capacitor/local-notifications';
import { getApps, initializeApp } from 'firebase/app';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported as isFirebaseMessagingSupported,
  Messaging,
  onMessage,
} from 'firebase/messaging';
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
  private firebaseConfigPromise?: Promise<any | null>;
  private webMessaging?: Messaging;

  constructor(
    private apiService: ApiService,
    private tokenService: TokenService,
    private router: Router,
    private zone: NgZone
  ) {}

  async initializeIfEnabled(): Promise<PushPermissionState> {
    if (!(await this.isSupported())) return 'unavailable';

    await this.registerListeners();
    await this.createAndroidChannel();

    const permission = await this.getPermissionState();
    const enabled = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false';
    if (enabled && this.isAuthenticated()) {
      if (permission === 'granted') {
        await this.requestRegistration();
      } else if (permission === 'prompt' && Capacitor.isNativePlatform()) {
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
    if (!(await this.isSupported())) return 'unavailable';

    await this.registerListeners();
    await this.createAndroidChannel();

    let granted: boolean;
    if (Capacitor.isNativePlatform()) {
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
        permission = await PushNotifications.requestPermissions();
      }
      granted = permission.receive === 'granted';
    } else {
      granted = await Notification.requestPermission() === 'granted';
    }

    if (!granted) {
      localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
      return 'denied';
    }

    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
    if (this.isAuthenticated()) await this.requestRegistration();
    return 'granted';
  }

  async disable(): Promise<void> {
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
    if (!(await this.isSupported())) return;

    await this.deactivateCurrentDevice();
    try {
      if (Capacitor.isNativePlatform()) await PushNotifications.unregister();
      else if (this.webMessaging) await deleteToken(this.webMessaging);
    } catch {
      // The backend association is already inactive; native cleanup can retry later.
    }
    this.registrationRequested = false;
  }

  async deactivateCurrentDevice(): Promise<void> {
    if (!(await this.isSupported()) || !this.isAuthenticated()) return;

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

    if (Capacitor.isNativePlatform()) {
      await PushNotifications.addListener('registration', (token: Token) => {
        void this.registerTokenWithBackend(token.value);
      });
      await PushNotifications.addListener('registrationError', () => {
        this.registrationRequested = false;
        console.warn('[Push] Native registration failed');
      });
      await PushNotifications.addListener(
        'pushNotificationReceived',
        (notification: PushNotificationSchema) => this.presentForegroundNotification(notification)
      );
      await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action: ActionPerformed) => this.handleNotificationTap(action.notification)
      );
    } else {
      const messaging = await this.getWebMessaging();
      if (messaging) {
        onMessage(messaging, (payload) => {
          void this.presentForegroundNotification({
            title: payload.notification?.title,
            body: payload.notification?.body,
            data: payload.data,
          });
        });
      }
    }

    if (Capacitor.getPlatform() === 'android') {
      await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (action) => this.handleNotificationData(action.notification.extra)
      );
    }

    App.addListener('resume', () => {
      if (localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false') {
        void this.initializeIfEnabled();
      }
    });
  }

  private async requestRegistration(): Promise<void> {
    if (this.registrationRequested) return;
    this.registrationRequested = true;
    try {
      if (Capacitor.isNativePlatform()) {
        await PushNotifications.register();
      } else {
        const config = await this.loadFirebaseWebConfig();
        if (!config) throw new Error('Web push is not configured');
        const messaging = await this.getWebMessaging();
        if (!messaging) throw new Error('Web push is unsupported by this browser');
        const serviceWorkerRegistration = await navigator.serviceWorker.register(
          '/fcm/firebase-messaging-sw.js',
          { scope: '/fcm/' }
        );
        const token = await getToken(messaging, {
          vapidKey: config.vapidKey,
          serviceWorkerRegistration,
        });
        await this.registerTokenWithBackend(token);
      }
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
          platform: this.currentPlatform(),
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

  private handleNotificationTap(notification: { data?: unknown }): void {
    this.handleNotificationData(notification.data);
  }

  private handleNotificationData(
    data: unknown
  ): void {
    const notificationId = this.getSafeNotificationId(
      data && typeof data === 'object' ? data as Record<string, unknown> : undefined
    );
    if (!notificationId) return;

    this.rememberNotification(notificationId);
    localStorage.setItem(PENDING_NOTIFICATION_KEY, notificationId);
    void this.processPendingNavigation();
  }

  private async presentForegroundNotification(
    notification: { id?: string; title?: string; body?: string; data?: unknown }
  ): Promise<void> {
    const data = notification.data && typeof notification.data === 'object'
      ? notification.data as Record<string, unknown>
      : undefined;
    const notificationId = this.getSafeNotificationId(data);
    if (!notificationId || !this.rememberNotification(notificationId)) return;

    if (Capacitor.getPlatform() === 'ios') return;
    if (!Capacitor.isNativePlatform()) {
      if (Notification.permission !== 'granted') return;
      const browserNotification = new Notification(
        notification.title || BRAND.productName,
        { body: notification.body || '', data: { notificationId, routeKey: 'notification-detail' } }
      );
      browserNotification.onclick = () => {
        window.focus();
        this.handleNotificationData(browserNotification.data);
      };
      return;
    }

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
              typeof data?.['type'] === 'string'
                  ? data['type']
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
    if (Capacitor.isNativePlatform()) {
      const permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'granted') return 'granted';
      if (permission.receive === 'denied') return 'denied';
      return 'prompt';
    }
    return Notification.permission === 'granted'
      ? 'granted'
      : Notification.permission === 'denied'
        ? 'denied'
        : 'prompt';
  }

  async getCurrentPermissionState(): Promise<PushPermissionState> {
    if (!(await this.isSupported())) return 'unavailable';
    return this.getPermissionState();
  }

  private async isSupported(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const platform = Capacitor.getPlatform();
      return platform === 'android' || platform === 'ios';
    }
    return !!(await this.getWebMessaging());
  }

  private async getWebMessaging(): Promise<Messaging | null> {
    if (this.webMessaging) return this.webMessaging;
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) return null;
    const config = await this.loadFirebaseWebConfig();
    if (!config || !(await isFirebaseMessagingSupported())) return null;
    const firebaseOptions = { ...config };
    delete firebaseOptions.vapidKey;
    const app = getApps()[0] || initializeApp(firebaseOptions);
    this.webMessaging = getMessaging(app);
    return this.webMessaging;
  }

  private isAuthenticated(): boolean {
    const token = this.tokenService.getAccessToken();
    return !!token && !this.tokenService.isTokenExpired(token);
  }

  private currentPlatform(): 'android' | 'ios' | 'web' {
    const platform = Capacitor.getPlatform();
    return platform === 'android' || platform === 'ios' ? platform : 'web';
  }

  private loadFirebaseWebConfig(): Promise<any | null> {
    if (!this.firebaseConfigPromise) {
      this.firebaseConfigPromise = fetch('/fcm/firebase-config.json', { cache: 'no-store' })
        .then((response) => response.ok ? response.json() : null)
        .then((config) => {
          const required = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId', 'vapidKey'];
          return config && required.every((key) => typeof config[key] === 'string' && config[key].trim())
            ? config
            : null;
        })
        .catch(() => null);
    }
    return this.firebaseConfigPromise;
  }
}
