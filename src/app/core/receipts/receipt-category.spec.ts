import { merchantKey, suggestCategory } from './receipt-category';

const cats = [
  { _id: 'home', title: 'Home', type: 'outcome' as const },
  { _id: 'foods', title: 'Foods', type: 'outcome' as const },
  { _id: 'coffee', title: 'Coffee', type: 'outcome' as const },
  { _id: 'electric', title: 'Electric', type: 'outcome' as const },
  { _id: 'car', title: 'Car', type: 'outcome' as const },
  { _id: 'mobile', title: 'Mobile', type: 'outcome' as const },
  { _id: 'salary', title: 'Salary', type: 'income' as const },
];

const receipt = (merchant: string, items: string[] = [], rawText = '') => ({
  merchant,
  items: items.map((name) => ({ name, amount: 10 })),
  rawText,
});

describe('receipt category suggestion', () => {
  it('prefers what this person chose for the same shop before', () => {
    const r = suggestCategory(receipt('سنتر المجد'), cats, { [merchantKey('سنتر المجد')]: 'home' });
    expect(r).toEqual({ id: 'home', reason: 'history' });
  });

  it('ignores a remembered category that no longer exists', () => {
    const r = suggestCategory(receipt('سوبر ماركت النور'), cats, { [merchantKey('سوبر ماركت النور')]: 'gone' });
    expect(r?.id).toBe('foods');
  });

  it('matches the kind of shop to the person\'s own category names', () => {
    expect(suggestCategory(receipt('سوبر ماركت النور'), cats)?.id).toBe('foods');
    expect(suggestCategory(receipt('Starbucks Mall'), cats)?.id).toBe('coffee');
    expect(suggestCategory(receipt('محطة بنزين توتال'), cats)?.id).toBe('car');
    expect(suggestCategory(receipt('فودافون'), cats)?.id).toBe('mobile');
  });

  it('suggests nothing when no category of theirs fits (no wrong guess)', () => {
    // shoes and clothes, but no clothing category
    const r = suggestCategory(receipt('سنتر المجد', ['شبشب رجالى', 'كوتشى رجالى']), cats);
    expect(r).toBeUndefined();
  });

  it('never suggests an income category for a receipt', () => {
    const r = suggestCategory(receipt('Salary Shop'), [{ _id: 'salary', title: 'Salary', type: 'income' }]);
    expect(r).toBeUndefined();
  });

  it('counts the shop and item names more than stray words in the text', () => {
    const r = suggestCategory(receipt('Cafe Roma', [], 'electric bill promo coffee'), cats);
    expect(r?.id).toBe('coffee');
  });
});
