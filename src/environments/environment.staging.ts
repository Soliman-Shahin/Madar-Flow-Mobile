export const environment = {
  production: true,
  // Staging: current Railway service. Default for `npm run build`.
  browserApiUrl: 'https://expenses-wallet.up.railway.app/v1',
  nativeApiUrl: 'https://expenses-wallet.up.railway.app/v1',
  backendOrigin: 'https://expenses-wallet.up.railway.app',
  /** @deprecated Use browserApiUrl, nativeApiUrl, or backendOrigin explicitly. */
  apiUrl: 'https://expenses-wallet.up.railway.app/v1',

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
