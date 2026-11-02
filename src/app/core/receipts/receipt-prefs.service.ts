import { Injectable } from '@angular/core';

export type OnlineReading = 'on' | 'off' | null;

/**
 * Whether a reduced copy of a receipt photo may be sent to the server's
 * reader. Never assumed: it is asked once, and can be changed in Settings.
 * Until the person says yes, receipts are read on the device only.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptPrefsService {
  private readonly key = 'madarflow_receipt_online';

  get onlineReading(): OnlineReading {
    try {
      const v = localStorage.getItem(this.key);
      return v === 'on' || v === 'off' ? v : null;
    } catch {
      return null;
    }
  }

  set onlineReading(value: OnlineReading) {
    try {
      if (value) localStorage.setItem(this.key, value);
      else localStorage.removeItem(this.key);
    } catch {
      /* storage unavailable: stay on the device-only default */
    }
  }

  get onlineAllowed(): boolean {
    return this.onlineReading === 'on';
  }
}
