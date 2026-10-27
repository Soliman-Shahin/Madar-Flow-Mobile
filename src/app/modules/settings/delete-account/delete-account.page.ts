import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { inject } from '@angular/core';
import { BaseComponent } from 'src/app/shared/base/base.component';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountDeletionFailed,
  AccountDeletionService,
} from './account-deletion.service';

const FAILURE_MESSAGES: Record<string, string> = {
  offline: 'SETTINGS.DELETE_ACCOUNT_OFFLINE',
  'wrong-password': 'SETTINGS.DELETE_ACCOUNT_WRONG_PASSWORD',
  failed: 'SETTINGS.DELETE_ACCOUNT_FAILED',
};

@Component({
  selector: 'app-delete-account',
  templateUrl: './delete-account.page.html',
  styleUrls: ['./delete-account.page.scss'],
  standalone: true,
  imports: [IonicModule, RouterModule, TranslateModule, FormsModule],
})
export class DeleteAccountPage extends BaseComponent implements OnInit {
  readonly confirmationWord = ACCOUNT_DELETION_CONFIRMATION;
  password = '';
  confirmation = '';
  deleting = false;
  requiresPassword = true;

  private accountDeletion = inject(AccountDeletionService);

  constructor() {
    super();
  }

  override ngOnInit(): void {
    super.ngOnInit();
    const signupType = this.authService.currentUser?.signupType;
    this.requiresPassword = !signupType || signupType === 'normal';
  }

  get canSubmit(): boolean {
    return (
      !this.deleting &&
      this.confirmation.trim() === this.confirmationWord &&
      (!this.requiresPassword || this.password.length > 0)
    );
  }

  async deleteAccount(): Promise<void> {
    if (!this.canSubmit) return;

    const confirmed = await this.alertService.showConfirm({
      title: this.translateService.instant(
        'SETTINGS.DELETE_ACCOUNT_FINAL_TITLE'
      ),
      message: this.translateService.instant(
        'SETTINGS.DELETE_ACCOUNT_FINAL_MESSAGE'
      ),
      confirmText: this.translateService.instant('SETTINGS.DELETE_ACCOUNT'),
      cancelText: this.translateService.instant('COMMON.CANCEL'),
    });
    if (!confirmed) return;

    this.deleting = true;
    this.cdr.markForCheck();
    try {
      await this.accountDeletion.deleteAccount(
        this.requiresPassword ? this.password : undefined
      );
      this.toastService.presentSuccessToast(
        'bottom',
        this.translateService.instant('SETTINGS.DELETE_ACCOUNT_SUCCESS')
      );
    } catch (error) {
      const reason =
        error instanceof AccountDeletionFailed ? error.reason : 'failed';
      // 403 is already announced by the permission interceptor.
      if (reason !== 'staff')
        this.toastService.presentErrorToast(
          'bottom',
          this.translateService.instant(FAILURE_MESSAGES[reason])
        );
      this.password = '';
    } finally {
      this.deleting = false;
      this.cdr.markForCheck();
    }
  }
}
