import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NotificationTextPipe } from './notification-text.pipe';

describe('NotificationTextPipe', () => {
  let pipe: NotificationTextPipe;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()] });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      NOTIFICATION_TEXT: {
        SESSION_LIMIT_TITLE: 'Signed out on another device',
        SESSION_LIMIT_MESSAGE: '{{devices}} signed out; plan allows {{max}}.',
      },
    });
    translate.use('en');
    pipe = TestBed.runInInjectionContext(() => new NotificationTextPipe());
  });

  it('translates the session-limit notice and fills it from metadata', () => {
    const item = {
      title: 'server title',
      message: 'server message',
      event: 'security.session_limit',
      metadata: { endedDevices: ['Laptop', 'Phone'], maxDevices: 1 },
    };
    expect(pipe.transform(item, 'title')).toBe('Signed out on another device');
    expect(pipe.transform(item, 'message')).toBe(
      'Laptop، Phone signed out; plan allows 1.'
    );
  });

  it('keeps the server text for events it does not know', () => {
    const item = { title: 'Hello', message: 'Broadcast', event: 'general.admin_broadcast' };
    expect(pipe.transform(item, 'title')).toBe('Hello');
    expect(pipe.transform(item, 'message')).toBe('Broadcast');
  });

  it('keeps the server text when a translation is missing', () => {
    const item = { title: 'Server login', message: 'Server msg', event: 'security.new_login' };
    expect(pipe.transform(item, 'title')).toBe('Server login');
  });
});
