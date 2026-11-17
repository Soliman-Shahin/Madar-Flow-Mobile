import { Injectable, computed, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { AppSettingsService, isOlderVersion } from './app-settings.service';

/**
 * The version of the app people see, in one place. On a phone it is the build
 * that is actually installed (what the store shows); in a browser there is no
 * store, so it is the version of this web build. The dashboard's "latest
 * version" is only used to say an update exists, never as the installed one.
 */
export const WEB_APP_VERSION = '2.0.0'; // keep equal to package.json (checked by a test)

@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly settings = inject(AppSettingsService);
  private readonly installed = signal(WEB_APP_VERSION);

  /** Installed version, e.g. "2.0.0". */
  readonly version = this.installed.asReadonly();

  /** The newer version announced in the dashboard, or null when this one is current. */
  readonly updateTo = computed(() => {
    const latest = this.settings.versioning()?.latestVersion;
    return latest && isOlderVersion(this.installed(), latest) ? latest : null;
  });

  constructor() {
    if (Capacitor.isNativePlatform()) {
      void App.getInfo()
        .then((info) => {
          if (info.version) this.installed.set(info.version);
        })
        .catch(() => undefined);
    }
  }
}
