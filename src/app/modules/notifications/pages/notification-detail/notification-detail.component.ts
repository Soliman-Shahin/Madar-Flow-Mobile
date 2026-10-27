import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { finalize } from 'rxjs';
import {
  AppNotification,
  notificationTypePresentation,
} from 'src/app/core/models/app-notification.model';
import { ApiService } from 'src/app/core/services/api.service';
import { SkeletonBlockComponent } from 'src/app/shared/ui/skeleton-block/skeleton-block.component';
import { NotificationService } from 'src/app/core/services/notification.service';

export function shouldOpenSyncConflict(notification: AppNotification): boolean {
  const conflictId = notification.metadata?.['conflictId'];
  const entityType = notification.metadata?.['entityType'];
  return (
    notification.event === 'sync.conflict' &&
    typeof conflictId === 'string' &&
    conflictId.trim().length > 0 &&
    ['expense', 'outcome', 'category'].includes(String(entityType))
  );
}

@Component({
  selector: 'app-notification-detail',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, SkeletonBlockComponent],
  template: `
    <ion-header mode="ios" class="mf-sub-header" translucent="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/notifications"
            [text]="''"
            [attr.aria-label]="'COMMON.BACK' | translate"
          ></ion-back-button>
        </ion-buttons>
        <ion-title>{{ 'MOBILE_UI.NOTIFICATION' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="mf-note-detail">
      <div class="mf-note-detail__body">
        <div
          *ngIf="loading"
          role="status"
          aria-busy="true"
          [attr.aria-label]="'COMMON.LOADING' | translate"
        >
          <app-skeleton-block variant="detail"></app-skeleton-block>
        </div>
        <article class="mf-note-detail__card" *ngIf="notification as item">
          <span
            [class]="
              'mf-note-detail__kind tone-' + typePresentation(item.type).tone
            "
          >
            <ion-icon
              [name]="typePresentation(item.type).icon"
              aria-hidden="true"
            ></ion-icon>
            {{ typePresentation(item.type).labelKey | translate }}
          </span>
          <h1 class="mf-note-detail__title" dir="auto">{{ item.title }}</h1>
          <time class="mf-note-detail__time"
            ><bdi>{{ formatDate(item.createdAt) }}</bdi></time
          >
          <p class="mf-note-detail__message" dir="auto">{{ item.message }}</p>
          <ion-button
            *ngIf="canReviewSyncConflict(item)"
            expand="block"
            class="mf-auth__primary"
            (click)="reviewSyncConflict(item)"
          >
            {{ 'SYNC.REVIEW_CONFLICT' | translate }}
          </ion-button>
        </article>
        <p class="mf-auth__error" role="alert" *ngIf="error">
          <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
          <span>{{ error | translate }}</span>
        </p>
      </div>
    </ion-content>
  `,
  styleUrls: ['./notification-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationDetailComponent implements OnInit {
  notification: AppNotification | null = null;
  loading = true;
  error = '';
  typePresentation = notificationTypePresentation;
  private readonly translateSvc = inject(TranslateService);

  /** Full date and time in the current language, Western digits. */
  formatDate(value: string | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(this.translateSvc.currentLang || 'en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      numberingSystem: 'latn',
    }).format(date);
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private apiService: ApiService,
    private notificationService: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
      this.loading = false;
      this.error = 'MOBILE_UI.NOT_FOUND';
      return;
    }

    const cached = this.notificationService.getCached(id);
    if (cached) {
      this.notification = cached;
      this.loading = false;
      this.cdr.markForCheck();
    }

    this.apiService
      .get<AppNotification>(`/notifications/${id}`)
      .pipe(
        finalize(() => {
          this.loading = false;
          if (!this.notification && !this.error) {
            this.error = 'MOBILE_UI.UNAVAILABLE';
          }
          this.cdr.markForCheck();
        })
      )
      .subscribe({
        next: (notification) => {
          this.notification = notification;
          this.notificationService
            .markRead(id)
            .subscribe({ error: () => undefined });
          this.apiService
            .patch(`/notifications/${id}/read`, {})
            .subscribe({ error: () => undefined });
        },
        error: () => {
          this.error = 'MOBILE_UI.UNAVAILABLE';
        },
      });
  }

  canReviewSyncConflict(notification: AppNotification): boolean {
    return shouldOpenSyncConflict(notification);
  }

  reviewSyncConflict(notification: AppNotification): void {
    if (!shouldOpenSyncConflict(notification)) return;
    void this.router.navigate(['/settings/conflicts']);
  }
}
