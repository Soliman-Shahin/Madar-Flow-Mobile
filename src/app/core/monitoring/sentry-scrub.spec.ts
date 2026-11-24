import { scrubEvent, scrubText } from './sentry-scrub';

describe('sentry scrubbing', () => {
  it('redacts e-mails, bearer tokens, JWTs and long tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz';
    const out = scrubText(
      `user a.b+c@mail.co; Authorization: Bearer abc.def-ghi; jwt ${jwt}; key ${'k'.repeat(40)}`
    );
    expect(out).not.toMatch(/@mail\.co/);
    expect(out).not.toContain('abc.def-ghi');
    expect(out).not.toContain('eyJhbGci');
    expect(out).not.toContain('kkkkkkkkkkkkkkkkkkkk');
  });

  it('strips query strings and fragments (reset tokens travel in them)', () => {
    expect(scrubText('route /auth/reset-password?token=abc123 failed')).not.toContain(
      'abc123'
    );
  });

  it('keeps ordinary diagnostics readable', () => {
    expect(scrubText('Cannot read properties of undefined (reading "name")')).toBe(
      'Cannot read properties of undefined (reading "name")'
    );
  });

  it('scrubs a whole event', () => {
    const event = scrubEvent({
      message: 'boom for jane@example.com',
      exception: { values: [{ value: 'failed for x@y.zz' }] },
      request: {
        url: 'https://localhost/auth/reset-password?token=SECRET',
        headers: { authorization: 'Bearer t' },
        cookies: { sid: 's' },
        query_string: 'token=SECRET',
      },
      breadcrumbs: [{ message: 'login jane@example.com' }],
      extra: { amount: 100 },
      user: { email: 'jane@example.com' },
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain('jane@example.com');
    expect(json).not.toContain('x@y.zz');
    expect(json).not.toContain('SECRET');
    expect(event.request?.url).toBe('https://localhost/auth/reset-password');
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.user).toBeUndefined();
  });
});
