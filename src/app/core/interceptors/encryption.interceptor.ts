import { inject } from '@angular/core';
import {
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpInterceptorFn,
  HttpResponse,
} from '@angular/common/http';
import { Observable, from, of } from 'rxjs';
import { switchMap, mergeMap } from 'rxjs/operators';
import { EncryptionAdvancedService } from '../services/encryption-advanced.service';
import { environment } from 'src/environments/environment';
import { Capacitor } from '@capacitor/core';

const SENSITIVE_FIELDS = ['id', '_id'];

function shouldEncrypt(
  request: HttpRequest<unknown>,
  encryptionService: EncryptionAdvancedService
): boolean {
  // Sync uses HTTPS plus JWT/owner-scoped authorization as its transport
  // boundary. Its durable queue contains plaintext domain entities; do not
  // pass their identities through the browser-embedded temporary key.
  if (request.url.includes('/sync/')) {
    return false;
  }
  if (!encryptionService.isEncryptionEnabled()) {
    return false;
  }
  if (request.url.includes('assets/') || request.url.includes('/i18n/')) {
    return false;
  }
  const apiUrl = Capacitor.isNativePlatform()
    ? environment.nativeApiUrl
    : environment.browserApiUrl;
  if (!request.url.startsWith(apiUrl)) {
    return false;
  }
  if (request.url.includes('/health')) {
    return false;
  }
  return true;
}

async function encryptRequest(
  request: HttpRequest<unknown>,
  encryptionService: EncryptionAdvancedService
): Promise<HttpRequest<unknown>> {
  try {
    const encryptedBody = await encryptionService.encryptFieldsDeep(
      request.body,
      SENSITIVE_FIELDS
    );
    return request.clone({ body: encryptedBody });
  } catch (error) {
    console.error('❌ Failed to encrypt request:', error);
    return request;
  }
}

async function decryptResponse(
  response: HttpResponse<any>,
  encryptionService: EncryptionAdvancedService
): Promise<HttpResponse<any>> {
  try {
    const decryptedBody = await encryptionService.decryptFieldsDeep(
      response.body,
      SENSITIVE_FIELDS
    );
    return response.clone({ body: decryptedBody });
  } catch (error) {
    console.error('❌ Failed to decrypt response:', error);
    return response;
  }
}

export const encryptionAdvancedInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  const encryptionService = inject(EncryptionAdvancedService);

  if (!shouldEncrypt(req, encryptionService)) {
    return next(req);
  }

  if (req.body && !(req.body instanceof FormData)) {
    return from(encryptRequest(req, encryptionService)).pipe(
      switchMap((encryptedRequest) =>
        next(encryptedRequest).pipe(
          mergeMap((event) => {
            if (event instanceof HttpResponse && event.body) {
              return from(decryptResponse(event, encryptionService));
            }
            return of(event);
          })
        )
      )
    );
  }

  return next(req).pipe(
    mergeMap((event) => {
      if (event instanceof HttpResponse && event.body) {
        return from(decryptResponse(event, encryptionService));
      }
      return of(event);
    })
  );
};
