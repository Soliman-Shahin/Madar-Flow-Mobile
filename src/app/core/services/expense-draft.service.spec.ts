import { ExpenseDraftService } from './expense-draft.service';

describe('ExpenseDraftService', () => {
  const service = new ExpenseDraftService();
  const draft = {
    type: 'outcome' as const,
    amount: 25.5,
    category: 'cat-1',
    description: 'Lunch',
    date: '2026-05-01T10:00:00.000Z',
  };
  const key = (id: string) => `madarflow.transaction-draft.v1.${id}`;

  beforeEach(() => localStorage.clear());
  afterAll(() => localStorage.clear());

  it('round-trips a draft per owner', () => {
    service.save('a', draft);
    expect(service.get('a')).toEqual(jasmine.objectContaining(draft));
    expect(service.get('b')).toBeNull();
    service.clear('a');
    expect(service.get('a')).toBeNull();
  });

  it('ignores calls without an owner', () => {
    service.save(null, draft);
    expect(service.get(null)).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(() => service.clear(null)).not.toThrow();
  });

  it('rejects malformed or tampered stored drafts', () => {
    const bad = [
      '{not json',
      JSON.stringify({ ...draft, type: 'transfer' }),
      JSON.stringify({ ...draft, date: 'nope' }),
      JSON.stringify({ ...draft, description: 5 }),
      JSON.stringify({ ...draft, amount: -3 }),
      JSON.stringify({ ...draft, amount: 'abc' }),
    ];
    for (const raw of bad) {
      localStorage.setItem(key('x'), raw);
      expect(service.get('x')).withContext(raw).toBeNull();
    }
  });

  it('normalises optional fields', () => {
    localStorage.setItem(
      key('y'),
      JSON.stringify({ type: 'income', amount: null, category: 5, description: '', date: draft.date })
    );
    expect(service.get('y')).toEqual({
      type: 'income',
      amount: null,
      category: null,
      description: '',
      date: draft.date,
      savedAt: 0,
    });
  });
});
