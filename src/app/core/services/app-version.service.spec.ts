import pkg from '../../../../package.json';
import { WEB_APP_VERSION } from './app-version.service';

describe('app version', () => {
  it('the web build version matches package.json, so it is never out of step', () => {
    expect(WEB_APP_VERSION).toBe(pkg.version);
  });
});
