import { Injectable } from '@angular/core';

/**
 * Reads the text of a receipt on the device with Tesseract (free, runs in a
 * Web Worker). The engine, its WebAssembly core and the Arabic + English
 * language data ship inside the app (assets/ocr), so it works offline and
 * nothing leaves the phone. It is loaded only when a receipt is scanned.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptOcrService {
  private base(): string {
    return new URL('assets/ocr/', document.baseURI).href;
  }

  async recognize(
    image: Blob,
    onProgress?: (fraction: number) => void
  ): Promise<string> {
    const { createWorker } = await import('tesseract.js');
    const base = this.base();
    const worker = await createWorker(['eng', 'ara'], 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      langPath: base + 'lang',
      gzip: false,
      cacheMethod: 'none',
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress?.(m.progress);
        }
      },
    });
    try {
      const { data } = await worker.recognize(image);
      return data.text || '';
    } finally {
      await worker.terminate();
    }
  }
}
