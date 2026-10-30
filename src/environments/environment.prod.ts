export const environment = {
  production: true,
  // Production: replace the api.madar-flow.invalid placeholder before release.
  // `npm run build:prod` refuses to build while it is a placeholder or staging.
  browserApiUrl: 'https://api.madar-flow.invalid/v1',
  nativeApiUrl: 'https://api.madar-flow.invalid/v1',
  backendOrigin: 'https://api.madar-flow.invalid',
  /** @deprecated Use browserApiUrl, nativeApiUrl, or backendOrigin explicitly. */
  apiUrl: 'https://api.madar-flow.invalid/v1',

  // Google OAuth
  google: {
    webClientId:
      '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',
  },

  // Google Drive for Backup
  // يمكنك استخدام نفس webClientId أو إنشاء Client ID منفصل
  googleDriveClientId:
    '353235771010-hrhbu0k5v93qbjqpuirdh4pcatb1sdvg.apps.googleusercontent.com',

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
