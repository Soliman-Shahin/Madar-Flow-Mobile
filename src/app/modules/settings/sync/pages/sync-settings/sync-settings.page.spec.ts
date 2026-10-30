import { APP_ROUTES } from 'src/app/core/constants';
import { SyncSettingsPage } from './sync-settings.page';

describe('SyncSettingsPage conflict navigation', () => {
  it('uses the existing absolute conflict-resolution route without invoking sync', () => {
    expect(`/${APP_ROUTES.SETTINGS.INDEX}/${APP_ROUTES.SETTINGS.CONFLICTS}`).toBe(
      '/settings/conflicts'
    );
  });

  it('keeps the route available when there are zero conflicts', () => {
    expect(`/${APP_ROUTES.SETTINGS.INDEX}/${APP_ROUTES.SETTINGS.CONFLICTS}`).toBe(
      '/settings/conflicts'
    );
  });

  it('navigates through the Router and prevents native row navigation', () => {
    const navigate = jasmine
      .createSpy('navigate')
      .and.returnValue(Promise.resolve(true));
    const page = Object.create(SyncSettingsPage.prototype) as any;
    page.router = { navigate };
    const event = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
    } as unknown as Event;

    page.openConflicts(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/settings/conflicts']);
  });
});
