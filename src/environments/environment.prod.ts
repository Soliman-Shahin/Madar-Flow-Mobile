export const environment = {
  production: true,
  // Production API (Railway "Madar Flow" project, custom domain on orbit-madar.com).
  // `npm run build:prod` refuses to build while this is a placeholder or staging.
  browserApiUrl: 'https://flow-api.orbit-madar.com/v1',
  nativeApiUrl: 'https://flow-api.orbit-madar.com/v1',
  backendOrigin: 'https://flow-api.orbit-madar.com',
  /** @deprecated Use browserApiUrl, nativeApiUrl, or backendOrigin explicitly. */
  apiUrl: 'https://flow-api.orbit-madar.com/v1',

  // Google OAuth
  google: {
    webClientId:
      '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',
  },

  // Google Drive for Backup
  // يمكنك استخدام نفس webClientId أو إنشاء Client ID منفصل
  googleDriveClientId:
    '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',

  // Crash reporting (Sentry, EU region). The DSN is a write-only ingest key and is safe to ship.
  sentryDsn:
    'https://fc12ce942886aa1f8119ba0bfe2c4b16@o4512486631211008.ingest.de.sentry.io/4512486642417744',

  // Encryption is handled by backend
  enableEncryption: true,

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
      active: true,
    },
    offlineMode: {
      active: true,
    },
  },
};
