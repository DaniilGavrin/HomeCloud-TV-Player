const SERVER_KEY = 'hctv:ws-url';
const DEVICE_KEY = 'hctv:device-id';
let sessionDeviceId: string | null = null;

export function getSavedServer(): string | null {
  try { return localStorage.getItem(SERVER_KEY); } catch { return null; }
}

export function saveServer(url: string): void {
  try { localStorage.setItem(SERVER_KEY, url); } catch { /* Browsing storage may be restricted. */ }
}

export function getDeviceId(): string {
  if (sessionDeviceId) return sessionDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(existing)) {
      sessionDeviceId = existing;
      return existing;
    }
  } catch { /* Continue without persistent storage. */ }
  sessionDeviceId = `hc-tv-${crypto.randomUUID()}`;
  try { localStorage.setItem(DEVICE_KEY, sessionDeviceId); } catch { /* In-memory identity. */ }
  return sessionDeviceId;
}
