import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { finalize, map, tap } from 'rxjs/operators';
import { ApiService } from './api.service';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import { AppNotification } from '../models/app-notification.model';
import { io, Socket } from 'socket.io-client';
import { environment } from 'src/environments/environment';

interface NotificationPage {
  data: AppNotification[];
  total: number;
  unreadCount: number;
  hasMore: boolean;
}
const PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly items = new BehaviorSubject<AppNotification[]>([]);
  private owner: string | null = null;
  private socket?: Socket;
  private offset = 0;
  private hasMore = true;
  private loadingMore = false;
  readonly notifications$ = this.items.asObservable();
  readonly unreadCount$ = this.items.pipe(
    map((items) => items.filter((item) => !item.isRead).length)
  );
  getCached(id: string): AppNotification | undefined {
    return this.items.value.find((item) => item.id === id);
  }
  constructor(
    private api: ApiService,
    private token: TokenService,
    private zone: NgZone
  ) {}

  startRealtime(): void {
    const owner = String(this.token.getUserId() || '');
    const accessToken = this.token.getAccessToken();
    if (!owner || !accessToken) return;
    if (this.socket) return;
    this.socket = io(environment.backendOrigin, {
      auth: { token: String(accessToken).replace(/^"|"$/g, '') },
      transports: ['websocket'],
      reconnection: true,
    });
    this.socket.on('connect', () => {
      void this.load(true).subscribe({ error: () => undefined });
    });
    this.socket.on('ReceiveNotification', (payload: unknown) => {
      const item = this.normalizeRealtime(payload);
      if (item) this.zone.run(() => this.receiveRealtime(item));
    });
  }

  stopRealtime(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
  }
  load(force = false): Observable<AppNotification[]> {
    const owner = String(this.token.getUserId() || '');
    if (!owner) return throwError(() => new Error('AUTH_REQUIRED'));
    if (!force && this.owner === owner && this.items.value.length)
      return of(this.items.value);
    this.offset = 0;
    this.hasMore = true;
    return this.api
      .get<NotificationPage>('/notifications/list', {
        limit: PAGE_SIZE,
        offset: 0,
      })
      .pipe(
        map((page) => {
          if (!page || !Array.isArray(page.data))
            throw new Error('INVALID_NOTIFICATION_PAGE');
          this.offset = page.data.length;
          this.hasMore = page.hasMore;
          return page.data;
        }),
        tap((items) => {
          this.owner = owner;
          this.publish([...items, ...this.items.value]);
        })
      );
  }
  loadMore(): Observable<AppNotification[]> {
    const owner = String(this.token.getUserId() || '');
    if (!owner) return throwError(() => new Error('AUTH_REQUIRED'));
    if (this.loadingMore || !this.hasMore || this.owner !== owner)
      return of(this.items.value);
    this.loadingMore = true;
    return this.api
      .get<NotificationPage>('/notifications/list', {
        limit: PAGE_SIZE,
        offset: this.offset,
      })
      .pipe(
        map((page) => {
          if (!page || !Array.isArray(page.data))
            throw new Error('INVALID_NOTIFICATION_PAGE');
          this.offset += page.data.length;
          this.hasMore = page.hasMore;
          return page.data;
        }),
        tap((items) => this.publish([...this.items.value, ...items])),
        map(() => this.items.value),
        finalize(() => {
          this.loadingMore = false;
        })
      );
  }
  get canLoadMore(): boolean {
    return this.hasMore;
  }
  markAllRead(): Observable<number> {
    return this.api
      .patch<{ updatedCount: number }>('/notifications/all/read', {})
      .pipe(
        map((result) => Number(result?.updatedCount || 0)),
        tap(() =>
          this.publish(
            this.items.value.map((item) => ({ ...item, isRead: true }))
          )
        )
      );
  }
  markRead(id: string): Observable<boolean> {
    const item = this.items.value.find((entry) => entry.id === id);
    if (!item || item.isRead) return of(true);
    return this.api
      .patch(`/notifications/${encodeURIComponent(id)}/read`, {})
      .pipe(
        tap(() =>
          this.publish(
            this.items.value.map((entry) =>
              entry.id === id ? { ...entry, isRead: true } : entry
            )
          )
        ),
        map(() => true)
      );
  }
  clearForOwner(): void {
    this.stopRealtime();
    this.owner = null;
    this.offset = 0;
    this.hasMore = true;
    this.loadingMore = false;
    this.publish([]);
  }
  private publish(items: AppNotification[]): void {
    const unique = Array.from(
      new Map(items.map((item) => [item.id, item])).values()
    ).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    this.items.next(unique);
  }

  private receiveRealtime(item: AppNotification): void {
    if (this.items.value.some((entry) => entry.id === item.id)) return;
    this.publish([item, ...this.items.value]);
  }

  private normalizeRealtime(payload: unknown): AppNotification | null {
    const value = payload as Record<string, unknown> | null;
    const id =
      typeof value?.['id'] === 'string'
        ? value['id']
        : typeof value?.['_id'] === 'string'
        ? value['_id']
        : null;
    const type = value?.['type'];
    if (
      !id ||
      !/^[a-f\d]{24}$/i.test(id) ||
      !['info', 'success', 'warn', 'error'].includes(String(type))
    )
      return null;
    if (
      typeof value?.['title'] !== 'string' ||
      typeof value?.['message'] !== 'string'
    )
      return null;
    return {
      id,
      title: String(value['title']),
      message: String(value['message']),
      type: type as AppNotification['type'],
      routeKey: 'notification-detail',
      event: typeof value?.['event'] === 'string' ? value['event'] : undefined,
      category:
        typeof value?.['category'] === 'string' ? value['category'] : undefined,
      metadata:
        value?.['metadata'] && typeof value['metadata'] === 'object'
          ? (value['metadata'] as Record<string, unknown>)
          : undefined,
      isRead: false,
      createdAt: String(value['createdAt'] || new Date().toISOString()),
    };
  }
}
