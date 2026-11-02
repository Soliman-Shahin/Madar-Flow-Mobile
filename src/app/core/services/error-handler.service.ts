import { Injectable, ErrorHandler, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../shared/services/toast.service';

@Injectable({
  providedIn: 'root',
})
export class ErrorHandlerService implements ErrorHandler {
  private translate = inject(TranslateService);
  private toastService = inject(ToastService);

  /**
   * Global error handler for the application
   * @param error The error that occurred
   */
  async handleError(error: Error | HttpErrorResponse): Promise<void> {
    console.error('Global error handler:', error);

    if (error instanceof HttpErrorResponse) {
      // Handle HTTP errors
      await this.handleHttpError(error);
    } else {
      // Handle client-side errors
      await this.showError('errors.unexpected_error');
    }
  }

  /**
   * Show a warning message to the user
   * @param message Translation key for the warning message
   * @param header Optional translation key for the header
   */
  async showWarning(message: string, header?: string): Promise<void> {
    const text = header
      ? `${this.translate.instant(header)}: ${this.translate.instant(message)}`
      : this.translate.instant(message);
    await this.toastService.presentWarningToast('top', text);
  }

  /**
   * Show an error message to the user
   * @param message Translation key for the error message
   * @param error Optional error object for logging
   */
  async showError(message: string, error?: any): Promise<void> {
    console.error('Error:', error || message);

    await this.toastService.presentErrorToast('top', message);
  }

  /**
   * Handle HTTP errors
   * @param error HTTP error response
   */
  private async handleHttpError(error: HttpErrorResponse): Promise<void> {
    if (!navigator.onLine) {
      // Handle offline error
      await this.showError('errors.offline');
      return;
    }

    let message: string | null = null;

    // Prefer backend API error payload when available
    const backendPayload = error.error as any;
    if (backendPayload) {
      const backendError = backendPayload.error || backendPayload;
      const code =
        typeof backendError?.code === 'string' ? backendError.code : null;

      // 1) If we have an error code, try to map it to a translation key
      const codeKey = code ? `ERROR_CODES.${code}` : null;
      if (codeKey && this.translate.instant(codeKey) !== codeKey) {
        message = codeKey;
      } else if (
        typeof backendError?.message === 'string' &&
        backendError.message.trim()
      ) {
        // 2) Otherwise, if backend sent a message, use it directly
        message = backendError.message.trim();
      }
    }

    // 3) Fallback to status-based translation keys when no backend info is present
    if (!message) {
      if (error.error instanceof ErrorEvent) {
        // Client-side error
        message = 'errors.client_error';
      } else {
        // Server-side error
        switch (error.status) {
          case 400:
            message = 'errors.bad_request';
            break;
          case 401:
            message = 'errors.unauthorized';
            // Handle unauthorized (e.g., redirect to login)
            break;
          case 403:
            message = 'errors.forbidden';
            break;
          case 404:
            message = 'errors.not_found';
            break;
          case 429:
            message = 'errors.too_many_requests';
            break;
          case 500:
            message = 'errors.server_error';
            break;
          default:
            message = 'errors.unknown_error';
        }
      }
    }

    await this.showError(message ?? 'errors.server_error', error);
  }
}
