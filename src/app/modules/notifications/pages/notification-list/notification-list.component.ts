import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NotificationService } from 'src/app/core/services/notification.service';
import {
  AppNotification,
  notificationTypePresentation,
} from 'src/app/core/models/app-notification.model';
import { Subscription } from 'rxjs';
import { SkeletonBlockComponent } from 'src/app/shared/ui/skeleton-block/skeleton-block.component';

@Component({
  selector: 'app-notification-list',
  standalone: true,
  imports: [
    CommonModule,
    IonicModule,
    RouterModule,
    TranslateModule,
    SkeletonBlockComponent,
  ],
  templateUrl: './notification-list.component.html',
  styleUrls: ['./notification-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationListComponent implements OnInit, OnDestroy {
  notifications: AppNotification[] = [];
  loading = true;
  error = false;
  markAllError = false;
  groups: { key: string; items: AppNotification[] }[] = [];
  private stateSubscription?: Subscription;
  constructor(
    public service: NotificationService,
    private cdr: ChangeDetectorRef,
    private translate: TranslateService
  ) {}

  get hasUnread(): boolean {
    return this.notifications.some((item) => !item.isRead);
  }

  /** Time for today, short date otherwise; Western digits in both languages. */
  timeLabel(value: string | Date | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    const lang = this.translate.currentLang || 'en';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return new Intl.DateTimeFormat(lang, {
      ...(sameDay
        ? { hour: 'numeric', minute: '2-digit' }
        : {
            day: 'numeric',
            month: 'short',
            ...(date.getFullYear() !== now.getFullYear()
              ? { year: 'numeric' }
              : {}),
          }),
      numberingSystem: 'latn',
    }).format(date);
  }
  ngOnInit(): void {
    this.stateSubscription = this.service.notifications$.subscribe((items) => {
      this.notifications = items;
      if (items.length) this.loading = false;
      this.rebuildGroups();
      this.cdr.markForCheck();
    });
    this.load();
  }
  ngOnDestroy(): void {
    this.stateSubscription?.unsubscribe();
  }
  load(force = false, event?: any): void {
    this.loading = this.notifications.length === 0;
    this.error = false;
    this.service.load(force).subscribe({
      next: (items) => {
        this.notifications = items;
        this.rebuildGroups();
        this.loading = false;
        event?.target?.complete();
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = true;
        event?.target?.complete();
        this.cdr.markForCheck();
      },
    });
  }
  loadMore(event: any): void {
    this.service.loadMore().subscribe({
      next: (items) => {
        this.notifications = items;
        this.rebuildGroups();
        event?.target?.complete();
        this.cdr.markForCheck();
      },
      error: () => {
        event?.target?.complete();
        this.cdr.markForCheck();
      },
    });
  }
  markAllRead(): void {
    this.markAllError = false;
    this.service.markAllRead().subscribe({
      error: () => {
        this.markAllError = true;
        this.cdr.markForCheck();
      },
    });
  }
  private rebuildGroups(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const grouped = new Map<string, AppNotification[]>();
    for (const item of this.notifications) {
      const date = new Date(item.createdAt);
      date.setHours(0, 0, 0, 0);
      const key =
        date.getTime() === today.getTime()
          ? 'TODAY'
          : date.getTime() === yesterday.getTime()
          ? 'YESTERDAY'
          : 'EARLIER';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }
    this.groups = ['TODAY', 'YESTERDAY', 'EARLIER']
      .filter((key) => grouped.has(key))
      .map((key) => ({ key, items: grouped.get(key)! }));
  }
  markRead(item: AppNotification): void {
    if (!item.isRead)
      this.service.markRead(item.id).subscribe({ error: () => undefined });
  }
  trackById(_: number, item: AppNotification): string {
    return item.id;
  }
  iconFor(type: AppNotification['type']): string {
    return notificationTypePresentation(type).icon;
  }
  toneFor(type: AppNotification['type']): string {
    return notificationTypePresentation(type).tone;
  }
}
