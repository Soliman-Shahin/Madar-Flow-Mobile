import { normalizeDigits, parseAmount, parseReceipt } from './receipt-parser';

const NOW = new Date('2026-11-03T12:00:00Z');

describe('receipt parser', () => {
  describe('parseAmount', () => {
    it('reads the common separator styles', () => {
      expect(parseAmount('1,234.50')).toBe(1234.5);
      expect(parseAmount('1.234,50')).toBe(1234.5);
      expect(parseAmount('12,50')).toBe(12.5);
      expect(parseAmount('12.50')).toBe(12.5);
      expect(parseAmount('1,234')).toBe(1234);
      expect(parseAmount('1 234')).toBe(1234);
      expect(parseAmount('45000')).toBe(45000);
    });
    it('rejects text without digits', () => {
      expect(parseAmount('abc')).toBeNull();
    });
  });

  it('turns Arabic-Indic digits and decimal marks into Latin', () => {
    expect(normalizeDigits('٣٤٫٥٠')).toBe('34.50');
    expect(normalizeDigits('۱۲٬۳۴۵')).toBe('12,345');
  });

  it('reads an English supermarket receipt', () => {
    const r = parseReceipt(
      [
        'FRESH MARKET',
        'Tel: 0123456789',
        'Date: 03/11/2026 14:22',
        'Milk 1L            32.00',
        'Bread              10.00',
        'Cheese            58.50',
        'Subtotal         100.50',
        'VAT 14%           14.07',
        'TOTAL            114.57',
        'Cash             120.00',
        'Change             5.43',
      ].join('\n'),
      { now: NOW }
    );
    expect(r.total).toBe(114.57);
    expect(r.date).toBe('2026-11-03');
    expect(r.merchant).toBe('FRESH MARKET');
    expect(r.confidence.total).toBe('medium');
    expect(r.items.map((i) => i.name)).toEqual(['Milk 1L', 'Bread', 'Cheese']);
  });

  it('never takes tax, change or cash as the total', () => {
    const r = parseReceipt(
      ['Cafe Roma', 'Latte 55.00', 'Tax 7.70', 'Total 62.70', 'Cash 100.00', 'Change 37.30'].join('\n'),
      { now: NOW }
    );
    expect(r.total).toBe(62.7);
  });

  it('reads an Arabic receipt with Arabic-Indic digits', () => {
    const r = parseReceipt(
      [
        'سوبر ماركت النور',
        'التاريخ: ٠٣/١١/٢٠٢٦',
        'لبن ٣٢٫٠٠',
        'خبز ١٠٫٠٠',
        'الإجمالي ٤٢٫٠٠ جنيه',
        'المدفوع ٥٠٫٠٠',
        'الباقي ٨٫٠٠',
      ].join('\n'),
      { now: NOW }
    );
    expect(r.total).toBe(42);
    expect(r.date).toBe('2026-11-03');
    expect(r.merchant).toBe('سوبر ماركت النور');
    expect(r.currency).toBe('EGP');
  });

  it('never trusts Arabic-Indic digits read from a photo', () => {
    const text = ['سوبر ماركت', 'الإجمالي ٤٢٫٠٠'].join('\n');
    expect(parseReceipt(text, { now: NOW, source: 'offline' }).confidence.total).toBe('low');
    expect(parseReceipt(text, { now: NOW, source: 'online' }).confidence.total).not.toBe('low');
  });

  it('reads a crumpled Egyptian receipt as the device reader sees it', () => {
    // Real Tesseract output for a photographed receipt: noise tokens, a total
    // box that wraps ("المطلوب بعد" / "الخصم"), a phone number, and a
    // "remaining" figure that must not be taken for the total.
    const ocr = [
      '1',
      'ظ سنتر المجد 7',
      "س .ت :108211 ب.ض : 758-306-504 '",
      'Order. #:21214 Date. 2026/11/02',
      'ah Time. 21:09:26 الكاشير Cashler,',
      'إسم الصنف الكمية السعر القيمة',
      '| بلال شبشب رجالى ايفا 1 460.00 414.00',
      'الدولى كوتشى رجالى )1 1275.00 1147.50',
      'الدولى كوإتشى رجالى 1 1750.00 1575.00',
      'قبل الخصم 3485.00[ المطلوب بعد 3136.50 2',
      'عدد ese Ls ol 4 3 whol 31',
      '| عمولة Ino = 0.00 المتبقى 3.50',
      'الاستبدال خلال 30 بوم ol الفاتورة',
      'وتكون في حالتها الاصلية',
      'شبين الكوم - ش Goll حرب بجوار سيف للسياحة',
      'ا uy : 2322263/048',
    ].join('\n');
    const r = parseReceipt(ocr, { now: NOW });
    expect(r.total).toBe(3136.5);
    expect(r.merchant).toBe('سنتر المجد');
    expect(r.date).toBe('2026-11-02');
    expect(r.currency).toBeUndefined();
    expect(r.items.map((i) => i.amount)).toEqual([414, 1147.5, 1575]);
  });

  it('replaces an absurd total with the items sum, marked unsure', () => {
    const r = parseReceipt(
      ['Shop', 'Shirt 460.00 414.00', 'Shoes 1275.00 1147.50', 'Total 2322263'].join('\n'),
      { now: NOW }
    );
    expect(r.total).toBe(1561.5);
    expect(r.confidence.total).toBe('low');
  });

  it('never takes a phone number for the total when nothing else is found', () => {
    const r = parseReceipt(['Some Shop', 'Tel: 2322263/048', '010 1234 5678'].join('\n'), { now: NOW });
    expect(r.total).toBeUndefined();
  });

  it('finds an amount printed on the line under the word', () => {
    const r = parseReceipt(['Pharmacy 24', 'الإجمالي', '١٢٥٫٥٠'].join('\n'), { now: NOW });
    expect(r.total).toBe(125.5);
  });

  it('prefers an explicit grand total over a smaller total line', () => {
    const r = parseReceipt(
      ['Shop', 'Total items 3', 'Total 80.00', 'Grand Total 92.00'].join('\n'),
      { now: NOW }
    );
    expect(r.total).toBe(92);
    expect(r.confidence.total).toBe('high');
  });

  it('falls back to the largest plain amount, marked low confidence', () => {
    const r = parseReceipt(['Some Shop', 'Item A 10.00', 'Item B 25.00', 'Thank you', '35.00'].join('\n'), { now: NOW });
    expect(r.total).toBe(35);
    expect(r.confidence.total).toBe('low');
  });

  it('reads dates: day-first, ISO, and month names; rejects implausible ones', () => {
    expect(parseReceipt('x\n03/11/2026', { now: NOW }).date).toBe('2026-11-03');
    expect(parseReceipt('x\n2026-11-02', { now: NOW }).date).toBe('2026-11-02');
    expect(parseReceipt('x\n5 Oct 2026', { now: NOW }).date).toBe('2026-10-05');
    // month-first is only used when the "day" cannot be a month
    expect(parseReceipt('x\n10/25/2026', { now: NOW }).date).toBe('2026-10-25');
    // a date in the future is not a receipt date
    expect(parseReceipt('x\n11/25/2026', { now: NOW }).date).toBeUndefined();
    expect(parseReceipt('x\n01/01/2010', { now: NOW }).date).toBeUndefined();
  });

  it('returns empty fields instead of guessing on unreadable text', () => {
    const r = parseReceipt('~~ ..', { now: NOW });
    expect(r.total).toBeUndefined();
    expect(r.date).toBeUndefined();
    expect(r.confidence.total).toBe('low');
  });
});
