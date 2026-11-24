/**
 * Text scrubbing for crash reports leaving the device (Sentry). Error messages are free text and can
 * quote e-mails, tokens or submitted values; route URLs can carry reset tokens. Redaction only.
 * Mirrors Madar-Flow-BE/src/app/shared/sentry-scrub.ts.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}\b/g;
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g;
const URL_QUERY = /[?#][^\s"'#)]*/g;

export function scrubText(input: string): string {
  return input
    .replace(BEARER, 'Bearer [token]')
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(URL_QUERY, '')
    .replace(LONG_TOKEN, '[token]');
}

interface ScrubbableEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown };
  exception?: { values?: Array<{ value?: string }> };
  request?: {
    url?: string;
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    query_string?: unknown;
  };
  breadcrumbs?: unknown;
  extra?: unknown;
  user?: unknown;
}

/** Mutates and returns the event with free text scrubbed and bulky/identifying context removed. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  if (event.logentry) {
    if (typeof event.logentry.message === 'string') {
      event.logentry.message = scrubText(event.logentry.message);
    }
    delete event.logentry.params;
  }
  for (const v of event.exception?.values ?? []) {
    if (typeof v.value === 'string') v.value = scrubText(v.value);
  }
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (typeof event.request.url === 'string') {
      event.request.url = event.request.url.replace(/[?#].*$/, '');
    }
  }
  delete event.breadcrumbs;
  delete event.extra;
  delete event.user;
  return event;
}
