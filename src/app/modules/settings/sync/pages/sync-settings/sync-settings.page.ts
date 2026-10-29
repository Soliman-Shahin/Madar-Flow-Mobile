import { Component, OnInit, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { LoadingController, IonicModule } from '@ionic/angular';

import { SyncService } from 'src/app/core/services/sync.service';
import { OfflineStorageService } from 'src/app/core/services/offline-storage.service';
import { SyncConfig } from 'src/app/shared/models/sync.model';
import { BaseComponent } from 'src/app/shared/base';
import { AsyncPipe, DatePipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { APP_ROUTES } from 'src/app/core/constants';

@Component({
  selector: 'app-sync-settings',
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
        <ion-title>{{ 'SYNC.SETTINGS_TITLE' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="settings-content" [fullscreen]="true">
      <form
        [formGroup]="syncForm"
        (ngSubmit)="saveSettings()"
        class="settings-container"
      >
        <div class="section-label">{{ 'SYNC.AUTO_SYNC' | translate }}</div>
        <ion-list inset="true" class="premium-list">
          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-cyan">
              <ion-icon name="sync"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.ENABLE_AUTO_SYNC' | translate }}</h3>
              <p>{{ 'SYNC.AUTO_SYNC_DESC' | translate }}</p>
            </ion-label>
            <ion-toggle
              [attr.aria-label]="'SYNC.ENABLE_AUTO_SYNC' | translate"
              formControlName="autoSync"
              slot="end"
              color="primary"
            ></ion-toggle>
          </ion-item>

          @if (syncForm.get('autoSync')?.value) {
          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-blue">
              <ion-icon name="time"></ion-icon>
            </div>
            <ion-label>{{ 'SYNC.SYNC_INTERVAL' | translate }}</ion-label>
            <ion-select
              [attr.aria-label]="'SYNC.SYNC_INTERVAL' | translate"
              formControlName="syncInterval"
              interface="popover"
              slot="end"
              class="modern-select"
            >
              <ion-select-option value="60000">{{
                'SYNC.EVERY_MINUTE' | translate
              }}</ion-select-option>
              <ion-select-option value="300000">{{
                'SYNC.EVERY_5_MINUTES' | translate
              }}</ion-select-option>
              <ion-select-option value="900000">{{
                'SYNC.EVERY_15_MINUTES' | translate
              }}</ion-select-option>
            </ion-select>
          </ion-item>
          }
        </ion-list>

        <div class="section-label">
          {{ 'SYNC.CONFLICT_RESOLUTION' | translate }}
        </div>
        <ion-list inset="true" class="premium-list">
          <ion-item
            lines="none"
            button="true"
            detail="true"
            (click)="openConflicts($event)"
            [attr.aria-label]="'SYNC.CONFLICT_STRATEGY' | translate"
            class="conflict-navigation-row"
          >
            <div slot="start" class="icon-wrapper color-red">
              <ion-icon name="git-compare"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.CONFLICT_STRATEGY' | translate }}</h3>
              <p>{{ 'SYNC.CONFLICT_INFO' | translate }}</p>
            </ion-label>
          </ion-item>
        </ion-list>

        <div class="section-label">{{ 'SYNC.ADVANCED' | translate }}</div>
        <ion-list inset="true" class="premium-list">
          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-green">
              <ion-icon name="layers"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.BATCH_SIZE' | translate }}</h3>
              <p>{{ 'SYNC.BATCH_SIZE_DESC' | translate }}</p>
            </ion-label>
            <ion-input
              type="number"
              [attr.aria-label]="'SYNC.BATCH_SIZE' | translate"
              formControlName="batchSize"
              min="1"
              max="100"
              slot="end"
              class="right-align-input"
            ></ion-input>
          </ion-item>
        </ion-list>

        <div class="section-label">{{ 'SYNC.STORAGE_INFO' | translate }}</div>
        <ion-list inset="true" class="premium-list">
          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-dark">
              <ion-icon name="folder"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.OFFLINE_STORAGE' | translate }}</h3>
              <p>{{ storageSize | async | number : '1.2-2' }} KB</p>
            </ion-label>
          </ion-item>

          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-blue">
              <ion-icon name="time"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.LAST_SUCCESSFUL_SYNC' | translate }}</h3>
              <p>
                {{
                  (syncMetadata$ | async)?.lastSyncTime
                    ? ((syncMetadata$ | async)?.lastSyncTime | date : 'medium')
                    : ('SYNC.NEVER' | translate)
                }}
              </p>
            </ion-label>
          </ion-item>

          <ion-item lines="none">
            <div slot="start" class="icon-wrapper color-orange">
              <ion-icon name="cloud-upload"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.PENDING_SYNC' | translate }}</h3>
              <p>{{ pendingCount | async }} {{ 'SYNC.ITEMS' | translate }}</p>
            </ion-label>
          </ion-item>
        </ion-list>

        <div class="mf-sync-actions">
          <ion-button
            expand="block"
            type="submit"
            class="mf-sync-primary"
            [disabled]="!hasUnsavedChanges"
            [attr.aria-disabled]="!hasUnsavedChanges"
          >
            <ion-icon name="save-outline" slot="start"></ion-icon>
            {{ 'COMMON.SAVE' | translate }}
          </ion-button>

          <ion-button
            expand="block"
            type="button"
            class="mf-sync-secondary"
            (click)="forceSync()"
            [disabled]="
              !syncService.isOnlineStatus() || syncService.isSyncInProgress()
            "
            [attr.aria-busy]="syncService.isSyncInProgress()"
          >
            @if (syncService.isSyncInProgress()) {
            <ion-spinner name="crescent" slot="start"></ion-spinner>
            {{ 'SYNC.SYNCING' | translate }}
            } @else {
            <ion-icon name="sync-outline" slot="start"></ion-icon>
            {{ 'SYNC.SYNC_NOW' | translate }}
            }
          </ion-button>
        </div>

        <ion-list inset="true" class="premium-list mf-sync-tools">
          <ion-item
            lines="none"
            button="true"
            detail="true"
            (click)="createBackup()"
          >
            <div slot="start" class="icon-wrapper color-indigo">
              <ion-icon name="download-outline"></ion-icon>
            </div>
            <ion-label>
              <h3>{{ 'SYNC.CREATE_BACKUP' | translate }}</h3>
              <p>{{ 'SYNC.CREATE_BACKUP_DESC' | translate }}</p>
            </ion-label>
          </ion-item>
          <ion-item
            lines="none"
            button="true"
            detail="false"
            (click)="clearOfflineData()"
          >
            <div slot="start" class="icon-wrapper color-red">
              <ion-icon name="trash-outline"></ion-icon>
            </div>
            <ion-label color="danger">
              <h3>{{ 'SYNC.CLEAR_OFFLINE_DATA' | translate }}</h3>
              <p>{{ 'SYNC.CLEAR_OFFLINE_DATA_DESC' | translate }}</p>
            </ion-label>
          </ion-item>
        </ion-list>
      </form>
    </ion-content>
  `,
  styleUrls: ['sync-settings.page.scss'],
  standalone: true,
  imports: [
    IonicModule,
    FormsModule,
    ReactiveFormsModule,
    AsyncPipe,
    DatePipe,
    DecimalPipe,
    TranslateModule,
    RouterModule,
  ],
})
export class SyncSettingsPage extends BaseComponent implements OnInit {
  readonly conflictRoute = `/${APP_ROUTES.SETTINGS.INDEX}/${APP_ROUTES.SETTINGS.CONFLICTS}`;
  public syncService = inject(SyncService);
  private offlineStorage = inject(OfflineStorageService);
  private formBuilder = inject(FormBuilder);
  private loadingController = inject(LoadingController);

  syncForm!: FormGroup;
  storageSize = this.offlineStorage.getStorageSize();
  pendingCount = this.syncService.getPendingCount();
  syncMetadata$ = this.syncService.syncMetadata$;

  openConflicts(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.router.navigate([
      `/${APP_ROUTES.SETTINGS.INDEX}/${APP_ROUTES.SETTINGS.CONFLICTS}`,
    ]);
  }
  private clearingOfflineData = false;
  hasUnsavedChanges = false;
  private savedFormValue = '';

  override ngOnInit() {
    super.ngOnInit();
    const config = this.syncService.getConfig();
    this.syncForm = this.formBuilder.group({
      autoSync: [config.autoSync ?? true],
      syncInterval: [config.syncInterval?.toString() ?? '300000'],
      batchSize: [
        config.batchSize ?? 50,
        [Validators.required, Validators.min(1), Validators.max(100)],
      ],
    });
    this.savedFormValue = this.formValueKey();
    this.syncForm.valueChanges.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.hasUnsavedChanges = this.formValueKey() !== this.savedFormValue;
    });
  }

  saveSettings(): void {
    if (this.syncForm.valid) {
      const formValue = this.syncForm.value;
      const config: Partial<SyncConfig> = {
        autoSync: formValue.autoSync,
        syncInterval: parseInt(formValue.syncInterval),
        batchSize: formValue.batchSize,
      };

      this.syncService.updateConfig(config);
      this.savedFormValue = this.formValueKey();
      this.hasUnsavedChanges = false;
      this.toastService.presentSuccessToast('bottom', 'SYNC.SETTINGS_SAVED');
    }
  }

  private formValueKey(): string {
    const value = this.syncForm?.getRawValue();
    return JSON.stringify({
      autoSync: value?.autoSync,
      syncInterval: value?.syncInterval,
      batchSize: Number(value?.batchSize),
    });
  }

  async forceSync(): Promise<void> {
    if (
      !this.syncService.isOnlineStatus() ||
      this.syncService.isSyncInProgress()
    ) {
      return;
    }
    this.syncService.forceSync().subscribe({
      next: (success) => {
        if (success) {
          this.toastService.presentSuccessToast('bottom', 'SYNC.SYNC_SUCCESS');
        } else {
          this.toastService.presentErrorToast('bottom', 'SYNC.SYNC_FAILED');
        }
      },
      error: () => {
        this.toastService.presentErrorToast('bottom', 'SYNC.SYNC_ERROR');
      },
    });
  }

  async clearOfflineData(): Promise<void> {
    if (this.clearingOfflineData) return;
    const operations = await firstValueFrom(
      this.offlineStorage.getPendingOperations()
    );
    if (
      operations.some(
        (operation) =>
          operation.status === 'pending' || operation.status === 'error'
      )
    ) {
      this.toastService.presentErrorToast('bottom', 'SYNC.CLEAR_DATA_BLOCKED');
      return;
    }
    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant('SYNC.CLEAR_DATA_TITLE'),
      message: this.translateService.instant('SYNC.CLEAR_DATA_MESSAGE'),
      confirmText: this.translateService.instant('COMMON.DELETE'),
      cancelText: this.translateService.instant('COMMON.CANCEL'),
    });

    if (confirmed) {
      this.clearingOfflineData = true;
      const loading = await this.loadingController.create({
        message:
          this.translateService.instant('COMMON.LOADING') || 'Clearing...',
        spinner: 'circles',
      });
      await loading.present();

      this.offlineStorage.clearOfflineData().subscribe({
        next: (success) => {
          loading.dismiss();
          this.clearingOfflineData = false;
          if (success) {
            this.toastService.presentSuccessToast(
              'bottom',
              'SYNC.DATA_CLEARED'
            );
          } else {
            this.toastService.presentErrorToast('bottom', 'SYNC.CLEAR_FAILED');
          }
        },
        error: () => {
          loading.dismiss();
          this.clearingOfflineData = false;
          this.toastService.presentErrorToast('bottom', 'SYNC.CLEAR_ERROR');
        },
      });
    }
  }

  async createBackup(): Promise<void> {
    const loading = await this.loadingController.create({
      message:
        this.translateService.instant('SYNC.CREATING_BACKUP') ||
        'Creating Backup...',
      spinner: 'circles',
    });
    await loading.present();

    this.offlineStorage.createBackup().subscribe({
      next: (backup) => {
        loading.dismiss();
        if (backup) {
          try {
            const blob = new Blob([JSON.stringify(backup, null, 2)], {
              type: 'application/json',
            });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `expenses_backup_${
              new Date().toISOString().split('T')[0]
            }.json`;
            a.click();
            window.URL.revokeObjectURL(url);

            this.toastService.presentSuccessToast(
              'bottom',
              'SYNC.BACKUP_CREATED'
            );
          } catch {
            this.toastService.presentErrorToast('bottom', 'SYNC.BACKUP_ERROR');
          }
        } else {
          this.toastService.presentErrorToast('bottom', 'SYNC.BACKUP_FAILED');
        }
      },
      error: () => {
        loading.dismiss();
        this.toastService.presentErrorToast('bottom', 'SYNC.BACKUP_ERROR');
      },
    });
  }
}
