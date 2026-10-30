import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PlanService } from 'src/app/core/services/plan.service';
import { Permission, PlanSlug } from 'src/app/shared/models/plan.model';
import { ToastService } from 'src/app/shared/services/toast.service';
import { UpgradePromptComponent } from 'src/app/shared/components/upgrade-prompt/upgrade-prompt.component';
import {
  DataExportService,
  ExportFormat,
  NothingToExportError,
} from './data-export.service';
import { ExportPeriod } from './export-data.util';

@Component({
  selector: 'app-data-export',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonicModule, TranslateModule, RouterModule, UpgradePromptComponent],
  styleUrls: ['data-export.page.scss'],
  template: `
    <ion-header mode="ios" class="settings-header" translucent="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button
            routerLink="/settings/list"
            class="modern-back-btn"
            [attr.aria-label]="'COMMON.BACK' | translate"
          >
            <ion-icon name="chevron-back"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title>{{ 'EXPORT.TITLE' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="settings-content" [fullscreen]="true">
      <div class="settings-container mf-export">
        <p class="mf-export__intro">{{ 'EXPORT.SUBTITLE' | translate }}</p>

        @if (!allowed) {
        <app-upgrade-prompt
          title="SUBSCRIPTION.FEATURE_LOCKED"
          message="EXPORT.LOCKED_MSG"
          icon="download-outline"
          [requiredPlan]="PlanSlug.PRO"
        ></app-upgrade-prompt>
        }

        <h2 class="section-label">{{ 'EXPORT.PERIOD' | translate }}</h2>
        <ion-list class="premium-list">
          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-indigo">
              <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'EXPORT.PERIOD' | translate }}</h3>
            </ion-label>
            <ion-select
              slot="end"
              [attr.aria-label]="'EXPORT.PERIOD' | translate"
              [cancelText]="'COMMON.CANCEL' | translate"
              [value]="period"
              [disabled]="!allowed || busy"
              (ionChange)="onPeriodChange($event)"
              interface="action-sheet"
              class="modern-select"
            >
              @for (opt of periods; track opt.value) {
              <ion-select-option [value]="opt.value">{{
                opt.label | translate
              }}</ion-select-option>
              }
            </ion-select>
          </ion-item>
        </ion-list>

        <h2 class="section-label">{{ 'EXPORT.FORMAT' | translate }}</h2>
        <ion-list class="premium-list">
          <ion-item
            button
            detail="false"
            lines="none"
            [disabled]="!allowed || busy"
            (click)="run('csv')"
          >
            <div slot="start" class="icon-wrapper color-green">
              <ion-icon name="grid-outline" aria-hidden="true"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'EXPORT.CSV' | translate }}</h3>
              <p>{{ 'EXPORT.CSV_DESC' | translate }}</p>
            </ion-label>
            @if (busy === 'csv') {
            <ion-spinner slot="end" name="crescent"></ion-spinner>
            }
          </ion-item>
          <ion-item
            button
            detail="false"
            lines="none"
            [disabled]="!allowed || busy"
            (click)="run('pdf')"
          >
            <div slot="start" class="icon-wrapper color-orange">
              <ion-icon name="document-text-outline" aria-hidden="true"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'EXPORT.PDF' | translate }}</h3>
              <p>{{ 'EXPORT.PDF_DESC' | translate }}</p>
            </ion-label>
            @if (busy === 'pdf') {
            <ion-spinner slot="end" name="crescent"></ion-spinner>
            }
          </ion-item>
        </ion-list>

        <p class="section-note">{{ 'EXPORT.PRIVACY_NOTE' | translate }}</p>
      </div>
    </ion-content>
  `,
})
export class DataExportPage {
  private readonly planService = inject(PlanService);
  private readonly exporter = inject(DataExportService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly PlanSlug = PlanSlug;
  readonly periods: { value: ExportPeriod; label: string }[] = [
    { value: 'this-month', label: 'EXPORT.PERIOD_THIS_MONTH' },
    { value: 'last-month', label: 'EXPORT.PERIOD_LAST_MONTH' },
    { value: 'last-3-months', label: 'EXPORT.PERIOD_LAST_3_MONTHS' },
    { value: 'this-year', label: 'EXPORT.PERIOD_THIS_YEAR' },
    { value: 'all', label: 'EXPORT.PERIOD_ALL' },
  ];

  period: ExportPeriod = 'this-month';
  allowed = false;
  busy: ExportFormat | null = null;

  constructor() {
    // Follow the plan stream so a late-loading plan unlocks the page too.
    this.planService.currentPlan$
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        this.allowed = this.planService.hasPermission(
          Permission.EXPENSE_EXPORT
        );
        this.cdr.markForCheck();
      });
  }

  async ionViewWillEnter(): Promise<void> {
    try {
      await this.planService.getMyPlan();
    } catch {
      /* keep the cached decision when offline */
    }
    this.allowed = this.planService.hasPermission(Permission.EXPENSE_EXPORT);
    this.cdr.markForCheck();
  }

  onPeriodChange(event: any): void {
    this.period = event.detail.value as ExportPeriod;
    this.cdr.markForCheck();
  }

  async run(format: ExportFormat): Promise<void> {
    // Re-check at the moment of action; the UI state is only a convenience.
    if (!this.allowed || this.busy) return;
    this.busy = format;
    this.cdr.markForCheck();
    try {
      const outcome = await this.exporter.export(format, this.period);
      if (outcome !== 'cancelled') {
        void this.toast.presentSuccessToast(
          'bottom',
          this.translate.instant(
            outcome === 'shared' ? 'EXPORT.READY_SHARED' : 'EXPORT.READY_DOWNLOADED'
          )
        );
      }
    } catch (error) {
      const message =
        error instanceof NothingToExportError
          ? 'EXPORT.NOTHING'
          : 'EXPORT.FAILED';
      void this.toast.presentErrorToast(
        'bottom',
        this.translate.instant(message)
      );
    } finally {
      this.busy = null;
      this.cdr.markForCheck();
    }
  }
}
