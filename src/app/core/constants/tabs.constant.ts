import { Tab } from 'src/app/shared/models';
import { APP_ROUTES } from './routes.constant';

/**
 * Bottom tab bar destinations, in visual order. The tab bar inserts the
 * "add transaction" action between the second and third tab.
 * `icon` is the filled (selected) name; the bar uses `<icon>-outline`
 * for unselected tabs.
 */
export const TABS_MENU_ITEMS: Tab[] = [
  {
    id: APP_ROUTES.HOME,
    order: 0,
    label: 'SIDEBAR.HOME',
    show_label: true,
    routerLink: APP_ROUTES.BASE + APP_ROUTES.HOME,
    routerLinkActiveOptions: { exact: true },
    icon: 'home',
    visible: true,
    disabled: false,
    roles: [],
    excludeRoles: [],
  },
  {
    id: APP_ROUTES.TRANSACTIONS.INDEX,
    order: 1,
    label: 'SIDEBAR.TRANSACTIONS',
    show_label: true,
    routerLink: APP_ROUTES.BASE + APP_ROUTES.TRANSACTIONS.INDEX,
    routerLinkActiveOptions: { exact: true },
    icon: 'list',
    visible: true,
    disabled: false,
    roles: [],
  },
  {
    id: APP_ROUTES.CATEGORIES.INDEX,
    order: 2,
    label: 'SIDEBAR.CATEGORIES',
    show_label: true,
    routerLink: APP_ROUTES.BASE + APP_ROUTES.CATEGORIES.INDEX,
    routerLinkActiveOptions: { exact: true },
    icon: 'grid',
    visible: true,
    disabled: false,
    roles: [],
    excludeRoles: [],
  },
  {
    id: APP_ROUTES.SETTINGS.INDEX,
    order: 3,
    label: 'SIDEBAR.SETTINGS',
    show_label: true,
    routerLink: APP_ROUTES.BASE + APP_ROUTES.SETTINGS.INDEX,
    routerLinkActiveOptions: { exact: true },
    icon: 'settings',
    visible: true,
    disabled: false,
    roles: [],
  },
];
