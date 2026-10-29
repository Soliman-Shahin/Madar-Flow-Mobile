import {
  httpsUrl,
  isOlderVersion,
  parseLegalText,
  pickLocalized,
  sanitizeAppSettings,
} from './app-settings.service';

describe('app settings helpers', () => {
  describe('sanitizeAppSettings', () => {
    it('rejects non-objects', () => {
      expect(sanitizeAppSettings(null)).toBeNull();
      expect(sanitizeAppSettings('x')).toBeNull();
      expect(sanitizeAppSettings([])).toBeNull();
    });

    it('keeps an unconfigured document as just its revision', () => {
      expect(sanitizeAppSettings({ revision: 0, updatedAt: null })).toEqual({ revision: 0 });
    });

    it('accepts valid support data and drops unsafe values', () => {
      const result = sanitizeAppSettings({
        revision: 4,
        support: {
          email: 'help@example.test',
          whatsapp: '201001234567',
          website: 'https://example.test/help',
          links: [
            { label: { en: 'Docs' }, url: 'https://example.test/docs' },
            { label: { en: 'Bad' }, url: 'javascript:alert(1)' },
            { label: { en: 'Plain http' }, url: 'http://example.test' },
          ],
        },
      })!;
      expect(result.support?.email).toBe('help@example.test');
      expect(result.support?.links?.length).toBe(1);
      expect(result.support?.links?.[0].url).toBe('https://example.test/docs');
    });

    it('drops a whole support section when nothing in it is valid', () => {
      const result = sanitizeAppSettings({
        revision: 1,
        support: { email: 'nope', whatsapp: 'call me', website: 'ftp://x.test' },
      })!;
      expect(result.support).toBeUndefined();
    });

    it('requires a version and a body for legal documents', () => {
      const result = sanitizeAppSettings({
        revision: 2,
        legal: {
          terms: { version: '3', body: { en: 'Terms text' } },
          privacy: { version: '1', body: {} },
        },
      })!;
      expect(result.legal?.terms?.version).toBe('3');
      expect(result.legal?.privacy).toBeUndefined();
    });

    it('keeps FAQ items that have a question and ignores the rest', () => {
      const result = sanitizeAppSettings({
        revision: 1,
        faq: [
          { question: { en: 'Q1' }, answer: { en: 'A1' } },
          { question: {}, answer: { en: 'orphan' } },
          'junk',
        ],
      })!;
      expect(result.faq?.length).toBe(1);
    });

    it('reads maintenance and version policy defensively', () => {
      const result = sanitizeAppSettings({
        revision: 1,
        maintenance: { enabled: true, message: { en: 'Back soon' } },
        versioning: { minVersion: '1.2.0', latestVersion: 'abc', storeUrl: 'https://store.test/app' },
      })!;
      expect(result.maintenance?.enabled).toBeTrue();
      expect(result.versioning?.minVersion).toBe('1.2.0');
      expect(result.versioning?.latestVersion).toBeUndefined();
      expect(sanitizeAppSettings({ revision: 1, maintenance: { enabled: 'yes' } })!.maintenance).toBeUndefined();
    });
  });

  describe('httpsUrl', () => {
    it('allows only plain https links', () => {
      expect(httpsUrl('https://example.test/a')).toBe('https://example.test/a');
      for (const bad of ['http://example.test', 'javascript:alert(1)', 'data:text/html,x', 'https://u:p@example.test', 'not a url'])
        expect(httpsUrl(bad)).toBeUndefined();
    });
  });

  describe('pickLocalized', () => {
    it('prefers the requested language and falls back to the other', () => {
      expect(pickLocalized({ ar: 'عربي', en: 'English' }, 'ar')).toBe('عربي');
      expect(pickLocalized({ en: 'English' }, 'ar')).toBe('English');
      expect(pickLocalized({ ar: 'عربي' }, 'en')).toBe('عربي');
      expect(pickLocalized(undefined, 'en')).toBeUndefined();
    });
  });

  describe('parseLegalText', () => {
    it('splits paragraphs and treats "# " lines as headings', () => {
      const sections = parseLegalText('Intro paragraph\n\n# Data we keep\nWe store your records.\n\nMore text\n\n# Contact\n\nWrite to us.');
      expect(sections).toEqual([
        { paragraphs: ['Intro paragraph'] },
        { title: 'Data we keep', paragraphs: ['We store your records.', 'More text'] },
        { title: 'Contact', paragraphs: ['Write to us.'] },
      ]);
    });

    it('returns nothing for blank text', () => {
      expect(parseLegalText('  \n\n ')).toEqual([]);
    });
  });

  describe('isOlderVersion', () => {
    it('compares MAJOR.MINOR.PATCH numerically', () => {
      expect(isOlderVersion('1.9.0', '1.10.0')).toBeTrue();
      expect(isOlderVersion('2.0.0', '1.99.99')).toBeFalse();
      expect(isOlderVersion('1.2.3', '1.2.3')).toBeFalse();
    });
  });
});
