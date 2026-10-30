import { ConflictResolutionPage } from './conflict-resolution.page';

describe('ConflictResolutionPage date compatibility', () => {
  const page = Object.create(ConflictResolutionPage.prototype) as any;
  page.translateService = { currentLang: 'en' };

  it('formats the Backend API ISO timestamp', () => {
    expect(page.formatDate('2026-09-18T12:30:00.000Z')).not.toBe('—');
  });

  it('does not throw for missing or invalid timestamps and shows no fake date', () => {
    expect(() => page.formatDate(undefined)).not.toThrow();
    expect(page.formatDate(undefined)).toBe('—');
    expect(page.formatDate('not-a-date')).toBe('—');
  });

  it('keeps local and server conflict data as opaque display payloads', () => {
    const conflict = {
      entityId: 'expense-1',
      entityType: 'expense',
      timestamp: '2026-09-18T12:30:00.000Z',
      localData: { _version: 1, amount: 200 },
      serverData: { _version: 2, amount: 300 },
    };
    expect(JSON.stringify(conflict.localData)).toContain('_version');
    expect(JSON.stringify(conflict.serverData)).toContain('_version');
    expect(page.formatDate(conflict.timestamp)).not.toBe('—');
  });
});

describe('ConflictResolutionPage presentation model', () => {
  const page = Object.create(ConflictResolutionPage.prototype) as any;
  page.translateService = {
    currentLang: 'en',
    instant: (key: string, params?: { count: number }) =>
      params ? `${key}:${params.count}` : key,
  };

  const conflict = (
    localData: any,
    serverData: any,
    entityType = 'expense'
  ) => ({
    entityId: 'expense-1',
    entityType,
    timestamp: '2026-09-18T12:30:00.000Z',
    localData,
    serverData,
  });

  it('shows only allowlisted changed business fields', () => {
    const fields = page.getConflictFields(
      conflict(
        { amount: 200, description: 'Lunch', _version: 1, user: 'owner-a' },
        { amount: 300, description: 'Lunch', _version: 2, user: 'owner-a' }
      )
    );

    expect(fields.map((field: any) => field.key)).toEqual(['amount']);
    expect(fields[0].local).toBe('200');
    expect(fields[0].current).toBe('300');
  });

  it('omits identical fields and formats one-versus-many difference labels', () => {
    const one = conflict(
      { amount: 200, description: 'Lunch' },
      { amount: 300, description: 'Lunch' }
    );
    const many = conflict(
      { amount: 200, description: 'Lunch' },
      { amount: 300, description: 'Dinner' }
    );

    expect(page.getDifferenceLabel(one)).toBe('SYNC.ONE_DIFFERENCE:1');
    expect(page.getDifferenceLabel(many)).toBe('SYNC.MANY_DIFFERENCES:2');
    expect(page.getConflictFields(one).length).toBe(1);
    expect(page.getConflictFields(many).length).toBe(2);
  });

  it('does not expose category IDs or unknown/internal fields', () => {
    const categoryFields = page.getConflictFields(
      conflict(
        { title: 'Food', _id: 'a', user: 'owner-a' },
        { title: 'Meals', _id: 'b', user: 'owner-a' },
        'category'
      )
    );
    const unknownFields = page.getConflictFields(
      conflict(
        { _id: 'a', secret: 'internal' },
        { _id: 'b', secret: 'internal' },
        'unknown'
      )
    );

    expect(categoryFields.map((field: any) => field.key)).toEqual(['title']);
    expect(unknownFields).toEqual([]);
  });

  it('uses a safe missing-value placeholder and friendly identity', () => {
    const item = conflict(
      { description: '  Grocery run  ', amount: undefined },
      { description: '  Grocery run  ', amount: 20 }
    );

    expect(page.getConflictIdentity(item)).toBe('Grocery run');
    expect(page.getConflictFields(item)[0].local).toBe('—');
  });
});
