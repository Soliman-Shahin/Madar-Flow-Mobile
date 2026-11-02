import { ReceiptExtraction } from './receipt.types';

/**
 * Suggests a category for a scanned receipt, in two steps:
 *  1. what this person chose last time for the same shop (their own habit),
 *  2. otherwise the kind of shop or goods named on the receipt, matched to the
 *     person's own categories by name.
 * It only suggests: nothing is chosen when no category fits, and the person
 * can always change it.
 */

export interface CategoryLike {
  _id: string;
  title: string;
  type?: 'income' | 'outcome';
}

interface Group {
  /** Words that appear on receipts of this kind. */
  words: string[];
  /** Fragments of a category's name that mean the same kind. */
  hints: string[];
}

const GROUPS: Group[] = [
  {
    words: ['سوبر ماركت', 'سوبرماركت', 'هايبر', 'بقالة', 'بقاله', 'مطعم', 'مخبز', 'فرن', 'خضار', 'فاكهة', 'لحوم', 'جزارة', 'مأكولات', 'حلويات', 'supermarket', 'market', 'grocery', 'restaurant', 'bakery', 'pizza', 'burger', 'kfc', 'mcdonald'],
    hints: ['food', 'grocer', 'meal', 'طعام', 'أكل', 'اكل', 'مأكولات', 'مطاعم', 'سوبر', 'بقال', 'وجبات'],
  },
  {
    words: ['كافيه', 'كافي ', 'قهوة', 'قهوه', 'كوفي', 'coffee', 'cafe', 'starbucks', 'costa'],
    hints: ['coffee', 'cafe', 'قهوة', 'قهوه', 'كافيه', 'كوفي'],
  },
  {
    words: ['ملابس', 'كوتشى', 'كوتشي', 'حذاء', 'جزمة', 'شبشب', 'بنطلون', 'فستان', 'قميص', 'shirt', 'shoes', 'fashion', 'zara'],
    hints: ['cloth', 'wear', 'fashion', 'shoe', 'ملابس', 'أزياء', 'ازياء', 'لبس', 'حذاء'],
  },
  {
    words: ['صيدلية', 'صيدليه', 'دواء', 'عيادة', 'مستشفى', 'معمل', 'تحاليل', 'pharmacy', 'clinic', 'hospital'],
    hints: ['health', 'medic', 'pharm', 'doctor', 'صح', 'علاج', 'دواء', 'صيدل', 'طبي'],
  },
  {
    words: ['بنزين', 'وقود', 'محطة', 'petrol', 'fuel', 'gas station'],
    hints: ['car', 'fuel', 'petrol', 'auto', 'سيارة', 'عربية', 'بنزين', 'وقود', 'مواصلات'],
  },
  {
    words: ['كهرباء', 'electric'],
    hints: ['electric', 'كهرباء', 'utilit', 'فواتير'],
  },
  {
    words: ['اتصالات', 'فودافون', 'vodafone', 'orange', 'etisalat', 'شحن رصيد', 'رصيد'],
    hints: ['mobile', 'phone', 'telecom', 'موبايل', 'تليفون', 'اتصالات', 'رصيد'],
  },
  {
    words: ['أثاث', 'اثاث', 'مفروشات', 'ikea', 'أدوات منزلية', 'ادوات منزلية', 'سباكة', 'furniture'],
    hints: ['home', 'house', 'منزل', 'بيت', 'البيت'],
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْـ]/g, '')
    .trim();

/** A stable key for a shop name: letters and digits only. */
export function merchantKey(merchant: string | undefined): string {
  return norm(merchant ?? '').replace(/[^a-z0-9؀-ۿ]+/g, '');
}

export type MerchantMemory = Record<string, string>;

export function suggestCategory(
  extraction: Pick<ReceiptExtraction, 'merchant' | 'items' | 'rawText'>,
  categories: CategoryLike[],
  memory: MerchantMemory = {}
): { id: string; reason: 'history' | 'keywords' } | undefined {
  const spending = categories.filter((c) => (c.type ?? 'outcome') === 'outcome');

  // 1. the same shop as last time
  const key = merchantKey(extraction.merchant);
  const remembered = key ? memory[key] : undefined;
  if (remembered && spending.some((c) => c._id === remembered)) {
    return { id: remembered, reason: 'history' };
  }

  // 2. the kind of shop or goods; the shop name and item names count double
  const strong = norm(
    [extraction.merchant ?? '', ...extraction.items.map((i) => i.name)].join(' ')
  );
  const weak = norm(extraction.rawText ?? '');
  let best: { group: Group; score: number } | undefined;
  for (const group of GROUPS) {
    let score = 0;
    for (const w of group.words) {
      const word = norm(w);
      if (strong.includes(word)) score += 2;
      else if (weak.includes(word)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { group, score };
  }
  if (!best) return undefined;
  const match = spending.find((c) =>
    best!.group.hints.some((h) => norm(c.title).includes(norm(h)))
  );
  return match ? { id: match._id, reason: 'keywords' } : undefined;
}

// --- what this person chose, kept on this device -----------------------------

const memoryKey = (ownerId: string) =>
  `madarflow.receipt-merchant-category.v1.${ownerId}`;

export function readMerchantMemory(ownerId: string): MerchantMemory {
  try {
    const raw = localStorage.getItem(memoryKey(ownerId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberMerchantCategory(
  ownerId: string,
  merchant: string | undefined,
  categoryId: string
): void {
  const key = merchantKey(merchant);
  if (!ownerId || !key || !categoryId) return;
  try {
    const memory = readMerchantMemory(ownerId);
    delete memory[key]; // re-insert so the newest are last
    memory[key] = categoryId;
    const entries = Object.entries(memory).slice(-200);
    localStorage.setItem(memoryKey(ownerId), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable: the suggestion just will not be remembered */
  }
}
