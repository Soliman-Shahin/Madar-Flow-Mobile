export const APP_ROUTES = {
  INDEX: '',
  BASE: '/',
  HOME: 'home',
  AUTH: {
    INDEX: 'auth',
    LOGIN: 'login',
    SIGNUP: 'signup',
  },
  CATEGORIES: {
    INDEX: 'categories',
    LIST: 'list',
    CREATE: 'create',
    EDIT: 'edit/:id',
  },
  EXPENSES: {
    INDEX: 'expenses',
    LIST: 'list',
    CREATE: 'create',
  },
  TRANSACTIONS: {
    INDEX: 'transactions',
    LIST: 'list',
  },
  SETTINGS: {
    INDEX: 'settings',
    LIST: 'list',
    SYNC: 'sync',
    CONFLICTS: 'conflicts',
    BACKUP: 'backup',
    NOTIFICATION_PREFERENCES: 'notification-preferences',
    DELETE_ACCOUNT: 'delete-account',
  },
  PROFILE: {
    INDEX: 'profile',
  },
  NOTIFICATIONS: {
    INDEX: 'notifications',
    DETAIL: ':id',
  },

  __get: (key: string) => `${key}`.replace(':', ''),
} as const;

export const MenuItemIds = {
  home: 'home',
  categories: 'categories',
  expenses: 'expenses',
  settings: 'settings',
  profile: 'profile',
} as const;
