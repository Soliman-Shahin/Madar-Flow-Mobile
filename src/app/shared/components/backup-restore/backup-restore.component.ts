import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  OnInit,
  ViewChild,
} from '@angular/core';
import { AlertController, IonicModule } from '@ionic/angular';
import {
  BackupService,
  BackupMetadata,
} from 'src/app/core/services/backup.service';
import { BaseComponent } from '../../base/base.component';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { PlanService } from 'src/app/core/services/plan.service';
import { Permission, PlanSlug } from 'src/app/shared/models/plan.model';
import { UpgradePromptComponent } from '../upgrade-prompt/upgrade-prompt.component';
import { takeUntil } from 'rxjs';
import { OfflineStorageService } from 'src/app/core/services/offline-storage.service';

@Component({
  selector: 'app-backup-restore',
  templateUrl: './backup-restore.component.html',
  styleUrls: ['./backup-restore.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [IonicModule, DatePipe, TranslateModule, UpgradePromptComponent],
})
export class BackupRestoreComponent extends BaseComponent implements OnInit {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  backupHistory: BackupMetadata[] = [];
  loadingMessage = '';
  autoBackupEnabled = false;
  autoBackupFrequency = 24; // hours
  lastAutoBackup: { timestamp: Date; size: number } | null = null;

  // Google Drive
  googleDriveEnabled = false;
  googleDriveEmail: string | null = null;
  isSignedInToGoogleDrive = false;
  googleDriveBackups: any[] = [];
  isLoadingDriveBackups = false;

  // Plan Permissions
  hasDrivePermission = true;
  PlanSlug = PlanSlug;

  constructor(
    private backupService: BackupService,
    private offlineStorage: OfflineStorageService,
    private alertController: AlertController,
    private planService: PlanService
  ) {
    super();
  }

  override ngOnInit() {
    super.ngOnInit();

    this.planService.currentPlan$
      .pipe(takeUntil(this.destroy$))
      .subscribe((planData) => {
        if (planData) {
          this.hasDrivePermission = this.planService.hasPermission(
            Permission.BACKUP_GDRIVE
          );
          this.cdr.markForCheck();
        }
      });

    this.loadHistory();
    this.loadAutoBackupSettings();
    this.loadGoogleDriveSettings();
  }

  loadAutoBackupSettings() {
    const settings = this.backupService.getAutoBackupSettings();
    this.autoBackupEnabled = settings.enabled;
    this.autoBackupFrequency = settings.frequency / (60 * 60 * 1000); // Convert ms to hours

    const lastBackup = this.backupService.getLastAutoBackup();
    if (lastBackup) {
      this.lastAutoBackup = {
        timestamp: new Date(lastBackup.timestamp),
        size: lastBackup.size,
      };
    }
  }

  toggleAutoBackup(event: any) {
    this.autoBackupEnabled = event.detail.checked;
    const frequencyMs = this.autoBackupFrequency * 60 * 60 * 1000; // Convert hours to ms
    this.backupService.setAutoBackupEnabled(
      this.autoBackupEnabled,
      frequencyMs
    );

    if (this.autoBackupEnabled) {
      this.toastService.presentSuccessToast(
        'bottom',
        this.translateService.instant('BACKUP.AUTO_BACKUP_ENABLED')
      );
    } else {
      this.toastService.presentInfoToast(
        'bottom',
        this.translateService.instant('BACKUP.AUTO_BACKUP_DISABLED')
      );
    }
  }

  updateAutoBackupFrequency(event: any) {
    this.autoBackupFrequency = event.detail.value;
    if (this.autoBackupEnabled) {
      const frequencyMs = this.autoBackupFrequency * 60 * 60 * 1000;
      this.backupService.setAutoBackupEnabled(true, frequencyMs);
    }
  }

  loadGoogleDriveSettings() {
    const settings = this.backupService.getGoogleDriveSettings();
    this.googleDriveEnabled = settings.enabled;
    this.googleDriveEmail = settings.email || null;
    this.isSignedInToGoogleDrive = this.backupService.isSignedInToGoogleDrive();

    if (this.isSignedInToGoogleDrive) {
      this.loadGoogleDriveBackups();
    }
  }

  async toggleGoogleDrive(event: any) {
    const enabled = event.detail.checked;

    if (enabled) {
      // Sign in to Google Drive
      const loadingMsg = this.translateService.instant(
        'BACKUP.CONNECTING_GOOGLE_DRIVE'
      );
      this.loadingService.show(loadingMsg);

      try {
        const success = await this.backupService.signInToGoogleDrive();
        if (success) {
          this.googleDriveEnabled = true;
          this.isSignedInToGoogleDrive = true;
          this.googleDriveEmail =
            this.backupService.getGoogleDriveSettings().email || null;

          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('BACKUP.GOOGLE_DRIVE_CONNECTED')
          );

          this.loadGoogleDriveBackups();
        } else {
          this.googleDriveEnabled = false;
          this.toastService.presentErrorToast(
            'bottom',
            this.translateService.instant('BACKUP.GOOGLE_DRIVE_FAILED')
          );
        }
      } catch (error) {
        console.error('Error connecting to Google Drive:', error);
        this.googleDriveEnabled = false;
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('BACKUP.GOOGLE_DRIVE_FAILED')
        );
      } finally {
        this.loadingService.hide(loadingMsg);
      }
    } else {
      // Sign out from Google Drive
      await this.backupService.signOutFromGoogleDrive();
      this.googleDriveEnabled = false;
      this.isSignedInToGoogleDrive = false;
      this.googleDriveEmail = null;

      this.toastService.presentInfoToast(
        'bottom',
        this.translateService.instant('BACKUP.GOOGLE_DRIVE_DISCONNECTED')
      );
    }
  }

  loadHistory() {
    this.backupHistory = this.backupService.getBackupHistory();
  }

  loadGoogleDriveBackups() {
    if (!this.isSignedInToGoogleDrive) return;
    this.isLoadingDriveBackups = true;
    this.setLoading(true);
    this.cdr.markForCheck();

    this.backupService.listGoogleDriveBackups().subscribe({
      next: (backups) => {
        this.googleDriveBackups = backups;
        this.isLoadingDriveBackups = false;
        this.setLoading(false);
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Failed to load Google Drive backups:', error);
        this.isLoadingDriveBackups = false;
        this.setLoading(false);
        this.cdr.markForCheck();
      },
    });
  }

  async restoreFromDrive(fileId: string) {
    const alert = await this.alertController.create({
      header: this.translateService.instant('BACKUP.RESTORE_CONFIRM_TITLE'),
      message: this.translateService.instant('BACKUP.RESTORE_CONFIRM_MSG'),
      cssClass: 'custom-alert backup-restore-alert',
      buttons: [
        {
          text: this.translateService.instant('COMMON.CANCEL'),
          role: 'cancel',
          cssClass: 'backup-restore-alert-action',
        },
        {
          text: this.translateService.instant('BACKUP.RESTORE_ACTION'),
          cssClass: 'backup-restore-alert-action',
          handler: () => {
            this.setLoading(true);
            this.loadingMessage =
              this.translateService.instant('COMMON.LOADING');
            this.backupService.downloadGoogleDriveBackup(fileId).subscribe({
              next: (content) => {
                this.setLoading(false);
                this.processImport(content);
              },
              error: (err) => {
                this.setLoading(false);
                this.toastService.presentErrorToast(
                  'bottom',
                  this.translateService.instant('BACKUP.FAILED_RESTORE')
                );
                console.error(err);
              },
            });
          },
        },
      ],
    });
    await alert.present();
  }

  async deleteFromDrive(fileId: string, event: Event) {
    event.stopPropagation();
    const alert = await this.alertController.create({
      header: this.translateService.instant('COMMON.DELETE_CONFIRM'),
      message: this.translateService.instant('CONFIRM.DELETE_MESSAGE'),
      cssClass: 'custom-alert backup-restore-alert',
      buttons: [
        {
          text: this.translateService.instant('COMMON.CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translateService.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: () => {
            this.setLoading(true);
            this.backupService.deleteGoogleDriveBackup(fileId).subscribe({
              next: (success) => {
                this.setLoading(false);
                if (success) {
                  this.toastService.presentSuccessToast(
                    'bottom',
                    this.translateService.instant('TOAST.DELETE_SUCCESS')
                  );
                  this.loadGoogleDriveBackups();
                } else {
                  this.toastService.presentErrorToast(
                    'bottom',
                    'Failed to delete backup'
                  );
                }
              },
              error: (err) => {
                this.setLoading(false);
                console.error(err);
                this.toastService.presentErrorToast(
                  'bottom',
                  'Error deleting backup'
                );
              },
            });
          },
        },
      ],
    });
    await alert.present();
  }

  async createBackup() {
    const alert = await this.alertController.create({
      header: this.translateService.instant('BACKUP.CREATE_ALERT_TITLE'),
      message: this.translateService.instant('BACKUP.CREATE_ALERT_MSG'),
      cssClass: 'custom-alert backup-restore-alert',
      inputs: [
        {
          name: 'password',
          type: 'password',
          placeholder: this.translateService.instant(
            'BACKUP.PASSWORD_PLACEHOLDER'
          ),
        },
      ],
      buttons: [
        {
          text: this.translateService.instant('COMMON.CANCEL'),
          role: 'cancel',
          cssClass: 'backup-restore-alert-action',
        },
        {
          text: this.translateService.instant('COMMON.CREATE'),
          cssClass: 'backup-restore-alert-action',
          handler: (data: any) => {
            this.performBackup(!!data.password, data.password);
          },
        },
      ],
    });

    await alert.present();
  }

  private performBackup(encrypt: boolean, password?: string) {
    this.setLoading(true);
    this.loadingMessage = this.translateService.instant('COMMON.LOADING');

    this.backupService.createFullBackup(encrypt, password).subscribe({
      next: async (backup) => {
        this.setLoading(false);
        this.loadHistory();

        // Export immediately
        try {
          await this.backupService.exportBackup(backup);
          this.toastService.presentSuccessToast(
            'bottom',
            this.translateService.instant('BACKUP.SUCCESS_CREATE')
          );
        } catch (error) {
          this.toastService.presentWarningToast(
            'bottom',
            this.translateService.instant('BACKUP.FAILED_CREATE')
          );
        }
      },
      error: (error) => {
        this.setLoading(false);
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('BACKUP.FAILED_CREATE')
        );
        console.error(error);
      },
    });
  }

  triggerImport() {
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const content = e.target.result;
      await this.processImport(content);
    };
    reader.readAsText(file);

    // Reset input
    event.target.value = '';
  }

  private async processImport(content: string) {
    try {
      // Try to parse first to check if encrypted
      let backupData;
      try {
        backupData = JSON.parse(content);
      } catch {
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant('BACKUP.INVALID_FILE')
        );
        return;
      }

      if (backupData.encrypted) {
        // For encrypted backup, show password prompt
        await this.showPasswordPrompt(content);
      } else {
        // For unencrypted backup, ask for confirmation
        await this.showRestoreConfirmation(content);
      }
    } catch (error) {
      this.toastService.presentErrorToast(
        'bottom',
        this.translateService.instant('BACKUP.INVALID_FILE')
      );
    }
  }

  private async performRestore(content: string, password?: string) {
    if (await this.offlineStorage.hasUnsyncedChanges()) {
      this.toastService.presentErrorToast(
        'bottom',
        this.translateService.instant('BACKUP.RESTORE_BLOCKED_UNSYNCED')
      );
      return;
    }
    this.setLoading(true);
    this.loadingMessage = this.translateService.instant('COMMON.LOADING');

    try {
      const backup = await this.backupService.importBackup(content, password);
      this.backupService.assertRestoreOwnership(backup);

      this.backupService.restoreFromBackup(backup).subscribe({
        next: (success) => {
          this.setLoading(false);
          if (success) {
            this.toastService.presentSuccessToast(
              'bottom',
              this.translateService.instant('BACKUP.SUCCESS_RESTORE')
            );
            // Optional: Reload app or navigate to home
          } else {
            this.toastService.presentErrorToast(
              'bottom',
              this.translateService.instant('BACKUP.FAILED_RESTORE')
            );
          }
        },
        error: (error) => {
          this.setLoading(false);
          this.toastService.presentErrorToast(
            'bottom',
            this.translateService.instant('BACKUP.FAILED_RESTORE')
          );
          console.error(error);
        },
      });
    } catch (error: unknown) {
      this.setLoading(false);
      const code = (error as { code?: string })?.code;
      const messageKey =
        code === 'BACKUP_OWNER_MISMATCH'
          ? 'BACKUP.OWNER_MISMATCH'
          : code === 'BACKUP_OWNER_UNKNOWN'
          ? 'BACKUP.OWNER_UNKNOWN'
          : code === 'BACKUP_INVALID'
          ? 'BACKUP.INVALID_FILE'
          : 'BACKUP.WRONG_PASSWORD';
      this.toastService.presentErrorToast(
        'bottom',
        this.translateService.instant(messageKey)
      );
    }
  }

  async shareBackup(backupMetadata: BackupMetadata) {
    // Since we don't store the full backup content in history (too large),
    // we can't re-export from history directly without reading from storage/file.
    // For now, we'll just show info.
    // Ideally, we should store backups in files and keep paths in metadata.
    this.toastService.presentInfoToast(
      'bottom',
      this.translateService.instant('COMMON.NOT_SUPPORTED')
    );
  }

  formatSize(bytes: number): string {
    return this.backupService.formatFileSize(bytes);
  }

  private async showPasswordPrompt(content: string) {
    const alert = await this.alertController.create({
      header: this.translateService.instant('BACKUP.DECRYPT_ALERT_TITLE'),
      message: this.translateService.instant('BACKUP.DECRYPT_ALERT_MSG'),
      cssClass: 'custom-alert backup-restore-alert',
      inputs: [
        {
          name: 'password',
          type: 'password',
          placeholder: this.translateService.instant(
            'BACKUP.PASSWORD_PLACEHOLDER'
          ),
        },
      ],
      buttons: [
        {
          text: this.translateService.instant('COMMON.CANCEL'),
          role: 'cancel',
          cssClass: 'backup-restore-alert-action',
        },
        {
              text: this.translateService.instant('BACKUP.RESTORE_ACTION'),
              cssClass: 'backup-restore-alert-action',
          handler: (data: any) => {
            if (data.password) {
              this.performRestore(content, data.password);
              return true;
            } else {
              this.toastService.presentWarningToast(
                'bottom',
                this.translateService.instant('BACKUP.PASSWORD_REQUIRED')
              );
              return false;
            }
          },
        },
      ],
    });

    await alert.present();
  }

  private async showRestoreConfirmation(content: string) {
    const alert = await this.alertController.create({
      header: this.translateService.instant('BACKUP.RESTORE_CONFIRM_TITLE'),
      message: this.translateService.instant('BACKUP.RESTORE_CONFIRM_MSG'),
      cssClass: 'custom-alert backup-restore-alert',
      buttons: [
        {
          text: this.translateService.instant('COMMON.CANCEL'),
          role: 'cancel',
          cssClass: 'backup-restore-alert-action',
        },
        {
          text: this.translateService.instant('BACKUP.RESTORE_ACTION'),
          cssClass: 'backup-restore-alert-action',
          handler: () => {
            this.performRestore(content);
          },
        },
      ],
    });

    await alert.present();
  }
}
