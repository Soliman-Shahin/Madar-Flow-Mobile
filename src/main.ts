import { AuthService } from './app/modules/auth/services/auth.service';
import {
  enableProdMode,
  ErrorHandler,
  importProvidersFrom,
  provideZoneChangeDetection,
  isDevMode,
  APP_INITIALIZER,
} from '@angular/core';
import { initWebVitalsTracking } from './app/web-vitals';
import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';

import { environment } from './environments/environment';
import {
  provideHttpClient,
  withInterceptors,
  HttpClient,
} from '@angular/common/http';
import { GlobalErrorHandler } from './app/core/services/global-error-handler.service';

// Functional interceptors
import { retryInterceptor } from './app/core/interceptors/retry.interceptor';
import { encryptionAdvancedInterceptor } from './app/core/interceptors/encryption.interceptor';
import { authInterceptor } from './app/modules/auth/helper/authInterceptor';
import { cacheInterceptor } from './app/core/interceptors/cache.interceptor';
import { errorInterceptor } from './app/core/interceptors/error.interceptor';
import { planLimitInterceptor } from './app/core/interceptors/plan-limit.interceptor';
import { permissionErrorInterceptor } from './app/core/interceptors/permission-error.interceptor';

// Services
import { PermissionService } from './app/core/services/permission.service';
import { TokenService } from './app/modules/auth/services/token.service';

import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  provideRouter,
  withPreloading,
  PreloadAllModules,
  withInMemoryScrolling,
  withRouterConfig,
  withComponentInputBinding,
} from '@angular/router';
import { routes } from './app/app.routes';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { AppComponent } from './app/app.component';
import { provideServiceWorker } from '@angular/service-worker';
import { ThemeService } from './app/shared/services/themeToggle.service';
import { Capacitor } from '@capacitor/core';

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

/**
 * The native app already ships its assets inside the APK/IPA, so the Angular
 * service worker only adds a stale-cache layer: after an update the WebView
 * keeps serving the previous bundle until a second launch. The web/PWA build
 * keeps its service worker; on native we make sure none is registered (this
 * also retires workers registered by earlier versions).
 */
async function retireNativeServiceWorker(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('ngsw:')).map((k) => caches.delete(k))
      );
    }
  } catch {
    // Best effort: a leftover worker only costs the old update delay.
  }
}

const isNativeApp = Capacitor.isNativePlatform();
if (isNativeApp) {
  void retireNativeServiceWorker();
}

if (environment.production) {
  enableProdMode();
}

initWebVitalsTracking();
registerLocaleData(localeAr);

if (!(window as any).__appBootstrapped) {
  (window as any).__appBootstrapped = true;

  bootstrapApplication(AppComponent, {
    providers: [
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideRouter(
        routes,
        withPreloading(PreloadAllModules),
        withInMemoryScrolling({
          scrollPositionRestoration: 'enabled',
          anchorScrolling: 'enabled',
        }),
        withRouterConfig({ onSameUrlNavigation: 'reload' }),
        withComponentInputBinding()
      ),
      importProvidersFrom(
        IonicModule.forRoot(),
        TranslateModule.forRoot({
          loader: {
            provide: TranslateLoader,
            useFactory: HttpLoaderFactory,
            deps: [HttpClient],
          },
        })
      ),
      provideHttpClient(
        withInterceptors([
          retryInterceptor,
          encryptionAdvancedInterceptor,
          errorInterceptor,
          authInterceptor,
          planLimitInterceptor,
          permissionErrorInterceptor,
          cacheInterceptor,
        ])
      ),
      {
        provide: ErrorHandler,
        useClass: GlobalErrorHandler,
      },
      {
        provide: APP_INITIALIZER,
        useFactory: (
          permissionService: PermissionService,
          tokenService: TokenService,
          authService: AuthService
        ) => {
          return async () => {
            await authService.initializeSession();
            // Only load permissions if user is authenticated
            const hasToken = tokenService.getAccessToken();
            if (!hasToken) {
              console.log(
                '⚠️ [APP_INITIALIZER] No token found, skipping permission load'
              );
              return Promise.resolve([]);
            }

            // Load permissions on app initialization
            // This ensures permissions are available before any route is activated
            return permissionService.loadUserPermissions().catch((error) => {
              console.warn('Failed to load permissions on init:', error);
              // Don't block app initialization if permissions fail to load
              return [];
            });
          };
        },
        deps: [PermissionService, TokenService, AuthService],
        multi: true,
      },
      {
        provide: APP_INITIALIZER,
        useFactory: (themeService: ThemeService) => () =>
          themeService.initTheme(),
        deps: [ThemeService],
        multi: true,
      },
      provideAnimations(),
      provideServiceWorker('ngsw-worker.js', {
        enabled: !isDevMode() && !isNativeApp,
        registrationStrategy: 'registerWhenStable:30000',
      }),
    ],
  }).catch((err: any) => console.error('Bootstrap error:', err));
}
