import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { throwError, of } from 'rxjs';
import { TokenService } from '../services/token.service';
import { AuthService } from '../services/auth.service';
import { environment } from 'src/environments/environment';
import { Capacitor } from '@capacitor/core';

export function isApiUrl(url: string): boolean {
  try {
    const target = new URL(url, window.location.origin);
    const api = new URL(
      Capacitor.isNativePlatform()
        ? environment.nativeApiUrl
        : environment.browserApiUrl,
      window.location.origin
    );
    return (
      target.origin === api.origin &&
      (target.pathname === api.pathname ||
        target.pathname.startsWith(api.pathname.replace(/\/$/, '') + '/'))
    );
  } catch {
    return false;
  }
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    !isApiUrl(request.url) ||
    /\/user\/(login|signup|refresh-token|logout|google|auth\/google)(\/|$|\?)/.test(
      request.url
    )
  )
    return next(request);
  const tokens = inject(TokenService);
  const auth = inject(AuthService);
  const sentToken = tokens.getAccessToken();
  const revision = tokens.revision;
  if (!sentToken) return next(request);
  const authenticated = (token: string) =>
    request.clone({
      setHeaders: { Authorization: 'Bearer ' + token },
      headers: request.headers.delete('refresh-token'),
    });
  return next(authenticated(sentToken)).pipe(
    catchError((error: HttpErrorResponse) => {
      if (tokens.revision !== revision || error.status !== 401)
        return throwError(() => error);
      const code = error.error?.error?.code;
      if (code && code !== 'AUTH_INVALID_TOKEN') {
        auth.expireSession();
        return throwError(() => error);
      }
      if (!tokens.getRefreshToken()) {
        auth.expireSession();
        return throwError(() => error);
      }
      // A late 401 for an old JWT must reuse the already-rotated credential.
      const current = tokens.getAccessToken();
      const renewal =
        current && current !== sentToken
          ? of({ accessToken: current })
          : auth.refreshAccessToken();
      return renewal.pipe(
        switchMap(({ accessToken }) =>
          next(authenticated(accessToken)).pipe(
            catchError((retryError) => {
              if (tokens.revision === revision && retryError.status === 401)
                auth.expireSession();
              return throwError(() => retryError);
            })
          )
        )
      );
    }),
    takeUntil(tokens.sessionEnded$)
  );
};
