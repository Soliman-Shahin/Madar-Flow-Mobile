import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { TokenService } from 'src/app/modules/auth/services';
import { ConnectionService } from './connection.service';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly baseUrl = Capacitor.isNativePlatform()
    ? environment.nativeApiUrl
    : environment.browserApiUrl;
  private connectionService = inject(ConnectionService);

  constructor(private http: HttpClient, private storageService: TokenService) {}

  private getHeadersObject(): { [key: string]: string } {
    let token = '';
    const tokenObj = this.storageService.getAccessToken();

    if (typeof tokenObj === 'string') {
      token = tokenObj;
    } else if (tokenObj) {
      token = String(tokenObj);
    }

    token = token.replace(/^"|"$/g, '');

    const headers: { [key: string]: string } = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      console.warn('No valid access token found in storage');
    }

    // Do not send user id as a custom header; JWT already carries the subject

    return headers;
  }

  private getHeaders(): HttpHeaders {
    return new HttpHeaders(this.getHeadersObject());
  }

  get<T>(path: string, params?: any): Observable<T> {
    // Convert params object to HttpParams if needed
    let httpParams: HttpParams | undefined;
    if (params instanceof HttpParams) {
      httpParams = params;
    } else if (params) {
      httpParams = new HttpParams();
      Object.keys(params).forEach((key) => {
        if (params[key] !== undefined && params[key] !== null) {
          httpParams = httpParams!.append(key, String(params[key]));
        }
      });
    }

    const timeoutDuration = this.connectionService.isBackendReachable()
      ? 15000
      : 2000;

    return this.http
      .get<any>(`${this.baseUrl}${path}`, {
        headers: this.getHeaders(),
        params: httpParams,
      })
      .pipe(
        timeout(timeoutDuration),
        map((response) => {
          // Handle both {data: T} and direct response formats
          if (response && response.data !== undefined) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError.bind(this))
      );
  }

  post<T>(
    path: string,
    body: any,
    options: { headers?: HttpHeaders; params?: HttpParams } = {}
  ): Observable<T> {
    const defaultHeaders = this.getHeadersObject();

    let extraHeaders: { [key: string]: string } = {};
    if (options.headers) {
      options.headers.keys().forEach((key) => {
        const val = options.headers!.get(key);
        if (val) extraHeaders[key] = val;
      });
    }

    const mergedHeaders = new HttpHeaders({
      ...defaultHeaders,
      ...extraHeaders,
    });

    const timeoutDuration = this.connectionService.isBackendReachable()
      ? 15000
      : 2000;

    return this.http
      .post<any>(`${this.baseUrl}${path}`, body, {
        headers: mergedHeaders,
        params: options.params,
      })
      .pipe(
        timeout(timeoutDuration),
        map((response) => {
          // Handle both {data: T} and direct response formats
          if (response && response.data !== undefined) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError.bind(this))
      );
  }

  /**
   * Post multipart/form-data without forcing Content-Type so the browser can set the boundary.
   */
  postFormData<T>(
    path: string,
    formData: FormData,
    options: { headers?: HttpHeaders; params?: HttpParams } = {}
  ): Observable<T> {
    const defaultHeaders = this.getHeadersObject();
    // Remove Content-Type to allow the browser to set it for multipart
    delete (defaultHeaders as any)['Content-Type'];

    let extraHeaders: { [key: string]: string } = {};
    if (options.headers) {
      options.headers.keys().forEach((key) => {
        const val = options.headers!.get(key);
        if (val) extraHeaders[key] = val;
      });
    }

    const mergedHeaders = new HttpHeaders({
      ...defaultHeaders,
      ...extraHeaders,
    });

    const timeoutDuration = this.connectionService.isBackendReachable()
      ? 15000
      : 2000;

    return this.http
      .post<T>(`${this.baseUrl}${path}`, formData, {
        headers: mergedHeaders,
        params: options.params,
      })
      .pipe(timeout(timeoutDuration), catchError(this.handleError.bind(this)));
  }

  put<T>(
    path: string,
    body: any,
    options: { params?: HttpParams } = {}
  ): Observable<T> {
    const timeoutDuration = this.connectionService.isBackendReachable()
      ? 15000
      : 2000;

    return this.http
      .put<any>(`${this.baseUrl}${path}`, body, {
        headers: this.getHeaders(),
        params: options.params,
      })
      .pipe(
        timeout(timeoutDuration),
        map((response) => {
          // Handle both {data: T} and direct response formats
          if (response && response.data !== undefined) {
            return response.data;
          }
          return response;
        }),
        catchError(this.handleError.bind(this))
      );
  }

  delete<T>(
    path: string,
    options: { params?: HttpParams; body?: unknown } = {}
  ): Observable<T> {
    const timeoutDuration = this.connectionService.isBackendReachable()
      ? 15000
      : 2000;

    return this.http
      .delete<T>(`${this.baseUrl}${path}`, {
        headers: this.getHeaders(),
        params: options.params,
        body: options.body,
      })
      .pipe(timeout(timeoutDuration), catchError(this.handleError.bind(this)));
  }

  patch<T>(
    path: string,
    body: any,
    options: { params?: HttpParams } = {}
  ): Observable<T> {
    const timeoutDuration = this.connectionService.isBackendReachable()
      ? 15000
      : 2000;

    return this.http
      .patch<{ data: T }>(`${this.baseUrl}${path}`, body, {
        headers: this.getHeaders(),
        params: options.params,
      })
      .pipe(
        timeout(timeoutDuration),
        map((response) => response.data),
        catchError(this.handleError.bind(this))
      );
  }

  // Centralized error handler
  private handleError(error: any) {
    let message = 'Unknown error occurred';
    if (error.error && error.error.message) {
      message = error.error.message;
    } else if (error.message) {
      message = error.message;
    }
    // Preserve the transport status used by offline-aware services while
    // keeping the normalized error free of response bodies or credentials.
    const normalizedError = new Error(message);
    const status =
      typeof error?.status === 'number'
        ? error.status
        : error?.name === 'TimeoutError'
        ? 0
        : undefined;
    if (typeof status === 'number') {
      (normalizedError as Error & { status?: number }).status = status;
    }
    return throwError(() => normalizedError);
  }
}
