import { HttpErrorResponse } from '@angular/common/http';
import * as Sentry from '@sentry/angular';
import { environment } from '../../../environments/environment';
import { scrubEvent } from './sentry-scrub';

let enabled = false;

/**
 * Crash reporting. Enabled only when `environment.sentryDsn` is set (production builds), so local
 * runs and staging send nothing. Errors only: no tracing, no session replay, no breadcrumbs.
 *
 * Privacy: this is a finance app. Request data, cookies, headers, user identity, breadcrumbs and
 * extra data are never sent, and error text is scrubbed of e-mails, tokens and URL queries.
 */
export function initSentry(): void {
  const dsn = (environment as { sentryDsn?: string }).sentryDsn?.trim();
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: 'production',
    // SDK v11 collects headers, cookies, bodies and query params by default: switch it all off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: (event, hint) =>
      // API failures (offline, 401, validation...) are reported server-side or are expected.
      hint?.originalException instanceof HttpErrorResponse
        ? null
        : scrubEvent(event),
  });
  enabled = true;
}

/** Reports an unexpected client error. No-op when monitoring is disabled. */
export function captureClientError(error: unknown): void {
  if (!enabled) return;
  Sentry.captureException(error);
}
