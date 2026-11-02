import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';
import { ConnectionService } from '../services/connection.service';
import {
  blobToDataUrl,
  loadBitmap,
  makeThumbnail,
  makeUploadImage,
  prepareForOcr,
} from './receipt-image';
import { ReceiptOcrService } from './receipt-ocr.service';
import { ReceiptPrefsService } from './receipt-prefs.service';
import { parseReceipt } from './receipt-parser';
import { ReceiptExtraction } from './receipt.types';

export interface ScanResult {
  extraction: ReceiptExtraction;
  thumb: string;
  /** Larger copy kept on the device for full-screen viewing. */
  image: string;
}

export type ScanStage = 'preparing' | 'online' | 'reading';

/**
 * Scans a receipt photo, with two readers and no paid service:
 *  - online: the server's reader (a free model, when the server has one set
 *    up). Better on blurry or handwritten receipts. Any failure, a missing
 *    setup or an exhausted plan allowance simply moves on to the next reader.
 *  - on the device: Tesseract. Works offline and is always available.
 * The person always reviews the result before anything is saved.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptScanService {
  private readonly api = inject(ApiService);
  private readonly connection = inject(ConnectionService);
  private readonly ocr = inject(ReceiptOcrService);
  private readonly prefs = inject(ReceiptPrefsService);

  async scan(
    file: Blob,
    options: {
      onStage?: (stage: ScanStage) => void;
      onProgress?: (fraction: number) => void;
    } = {}
  ): Promise<ScanResult> {
    options.onStage?.('preparing');
    const bitmap = await loadBitmap(file);
    try {
      const thumb = await makeThumbnail(bitmap);
      const image = await makeThumbnail(bitmap, 1200, 0.7);

      if (this.prefs.onlineAllowed && this.connection.isOnline()) {
        options.onStage?.('online');
        const online = await this.tryOnline(bitmap);
        if (online) return { extraction: online, thumb, image };
      }

      options.onStage?.('reading');
      const text = await this.ocr.recognize(
        await prepareForOcr(bitmap),
        options.onProgress
      );
      return {
        extraction: parseReceipt(text, { source: 'offline' }),
        thumb,
        image,
      };
    } finally {
      bitmap.close?.();
    }
  }

  private async tryOnline(
    bitmap: ImageBitmap
  ): Promise<ReceiptExtraction | null> {
    try {
      const image = await blobToDataUrl(await makeUploadImage(bitmap));
      const res = await firstValueFrom(
        this.api.post<any>(
          '/receipts/extract',
          { image },
          // reading a photo with a model can take 20-30 s
          { timeoutMs: 40_000 }
        )
      );
      const data = res?.data ?? res;
      if (!data || typeof data !== 'object') return null;
      const total = Number(data.total);
      const items = Array.isArray(data.items) ? data.items : [];
      const extraction: ReceiptExtraction = {
        merchant:
          typeof data.merchant === 'string' && data.merchant.trim()
            ? data.merchant.trim().slice(0, 60)
            : undefined,
        date:
          typeof data.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
            ? data.date
            : undefined,
        total: Number.isFinite(total) && total > 0 ? total : undefined,
        currency:
          typeof data.currency === 'string' && /^[A-Za-z]{3}$/.test(data.currency)
            ? data.currency.toUpperCase()
            : undefined,
        items: items
          .map((i: any) => ({
            name: String(i?.name ?? '').slice(0, 60),
            amount: Number(i?.amount),
          }))
          .filter((i: any) => i.name && Number.isFinite(i.amount) && i.amount > 0)
          .slice(0, 40),
        confidence: {
          total: Number.isFinite(total) && total > 0 ? 'high' : 'low',
          date: data.date ? 'high' : 'low',
          merchant: data.merchant ? 'high' : 'low',
        },
        source: 'online',
        rawText: '',
      };
      // An answer with no total helps nobody: let the device reader try.
      return extraction.total ? extraction : null;
    } catch {
      return null;
    }
  }
}
