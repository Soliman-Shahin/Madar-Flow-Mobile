import {
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpInterceptorFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retryWhen, mergeMap } from 'rxjs/operators';
import { debugLog } from 'src/app/shared/utils/debug-log.util';

const MAX_RETRIES = 1;
const INITIAL_DELAY = 1000;
const MAX_DELAY = 3000;
const RETRYABLE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const NON_RETRYABLE_STATUS = [400, 401, 403, 404, 422, 423, 429];

function isRetryable(request: HttpRequest<unknown>): boolean {
  return RETRYABLE_METHODS.includes(request.method.toUpperCase());
}

function shouldRetry(error: any, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) {
    debugLog('❌ Max retries exceeded');
    return false;
  }
  if (!(error instanceof HttpErrorResponse)) {
    return false;
  }
  if (error.status !== 0 && NON_RETRYABLE_STATUS.includes(error.status)) {
    debugLog(`❌ Not retrying status ${error.status}`);
    return false;
  }
  const retry = error.status >= 500 && error.status < 600;
  if (!retry && error.status === 0) {
    debugLog('❌ Backend not available - not retrying network error');
    return false;
  }
  if (retry) {
    debugLog(`✅ Will retry server error: ${error.status} ${error.statusText}`);
  }
  return retry;
}

function calculateDelay(attempt: number): number {
  const exponentialDelay = INITIAL_DELAY * Math.pow(2, attempt);
  const delay = Math.min(exponentialDelay, MAX_DELAY);
  const jitter = Math.random() * 0.1 * delay;
  return Math.floor(delay + jitter);
}

export const retryInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  if (!isRetryable(req)) {
    return next(req);
  }

  return next(req).pipe(
    retryWhen((errors) =>
      errors.pipe(
        mergeMap((error, attempt) => {
          if (!shouldRetry(error, attempt)) {
            return throwError(() => error);
          }
          const delay = calculateDelay(attempt);
          console.warn(
            `🔄 Retrying request (attempt ${attempt + 1}/${MAX_RETRIES}) after ${delay}ms:`,
            req.url
          );
          return timer(delay);
        })
      )
    )
  );
};
