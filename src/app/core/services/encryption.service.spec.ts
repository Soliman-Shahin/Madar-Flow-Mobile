import { EncryptionService } from './encryption.service';

describe('EncryptionService (AES via crypto-js sub-modules)', () => {
  const service = new EncryptionService();

  it('round-trips objects and keeps the CryptoJS "Salted__" envelope the backend expects', () => {
    const cipher = service.encrypt({ email: 'a@b.c', n: 1 });
    expect(cipher.startsWith('U2FsdGVkX1')).toBeTrue();
    expect(service.decrypt(cipher)).toEqual({ email: 'a@b.c', n: 1 });
  });

  it('uses the supplied key and fails closed with a different one', () => {
    const cipher = service.encrypt({ a: 1 }, 'key-one');
    expect(service.decrypt(cipher, 'key-one')).toEqual({ a: 1 });
    expect(service.decrypt(cipher, 'key-two')).toBeNull();
  });

  it('returns plain text when asked and handles empty input', () => {
    const cipher = service.encrypt('hello');
    expect(service.decrypt(cipher, undefined, false)).toBe('"hello"');
    expect(service.encrypt(null)).toBe('');
    expect(service.decrypt('')).toBeNull();
  });
});
