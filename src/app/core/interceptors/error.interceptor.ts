import { isApiUrl } from '../../modules/auth/helper/authInterceptor';
import { inject } from '@angular/core';
import {
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpInterceptorFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ConnectionService } from '../services/connection.service';
import { ToastService } from '../../shared/services/toast.service';

function handleAccountLocked(error: HttpErrorResponse): string {
  const lockoutMinutes = error.error?.lockoutMinutes || 15;
  const attemptsRemaining = error.error?.attemptsRemaining;
  if (attemptsRemaining !== undefined) {
    return `Too many failed login attempts. ${attemptsRemaining} attempts remaining before account lockout.`;
  }
  return `Account temporarily locked due to multiple failed login attempts. Please try again in ${lockoutMinutes} minutes.`;
}

function handleRateLimit(error: HttpErrorResponse): string {
  const retryAfter = error.headers?.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    const minutes = Math.ceil(seconds / 60);
    return `Too many requests. Please try again in ${minutes} minute${
      minutes > 1 ? 's' : ''
    }.`;
  }
  return `Too many requests. Please slow down and try again later.`;
}

function extractValidationErrors(error: HttpErrorResponse): string {
  const errors = error.error?.errors || error.error?.details;
  if (Array.isArray(errors)) {
    return errors.map((e: any) => e.message || e).join(', ');
  }
  if (typeof errors === 'object' && errors !== null) {
    return Object.values(errors).flat().join(', ');
  }
  return error.error?.message || 'Validation failed. Please check your input.';
}

async function handleError(
  error: HttpErrorResponse,
  request: HttpRequest<unknown>,
  toastService: ToastService
): Promise<void> {
  // Online receipt reading is an optional extra: when it fails the app reads
  // the receipt on the device instead, so the person must not see an error.
  if (request.url.includes('/receipts/extract')) return;

  let errorMessage = 'An unexpected error occurred';
  let shouldShowToast = true;

  switch (error.status) {
    case 0:
      errorMessage = 'No internet connection. Please check your network.';
      break;
    case 400:
      errorMessage =
        error.error?.message || 'Invalid request. Please check your input.';
      break;
    case 401:
      errorMessage = 'Session expired. Please login again.';
      // Get current URL from router, not from request
      // Authentication teardown is owned by the renewal interceptor.
      break;
    case 403:
      errorMessage =
        error.error?.message ||
        "You don't have permission to access this resource.";
      // Forbidden is an authorization result, not a reason to destroy the session.
      break;
    case 404:
      errorMessage =
        error.error?.message || 'The requested resource was not found.';
      break;
    case 422:
      errorMessage = extractValidationErrors(error);
      break;
    case 423:
      errorMessage = handleAccountLocked(error);
      break;
    case 429:
      errorMessage = handleRateLimit(error);
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      errorMessage = 'Server error. Please try again later.';
      break;
    default:
      errorMessage = error.error?.message || error.message || errorMessage;
  }

  // Hide toasts for background processes and polling
  if (
    request.url.includes('/health') ||
    request.url.includes('/sync') ||
    request.headers.has('X-Skip-Retry') ||
    request.headers.has('X-Silent-Error')
  ) {
    shouldShowToast = false;
  }

  console.error('HTTP Error:', {
    status: error.status,
    message: errorMessage,
    url: new URL(request.url, window.location.origin).pathname,
  });

  if (shouldShowToast) {
    await toastService.presentErrorToast('top', errorMessage);
  }
}

export const errorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  if (!isApiUrl(req.url)) return next(req);
  const toastService = inject(ToastService);
  const connection = inject(ConnectionService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Existing offline/local-data UI owns disconnected navigation, including
      // network layers that report 5xx while the device is disconnected.
      if (!connection.isOnline() || !navigator.onLine) {
        return throwError(() => error);
      }
      handleError(error, req, toastService);
      return throwError(() => error);
    })
  );
};
