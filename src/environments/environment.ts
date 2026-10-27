// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  // Browser REST calls stay same-origin and are routed by proxy.conf.js.
  browserApiUrl: '/api/v1',
  // Native Capacitor calls continue to use the absolute Backend URL.
  nativeApiUrl: 'https://expenses-wallet.up.railway.app/v1',
  // Non-REST connections (for example Socket.IO) use the absolute origin.
  backendOrigin: 'https://expenses-wallet.up.railway.app',
  /** @deprecated Use browserApiUrl, nativeApiUrl, or backendOrigin explicitly. */
  apiUrl: '/api/v1',

  // Encryption settings
  // NOTE: Full payload encryption for login/signup requests
  // Backend supports both full payload and field-level encryption
  enableEncryption: true, // Encryption is now working correctly!

  // Google OAuth
  google: {
    // TODO: replace with your real Web Client ID from Google Cloud Console (OAuth 2.0 Client IDs - type Web)
    webClientId:
      '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',
  },

  // Google Drive for Backup
  // يمكنك استخدام نفس webClientId أو إنشاء Client ID منفصل
  // إذا استخدمت نفسه، تأكد من إضافة scope: 'https://www.googleapis.com/auth/drive.file'
  // Follow instructions in GOOGLE_DRIVE_SETUP.md
  googleDriveClientId:
    '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',

  // Feature flags
  features: {
    expenses: {
      active: true,
      roles: [],
    },
    categories: {
      active: true,
      roles: [],
    },
    encryption: {
      active: true, // Enable/disable encryption feature
    },
    offlineMode: {
      active: true, // Enable/disable offline support
    },
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
