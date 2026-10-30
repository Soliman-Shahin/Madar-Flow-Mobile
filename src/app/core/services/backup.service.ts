import { Injectable } from '@angular/core';
import { Observable, from, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap, tap } from 'rxjs/operators';
import { OfflineStorageService } from './offline-storage.service';
import { EncryptionService } from './encryption.service';
import { StorageService } from 'src/app/modules/auth/services/storage.service';
import { GoogleDriveService } from './google-drive.service';
import { TokenService } from 'src/app/modules/auth/services/token.service';
import { ExpenseService } from './expense.service';
import { CategoryService } from 'src/app/modules/categories/services/categories.service';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

export interface BackupData {
  version: string;
  timestamp: Date;
  encrypted: boolean;
  data: {
    expenses: any[];
    categories: any[];
    user: any;
    settings?: any;
  };
  profileImage?: string; // Base64 encoded image
  metadata: {
    deviceInfo?: string;
    appVersion: string;
    totalExpenses: number;
    totalCategories: number;
  };
}

export interface BackupMetadata {
  id: string;
  name: string;
  timestamp: Date;
  size: number; // in bytes
  encrypted: boolean;
  itemCount: number;
  hasProfileImage: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class BackupService {
  private readonly BACKUP_VERSION = '1.0.0';
  private readonly BACKUP_STORAGE_KEY = 'backup_history';
  private readonly MAX_BACKUP_HISTORY = 10;
  private readonly AUTO_BACKUP_KEY = 'auto_backup_settings';
  private readonly AUTO_BACKUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  private readonly GOOGLE_DRIVE_SETTINGS_KEY = 'google_drive_backup_settings';

  private autoBackupTimer: any;

  constructor(
    private offlineStorage: OfflineStorageService,
    private encryptionService: EncryptionService,
    private storageService: StorageService,
    private googleDriveService: GoogleDriveService,
    private tokenService: TokenService,
    private expenseService: ExpenseService,
    private categoryService: CategoryService
  ) {
    this.initAutoBackup();
  }

  /**
   * Create a full backup of all user data including profile image
   */
  createFullBackup(
    encrypt: boolean = false,
    password?: string
  ): Observable<BackupData> {
    return forkJoin({
      expenses: this.expenseService.getExpenses(undefined, true),
      categories: this.categoryService
        .getCategories({ skip: 0, limit: 1000, sort: 'createdAt' }, true)
        .pipe(map((result) => result.data)),
      settings: of(this.getSettings()),
      profileImage: from(this.getProfileImage()),
    }).pipe(
      switchMap(({ expenses, categories, settings, profileImage }) => {
        const backupData: BackupData = {
          version: this.BACKUP_VERSION,
          timestamp: new Date(),
          encrypted: encrypt,
          data: {
            expenses: expenses || [],
            categories: categories || [],
            user: this.tokenService.getUserId()
              ? { _id: this.tokenService.getUserId() }
              : null,
            settings: settings,
          },
          profileImage: profileImage,
          metadata: {
            appVersion: this.BACKUP_VERSION,
            totalExpenses: expenses?.length || 0,
            totalCategories: categories?.length || 0,
          },
        };

        if (encrypt) {
          return from(this.encryptBackup(backupData, password));
        }

        return of(backupData);
      }),
      tap((backup) => this.saveBackupMetadata(backup)),
      catchError((error) => {
        console.error('Error creating backup:', error);
        throw new Error('Failed to create backup');
      })
    );
  }

  /**
   * Export backup to file (web download)
   */
  async exportBackup(backup: BackupData, fileName?: string): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = fileName || `madar-flow-backup-${timestamp}.json`;
      const jsonString = JSON.stringify(backup, null, 2);

      // Web platform - download file
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      return name;
    } catch (error) {
      console.error('Error exporting backup:', error);
      throw new Error('Failed to export backup');
    }
  }

  /**
   * Import backup from file
   */
  async importBackup(
    fileContent: string,
    password?: string
  ): Promise<BackupData> {
    try {
      const backup: BackupData = JSON.parse(fileContent);

      if (backup.version !== this.BACKUP_VERSION || !backup.data) {
        throw new Error('Invalid backup file format');
      }

      if (backup.encrypted) {
        const decrypted = await this.decryptBackup(backup, password);
        this.validateBackupData(decrypted);
        return decrypted;
      }

      this.validateBackupData(backup);
      return backup;
    } catch (error) {
      const safeError = new Error('Failed to import backup');
      (safeError as any).code =
        (error as any)?.message === 'Backup decryption failed'
          ? 'BACKUP_CRYPTO_FAILURE'
          : 'BACKUP_INVALID';
      throw safeError;
    }
  }

  private validateBackupData(backup: BackupData): void {
    if (
      !Array.isArray(backup.data?.expenses) ||
      !Array.isArray(backup.data?.categories)
    ) {
      throw new Error('Invalid backup file format');
    }
    for (const entities of [backup.data.expenses, backup.data.categories]) {
      const ids = new Set<string>();
      const clientIds = new Set<string>();
      for (const entity of entities) {
        if (
          !entity ||
          typeof entity !== 'object' ||
          (!entity._id && !entity._clientId)
        ) {
          throw new Error('Invalid backup file format');
        }
        if (entity._id && ids.has(String(entity._id)))
          throw new Error('Invalid backup file format');
        if (entity._clientId && clientIds.has(String(entity._clientId)))
          throw new Error('Invalid backup file format');
        if (entities === backup.data.expenses) {
          if (
            typeof entity.amount !== 'number' ||
            !Number.isFinite(entity.amount) ||
            entity.amount <= 0 ||
            !(
              (typeof entity.category === 'string' && entity.category.trim()) ||
              (entity.category &&
                typeof entity.category === 'object' &&
                typeof entity.category._id === 'string' &&
                entity.category._id.trim())
            ) ||
            typeof entity.description !== 'string' ||
            typeof entity.date !== 'string' ||
            Number.isNaN(new Date(entity.date).getTime())
          )
            throw new Error('Invalid backup file format');
        } else if (typeof entity.title !== 'string' || !entity.title.trim()) {
          throw new Error('Invalid backup file format');
        }
        if (entity._id) ids.add(String(entity._id));
        if (entity._clientId) clientIds.add(String(entity._clientId));
      }
    }
    const categoryIds = new Set(
      backup.data.categories.map((category) =>
        String(category._id || category._clientId)
      )
    );
    for (const expense of backup.data.expenses) {
      const categoryId =
        typeof expense.category === 'object'
          ? expense.category._id
          : expense.category;
      if (!categoryIds.has(String(categoryId)))
        throw new Error('Invalid backup file format');
    }
    if (
      backup.data.user !== null &&
      backup.data.user !== undefined &&
      typeof backup.data.user !== 'object'
    ) {
      throw new Error('Invalid backup file format');
    }
  }

  assertRestoreOwnership(backup: BackupData): void {
    const currentUserId = this.tokenService.getUserId();
    const backupOwnerId = backup.data.user?._id;
    if (!currentUserId || !backupOwnerId) {
      const error = new Error('Backup ownership cannot be verified');
      (error as any).code = 'BACKUP_OWNER_UNKNOWN';
      throw error;
    }
    if (String(currentUserId) !== String(backupOwnerId)) {
      const error = new Error('Backup belongs to another account');
      (error as any).code = 'BACKUP_OWNER_MISMATCH';
      throw error;
    }
  }

  /**
   * Restore data from backup
   */
  restoreFromBackup(
    backup: BackupData,
    includeProfileImage: boolean = true
  ): Observable<boolean> {
    return this.offlineStorage
      .replaceEntitiesAtomically(backup.data.expenses, backup.data.categories)
      .pipe(
        switchMap((dataRestored) => {
          if (!dataRestored) return of(false);
          // Core records are atomic. Supplemental settings are intentionally not
          // restored: app_settings has no writers outside this service and must
          // never become a broad security/settings import surface.
          if (includeProfileImage && backup.profileImage) {
            return from(this.restoreProfileImage(backup.profileImage)).pipe(
              map(() => true)
            );
          }
          return of(true);
        }),
        catchError((error) => {
          console.error('Error restoring backup:', error);
          return of(false);
        })
      );
  }

  /**
   * Create automatic backup
   */
  createAutoBackup(): Observable<boolean> {
    return this.createFullBackup(true).pipe(
      switchMap((backup) => {
        const backupString = JSON.stringify(backup);
        this.storageService.set('auto_backup', backupString);
        this.storageService.set(
          'auto_backup_timestamp',
          new Date().toISOString()
        );
        return of(true);
      }),
      catchError((error) => {
        console.error('Error creating auto backup:', error);
        return of(false);
      })
    );
  }

  /**
   * Get auto backup
   */
  getAutoBackup(): BackupData | null {
    const backupString = this.storageService.get<string>('auto_backup');
    if (!backupString) return null;

    try {
      return JSON.parse(backupString);
    } catch {
      return null;
    }
  }

  /**
   * Get backup history metadata
   */
  getBackupHistory(): BackupMetadata[] {
    const history = this.storageService.get<BackupMetadata[]>(
      this.BACKUP_STORAGE_KEY
    );
    return history || [];
  }

  // ==================== PRIVATE HELPERS ====================

  private saveBackupMetadata(backup: BackupData): void {
    const history = this.getBackupHistory();

    const metadata: BackupMetadata = {
      id: this.generateId(),
      name: `Backup ${new Date(backup.timestamp).toLocaleDateString()}`,
      timestamp: backup.timestamp,
      size: JSON.stringify(backup).length,
      encrypted: backup.encrypted,
      itemCount:
        backup.metadata.totalExpenses + backup.metadata.totalCategories,
      hasProfileImage: !!backup.profileImage,
    };

    history.unshift(metadata);

    if (history.length > this.MAX_BACKUP_HISTORY) {
      history.splice(this.MAX_BACKUP_HISTORY);
    }

    this.storageService.set(this.BACKUP_STORAGE_KEY, history);
  }

  private async encryptBackup(
    backup: BackupData,
    password?: string
  ): Promise<BackupData> {
    const encryptedData = await this.encryptionService.encrypt(
      backup.data,
      password
    );

    return {
      ...backup,
      encrypted: true,
      data: encryptedData as any,
    };
  }

  private async decryptBackup(
    backup: BackupData,
    password?: string
  ): Promise<BackupData> {
    if (!backup.encrypted) return backup;

    const payload = backup.data as any;
    let decryptedData: any;
    try {
      decryptedData = await this.encryptionService.decrypt(
        payload,
        password,
        true
      );
    } catch {
      const error = new Error('Backup decryption failed');
      (error as any).code = 'BACKUP_CRYPTO_FAILURE';
      throw error;
    }
    if (!decryptedData) {
      const error = new Error('Backup decryption failed');
      (error as any).code = 'BACKUP_CRYPTO_FAILURE';
      throw error;
    }

    return {
      ...backup,
      encrypted: false,
      data: decryptedData,
    };
  }

  private async getProfileImage(): Promise<string | undefined> {
    try {
      const userImage = this.storageService.get<string>('user_profile_image');
      return userImage || undefined;
    } catch (error) {
      console.warn('No profile image found:', error);
      return undefined;
    }
  }

  private async restoreProfileImage(imageData: string): Promise<void> {
    try {
      this.storageService.set('user_profile_image', imageData);
    } catch (error) {
      console.error('Error restoring profile image:', error);
    }
  }

  private getSettings(): any {
    return {};
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Initialize auto backup functionality
   */
  private initAutoBackup(): void {
    const autoBackupSettings = this.getAutoBackupSettings();
    if (autoBackupSettings.enabled) {
      this.scheduleAutoBackup();
    }
  }

  /**
   * Get auto backup settings
   */
  getAutoBackupSettings(): {
    enabled: boolean;
    frequency: number;
    lastBackup?: Date;
  } {
    const settings = this.storageService.get<{
      enabled: boolean;
      frequency: number;
      lastBackup?: Date;
    }>(this.AUTO_BACKUP_KEY);
    return settings || { enabled: false, frequency: this.AUTO_BACKUP_INTERVAL };
  }

  /**
   * Enable or disable auto backup
   */
  setAutoBackupEnabled(enabled: boolean, frequency?: number): void {
    const settings = this.getAutoBackupSettings();
    settings.enabled = enabled;
    if (frequency) {
      settings.frequency = frequency;
    }
    this.storageService.set(this.AUTO_BACKUP_KEY, settings);

    if (enabled) {
      this.scheduleAutoBackup();
    } else {
      this.cancelAutoBackup();
    }
  }

  /**
   * Schedule automatic backup
   */
  private scheduleAutoBackup(): void {
    this.cancelAutoBackup(); // Clear any existing timer

    const settings = this.getAutoBackupSettings();
    const now = new Date().getTime();
    const lastBackup = settings.lastBackup
      ? new Date(settings.lastBackup).getTime()
      : 0;
    const timeSinceLastBackup = now - lastBackup;
    const timeUntilNextBackup = Math.max(
      0,
      settings.frequency - timeSinceLastBackup
    );

    this.autoBackupTimer = setTimeout(() => {
      this.performAutoBackup();
      // Schedule next backup
      this.autoBackupTimer = setInterval(() => {
        this.performAutoBackup();
      }, settings.frequency);
    }, timeUntilNextBackup);
  }

  /**
   * Cancel scheduled auto backup
   */
  private cancelAutoBackup(): void {
    if (this.autoBackupTimer) {
      clearTimeout(this.autoBackupTimer);
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
  }

  /**
   * Perform automatic backup
   */
  private performAutoBackup(): void {
    this.createFullBackup(false).subscribe({
      next: (backup) => {
        // Save backup to local storage
        const backupJson = JSON.stringify(backup, null, 2);
        const blob = new Blob([backupJson], { type: 'application/json' });

        // Store in IndexedDB or localStorage
        this.storageService.set('last_auto_backup', {
          timestamp: new Date(),
          size: blob.size,
          data: backupJson,
        });

        // Update last backup time
        const settings = this.getAutoBackupSettings();
        settings.lastBackup = new Date();
        this.storageService.set(this.AUTO_BACKUP_KEY, settings);

        // Upload to Google Drive if enabled
        const driveSettings = this.getGoogleDriveSettings();
        if (driveSettings.enabled && this.googleDriveService.isSignedIn()) {
          const fileName = `auto-backup-${new Date().toISOString()}.json`;
          this.googleDriveService.uploadBackup(fileName, backupJson).subscribe({
            next: (file) => {
              debugLog(
                '✅ Auto backup uploaded to Google Drive:',
                file.name
              );
            },
            error: (error) => {
              console.error(
                '❌ Failed to upload backup to Google Drive:',
                error
              );
            },
          });
        }

        debugLog('✅ Auto backup completed successfully');
      },
      error: (error) => {
        console.error('❌ Auto backup failed:', error);
      },
    });
  }

  /**
   * Get last auto backup
   */
  getLastAutoBackup(): { timestamp: Date; size: number; data: string } | null {
    return this.storageService.get('last_auto_backup') || null;
  }

  /**
   * Get Google Drive backup settings
   */
  getGoogleDriveSettings(): { enabled: boolean; email?: string } {
    const settings = this.storageService.get<{
      enabled: boolean;
      email?: string;
    }>(this.GOOGLE_DRIVE_SETTINGS_KEY);
    return settings || { enabled: false };
  }

  /**
   * Enable or disable Google Drive backup
   */
  setGoogleDriveEnabled(enabled: boolean): void {
    const email = this.googleDriveService.getUserEmail();
    this.storageService.set(this.GOOGLE_DRIVE_SETTINGS_KEY, {
      enabled,
      email: email || undefined,
    });
  }

  /**
   * Initialize Google Drive
   */
  async initializeGoogleDrive(clientId: string): Promise<void> {
    await this.googleDriveService.initializeGoogleDrive(clientId);
  }

  /**
   * Sign in to Google Drive
   */
  async signInToGoogleDrive(): Promise<boolean> {
    const success = await this.googleDriveService.signIn();
    if (success) {
      this.setGoogleDriveEnabled(true);
    }
    return success;
  }

  /**
   * Sign out from Google Drive
   */
  async signOutFromGoogleDrive(): Promise<void> {
    await this.googleDriveService.signOut();
    this.setGoogleDriveEnabled(false);
  }

  /**
   * Check if signed in to Google Drive
   */
  isSignedInToGoogleDrive(): boolean {
    return this.googleDriveService.isSignedIn();
  }

  /**
   * List backups from Google Drive
   */
  listGoogleDriveBackups(): Observable<any[]> {
    return this.googleDriveService.listBackups();
  }

  /**
   * Download backup from Google Drive
   */
  downloadGoogleDriveBackup(fileId: string): Observable<string> {
    return this.googleDriveService.downloadBackup(fileId);
  }

  /**
   * Delete backup from Google Drive
   */
  deleteGoogleDriveBackup(fileId: string): Observable<boolean> {
    return this.googleDriveService.deleteBackup(fileId);
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}
