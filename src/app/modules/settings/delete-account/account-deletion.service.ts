import { Injectable, inject } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiService } from 'src/app/core/services/api.service';
import { ConnectionService } from 'src/app/core/services/connection.service';
import { OfflineStorageService } from 'src/app/core/services/offline-storage.service';
import { BiometricService } from 'src/app/core/services/biometric.service';
import { BiometricSignInService } from 'src/app/modules/auth/services/biometric-signin.service';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';

export type AccountDeletionFailure =
  | 'offline'
  | 'wrong-password'
  | 'staff'
  | 'failed';

export class AccountDeletionFailed extends Error {
  constructor(readonly reason: AccountDeletionFailure) {
    super(reason);
  }
}

@Injectable({ providedIn: 'root' })
export class AccountDeletionService {
  private api = inject(ApiService);
  private connection = inject(ConnectionService);
  private offlineStorage = inject(OfflineStorageService);
  private biometric = inject(BiometricService);
  private biometricSignIn = inject(BiometricSignInService);
  private auth = inject(AuthService);

  /**
   * Permanently deletes the signed-in account on the server, then removes
   * every trace of it from this device and returns to the login screen.
   */
  async deleteAccount(password?: string): Promise<void> {
    if (!this.connection.isOnline())
      throw new AccountDeletionFailed('offline');

    try {
      await firstValueFrom(
        this.api.post(
          '/user/me/delete',
          {
            ...(password ? { password } : {}),
            confirmation: ACCOUNT_DELETION_CONFIRMATION,
          },
          { headers: new HttpHeaders({ 'X-Silent-Error': 'true' }) }
        )
      );
    } catch (error: any) {
      const status = error?.status;
      if (status === 0) throw new AccountDeletionFailed('offline');
      if (status === 422) throw new AccountDeletionFailed('wrong-password');
      if (status === 403) throw new AccountDeletionFailed('staff');
      throw new AccountDeletionFailed('failed');
    }

    // The server account is gone; local cleanup is best effort and must
    // never block the user from leaving the deleted session.
    await this.clearLocalData();
    await firstValueFrom(this.auth.logout());
  }

  private async clearLocalData(): Promise<void> {
    const tasks: Promise<unknown>[] = [
      firstValueFrom(this.offlineStorage.clearOfflineData()),
      this.biometricSignIn.clearLocalEnrollment(),
      this.biometric.setEnabled(false),
    ];
    await Promise.allSettled(tasks);
  }
}
