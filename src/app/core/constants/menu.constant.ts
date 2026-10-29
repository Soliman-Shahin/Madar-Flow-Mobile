import { MenuItem } from 'src/app/shared/models';
import { APP_ROUTES } from './routes.constant';

export const MENU_ITEMS: MenuItem[] = [
  {
    title: 'SIDEBAR.HOME',
    icon: 'home-outline',
    link: APP_ROUTES.BASE + APP_ROUTES.HOME,
    requiresAuth: false,
  },
  {
    title: 'SIDEBAR.CATEGORIES',
    icon: 'pricetags-outline',
    link: APP_ROUTES.BASE + APP_ROUTES.CATEGORIES.INDEX,
    requiresAuth: true,
  },
  {
    title: 'SIDEBAR.TRANSACTIONS',
    icon: 'swap-horizontal-outline',
    link: APP_ROUTES.BASE + APP_ROUTES.TRANSACTIONS.INDEX,
    requiresAuth: true,
  },
  {
    title: 'SETTINGS.NOTIFICATIONS',
    icon: 'notifications-outline',
    link: APP_ROUTES.BASE + APP_ROUTES.NOTIFICATIONS.INDEX,
    requiresAuth: true,
  },
  {
    title: 'SIDEBAR.SETTINGS',
    icon: 'settings-outline',
    link: APP_ROUTES.BASE + APP_ROUTES.SETTINGS.INDEX,
    requiresAuth: true,
  },
];
