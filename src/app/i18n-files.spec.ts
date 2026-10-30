import en from '../assets/i18n/en.json';
import ar from '../assets/i18n/ar.json';

/**
 * Translation files are loaded at runtime, so a malformed file silently breaks
 * every screen. Importing them here also makes the spec compilation fail on
 * invalid JSON (for example a bad merge when two branches append a block).
 */
const flatten = (value: unknown, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k)
  );
};

describe('i18n files', () => {
  const enKeys = new Set(flatten(en));
  const arKeys = new Set(flatten(ar));

  it('parse and contain the main sections', () => {
    for (const section of ['SETTINGS', 'EXPORT', 'TELEMETRY', 'GUARDS']) {
      expect((en as Record<string, unknown>)[section]).toBeTruthy();
      expect((ar as Record<string, unknown>)[section]).toBeTruthy();
    }
  });

  it('English and Arabic define the same keys', () => {
    const missingInAr = [...enKeys].filter((k) => !arKeys.has(k));
    expect(missingInAr).toEqual([]);
  });

  it('every Arabic key also exists in English, except known legacy ones', () => {
    const legacy = new Set(['HOME.TOTAL_SALARY']);
    const missingInEn = [...arKeys].filter((k) => !enKeys.has(k) && !legacy.has(k));
    expect(missingInEn).toEqual([]);
  });
});
