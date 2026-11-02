import {
  ReceiptConfidence,
  ReceiptExtraction,
  ReceiptItem,
} from './receipt.types';

/**
 * Turns the text of a receipt (from any reader) into fields. Pure and
 * deterministic, so it is tested with real-looking receipt text.
 *
 * Built for mixed Arabic / English receipts: Arabic-Indic digits, Arabic
 * decimal marks, totals that sit on the line below their word, and the many
 * "total"-like lines (sub-total, tax, change) that must not win.
 */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/[‎‏‪-‮؜]/g, '');
}

/** Parses "1,234.50", "1.234,50", "12,50", "1 234" into a number, or null. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal one
    const dec = Math.max(lastDot, lastComma);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const idx = Math.max(lastDot, lastComma);
    const sep = s[idx];
    const tail = s.slice(idx + 1);
    const head = s.slice(0, idx);
    const manyOfSame = s.split(sep).length > 2;
    if (
      manyOfSame ||
      (tail.length === 3 && head.length >= 1 && /^\d{1,3}$/.test(head))
    ) {
      s = s.replace(/[.,]/g, ''); // thousands separator
    } else {
      s = head.replace(/[.,]/g, '') + '.' + tail;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_RE =
  /(?<![\d.,])(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,3})?)(?!\d)/g;

const TOTAL_STRONG =
  /(grand\s*total|total\s*due|amount\s*due|net\s*(?:total|amount)|total\s*amount|balance\s*due|الإجمالي\s*النهائي|الاجمالي\s*النهائي|اجمالي\s*الفاتورة|إجمالي\s*الفاتورة|صافي\s*الفاتورة|المبلغ\s*المطلوب|المطلوب\s*دفعه|المطلوب\s*بعد|بعد\s*الخصم|اجمالى\s*الفاتورة)/i;
const TOTAL_WORD =
  /(total|amount|المجموع|الإجمالي|الاجمالي|اجمالي|إجمالي|اجمالى|المطلوب|الصافي|صافي)/i;
/** Lines whose numbers are identifiers, not prices. */
const NOT_MONEY_LINE =
  /(tel|phone|mobile|fax|هاتف|تليفون|تلفون|موبايل|محمول|رقم|tax\s*id|order|www\.|http|@|\d{3,}\s*[-/]\s*\d{2,})/i;
const NOT_TOTAL =
  /(sub\s*-?\s*total|المجموع\s*الفرعي|قبل\s*الضريبة|before\s*tax|tax|vat|ضريبة|القيمة\s*المضافة|discount|خصم|change|الباقي|الباقى|المتبقي|المتبقى|عمولة|commission|cash|نقد|مدفوع|paid|tender|received|المستلم|service\s*charge|رسوم\s*الخدمة|tip|items?\s*count|qty|عدد|الكمية)/i;

function confidenceOf(strong: boolean): ReceiptConfidence {
  return strong ? 'high' : 'medium';
}

/**
 * The figure that belongs to a keyword: the first amount after it (preferring
 * one with decimals, so a stray "2" or "3" never wins), else the last amount
 * on the line. A line like "before discount 3485.00 due after 3136.50 2" has
 * several numbers, and only one is the total.
 */
function figureAfterKeyword(line: string, keyword: RegExp): number | undefined {
  const at = line.search(keyword);
  const all: Array<{ n: number; index: number; decimals: boolean }> = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const n = parseAmount(m[1]);
    if (n !== null && n > 0 && n < 10_000_000) {
      all.push({ n, index: m.index ?? 0, decimals: /[.,]\d{2}$/.test(m[1]) });
    }
  }
  if (!all.length) return undefined;
  const after = all.filter((a) => a.index >= Math.max(at, 0));
  const pool = after.length ? after : all;
  const withDecimals = pool.find((a) => a.decimals);
  return (withDecimals ?? pool[after.length ? 0 : pool.length - 1]).n;
}

function findTotal(lines: string[]): {
  total?: number;
  confidence: ReceiptConfidence;
} {
  let best: { n: number; strong: boolean; idx: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const strong = TOTAL_STRONG.test(line);
    const word = TOTAL_WORD.test(line);
    if (!word && !strong) continue;
    if (NOT_TOTAL.test(line) && !strong) continue;
    let n = figureAfterKeyword(line, strong ? TOTAL_STRONG : TOTAL_WORD);
    if (n === undefined && lines[i + 1] && !NOT_TOTAL.test(lines[i + 1])) {
      n = figureAfterKeyword(lines[i + 1], /^/); // the amount sits on the next line
    }
    if (n === undefined) continue;
    if (
      !best ||
      (strong && !best.strong) ||
      (strong === best.strong && (n > best.n || (n === best.n && i > best.idx)))
    ) {
      best = { n, strong, idx: i };
    }
  }
  if (best) return { total: best.n, confidence: confidenceOf(best.strong) };

  // fallback: the largest plain amount in the lower half, never tax, change,
  // a phone number or an id. Money on a receipt has two decimals.
  let max = 0;
  const from = Math.floor(lines.length / 2);
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    if (NOT_TOTAL.test(line) || NOT_MONEY_LINE.test(line)) continue;
    for (const m of line.matchAll(AMOUNT_RE)) {
      if (!/[.,]\d{2}$/.test(m[1])) continue;
      const n = parseAmount(m[1]);
      if (n !== null && n > max && n < 1_000_000) max = n;
    }
  }
  return max > 0 ? { total: max, confidence: 'low' } : { confidence: 'low' };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return date.toISOString().slice(0, 10);
}

function plausible(isoDate: string | undefined, now: Date): string | undefined {
  if (!isoDate) return undefined;
  const t = Date.parse(isoDate + 'T00:00:00Z');
  const max = now.getTime() + 2 * 86400000;
  const min = now.getTime() - 3 * 365 * 86400000;
  return t >= min && t <= max ? isoDate : undefined;
}

function findDate(text: string, now: Date): string | undefined {
  // 2026-11-03, 2026/11/03
  for (const m of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    const r = plausible(iso(+m[1], +m[2], +m[3]), now);
    if (r) return r;
  }
  // 03/11/2026, 3-11-26, 03.11.2026 (day first; month first only when day > 12)
  for (const m of text.matchAll(
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g
  )) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const r =
      b > 12 && a <= 12
        ? plausible(iso(y, a, b), now)
        : plausible(iso(y, b, a), now);
    if (r) return r;
  }
  // 3 Nov 2026
  for (const m of text.matchAll(
    /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(20\d{2})\b/g
  )) {
    const mo = MONTHS[m[2].toLowerCase()];
    const r = mo ? plausible(iso(+m[3], mo, +m[1]), now) : undefined;
    if (r) return r;
  }
  // Nov 3, 2026
  for (const m of text.matchAll(
    /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/g
  )) {
    const mo = MONTHS[m[1].toLowerCase()];
    const r = mo ? plausible(iso(+m[3], mo, +m[2]), now) : undefined;
    if (r) return r;
  }
  return undefined;
}

const CURRENCIES: Array<[RegExp, string]> = [
  // Arabic abbreviations need their dots, so ordinary words never match.
  [/\b(EGP|L\.E\.?)(?!\w)|ج\.\s?م|جنيه/i, 'EGP'],
  [/\bSAR\b|ر\.\s?س\.?|ريال\s*سعودي/i, 'SAR'],
  [/\bAED\b|د\.\s?إ|درهم/i, 'AED'],
  [/\bKWD\b|د\.\s?ك|دينار\s*كويتي/i, 'KWD'],
  [/\bQAR\b|ر\.\s?ق|ريال\s*قطري/i, 'QAR'],
  [/\bUSD\b|\$/i, 'USD'],
  [/\bEUR\b|€/i, 'EUR'],
  [/\bGBP\b|£/i, 'GBP'],
];

function findCurrency(text: string): string | undefined {
  for (const [re, code] of CURRENCIES) if (re.test(text)) return code;
  return undefined;
}

const HEADER_SKIP =
  /(receipt|invoice|فاتورة|إيصال|ايصال|tax\s*(id|no|number)|رقم\s*(ضريبي|السجل|الفاتورة)|tel|phone|هاتف|تليفون|mobile|date|التاريخ|time|الوقت|cashier|الكاشير|order|www\.|http|@|welcome|مرحبا)/i;

/** Drops stray one-letter or one/two-digit tokens at the edges (OCR specks). */
function trimNoiseTokens(line: string): string {
  const tokens = line.split(' ');
  const noise = (t: string) =>
    t.length <= 1 || (t.length <= 2 && /^\d+$/.test(t));
  while (tokens.length > 1 && noise(tokens[0])) tokens.shift();
  while (tokens.length > 1 && noise(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function findMerchant(lines: string[]): string | undefined {
  for (const raw of lines.slice(0, 6)) {
    const line = raw
      .replace(/[|*_=~#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const letters = (line.match(/[A-Za-z؀-ۿ]/g) || []).length;
    const digits = (line.match(/\d/g) || []).length;
    if (letters < 3 || digits > letters) continue;
    if (HEADER_SKIP.test(line)) continue;
    const clean = trimNoiseTokens(line);
    if (clean.length < 3) continue;
    return clean.length > 40 ? clean.slice(0, 40).trim() : clean;
  }
  return undefined;
}

function findItems(lines: string[]): ReceiptItem[] {
  const items: ReceiptItem[] = [];
  for (const line of lines) {
    if (
      NOT_TOTAL.test(line) ||
      TOTAL_WORD.test(line) ||
      HEADER_SKIP.test(line)
    ) {
      continue;
    }
    // "name  qty  price  value": the last amount is the line's value
    const m = line.match(
      /^[|\s]*(.*?[A-Za-z؀-ۿ][^\d]*?)[\s)(\]|]+(?:\d{1,3}\s+|\d+\s*[xX×]\s*)?(?:\d+[.,]\d{1,2}\s+)*(\d+[.,]\d{1,2})\s*$/
    );
    if (!m) continue;
    const name = m[1].replace(/[.\-_:|)(]+$/g, '').trim();
    const amount = parseAmount(m[2]);
    if (name.length >= 2 && amount !== null && amount > 0) {
      items.push({ name: name.slice(0, 60), amount });
    }
    if (items.length >= 40) break;
  }
  return items;
}

export function parseReceipt(
  rawText: string,
  options: { now?: Date; source?: 'offline' | 'online' } = {}
): ReceiptExtraction {
  const now = options.now ?? new Date();
  const text = normalizeDigits(rawText || '');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const items = findItems(lines);
  const found = findTotal(lines);
  let total = found.total;
  let confidence = found.confidence;
  // Cross-check with the lines themselves: the items add up to roughly the
  // total. A total that is absurd against them (a phone number, "change due",
  // a stray digit) is replaced by the items' sum, and marked unsure.
  if (items.length >= 2) {
    const sum = Math.round(items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    if (sum > 0 && (total === undefined || total > sum * 10 || total < sum * 0.1)) {
      total = sum;
      confidence = 'low';
    }
  }
  // Reading Arabic-Indic digits from a photo is unreliable (a dropped decimal
  // mark turns 114.57 into 114,017), so a device reading of them is never
  // trusted: the person is asked to check the amount.
  const indicFromPhoto =
    (options.source ?? 'offline') === 'offline' && /[٠-٩۰-۹]/.test(rawText || '');
  if (indicFromPhoto) confidence = 'low';
  const date = findDate(text, now);
  const merchant = findMerchant(lines);
  return {
    merchant,
    date,
    total,
    currency: findCurrency(text),
    items,
    confidence: {
      total: total === undefined ? 'low' : confidence,
      date: date ? 'high' : 'low',
      merchant: merchant ? 'medium' : 'low',
    },
    source: options.source ?? 'offline',
    rawText,
  };
}
