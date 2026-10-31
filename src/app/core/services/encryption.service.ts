import { Injectable } from '@angular/core';
// Only AES + UTF-8 are used: importing these modules (not the whole library) keeps ~100 kB out of the bundle.
import AES from 'crypto-js/aes';
import Utf8 from 'crypto-js/enc-utf8';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class EncryptionService {
  // NOTE: This service is used for client-side encryption of request/response data
  // The encryption key must match the backend's ENCRYPTION_KEY or fallback
  // Using TEMP_TRANSPORT_KEY to match backend fallback
  private readonly TRANSPORT_KEY = 'TEMP_TRANSPORT_KEY'; // Matches backend fallback

  constructor() {}

  encrypt(data: any, key?: string): string {
    if (!data) return '';
    try {
      return AES.encrypt(
        JSON.stringify(data),
        key || this.TRANSPORT_KEY
      ).toString();
    } catch (e) {
      console.warn('Cryptographic operation failed');
      return '';
    }
  }

  decrypt(ciphertext: string, key?: string, isObject: boolean = true): any {
    if (!ciphertext) return null;
    try {
      const bytes = AES.decrypt(ciphertext, key || this.TRANSPORT_KEY);
      const decryptedData = bytes.toString(Utf8);
      return isObject ? JSON.parse(decryptedData) : decryptedData;
    } catch (e) {
      console.warn('Cryptographic operation failed');
      return null;
    }
  }
}
