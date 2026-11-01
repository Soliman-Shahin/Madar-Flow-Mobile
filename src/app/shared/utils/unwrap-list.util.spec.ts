import { unwrapList } from './unwrap-list.util';

describe('unwrapList', () => {
  it('returns bare arrays unchanged', () => {
    expect(unwrapList<number>([1, 2])).toEqual([1, 2]);
  });

  it('unwraps one and two levels of the API envelope', () => {
    expect(unwrapList<number>({ data: [1] })).toEqual([1]);
    expect(unwrapList<number>({ data: { data: [2, 3] } })).toEqual([2, 3]);
  });

  it('returns an empty list for anything else', () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList(undefined)).toEqual([]);
    expect(unwrapList({ data: 'nope' })).toEqual([]);
    expect(unwrapList({ data: { data: {} } })).toEqual([]);
    expect(unwrapList(42)).toEqual([]);
  });
});
