/** How sure the reader is about one extracted field. */
export type ReceiptConfidence = 'high' | 'medium' | 'low';

export interface ReceiptItem {
  name: string;
  amount: number;
}

/** What a scan produced. Every field is optional: the user reviews it all. */
export interface ReceiptExtraction {
  merchant?: string;
  /** Calendar date as YYYY-MM-DD. */
  date?: string;
  total?: number;
  /** ISO 4217 code when the receipt shows one. */
  currency?: string;
  items: ReceiptItem[];
  confidence: {
    merchant: ReceiptConfidence;
    date: ReceiptConfidence;
    total: ReceiptConfidence;
  };
  /** Where the numbers came from. */
  source: 'offline' | 'online';
  rawText: string;
}

/** The small picture and details kept on the device for a saved transaction. */
export interface StoredReceipt {
  /** Key shared with the transaction: its client id, or its id. */
  id: string;
  ownerUserId: string;
  /** JPEG data URL, about 320px: for lists and the transaction sheet. */
  thumb: string;
  /**
   * A larger copy (about 1200px, 80-200 KB) for viewing full screen. Absent on
   * receipts saved before it existed; the viewer then shows the thumbnail.
   */
  image?: string;
  merchant?: string;
  total?: number;
  currency?: string;
  items: ReceiptItem[];
  scannedAt: string;
  source: 'offline' | 'online';
}
