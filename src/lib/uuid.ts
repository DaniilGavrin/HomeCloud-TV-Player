/** UUID v4 for WebViews without crypto.randomUUID (e.g. Android on http://tauri.localhost).
 * getRandomValues is allowed in non-secure contexts. Do not use Math.random.
 * This is a device/message identifier, NOT an authentication credential. */
export function createUUID(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  if (typeof webCrypto?.getRandomValues !== 'function') {
    throw new Error('Недоступен криптографический генератор идентификаторов (crypto.getRandomValues).');
  }
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
