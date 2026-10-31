/** Normalize a LAN/Tailscale address for HomeCloud WS v1. */
export function normalizeServerAddress(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('Введите адрес сервера.');

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const candidate = hasScheme ? value : `ws://${value}`;

  let endpoint: URL;
  try {
    endpoint = new URL(candidate);
  } catch {
    throw new Error('Неверный адрес сервера. Проверьте IP, имя хоста или порт.');
  }

  if (!['ws:', 'wss:'].includes(endpoint.protocol) || !endpoint.hostname) {
    throw new Error('Адрес должен использовать ws:// или wss://.');
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Укажите адрес без логина, пароля и фрагмента #.');
  }

  // HomeCloud Go default: ws://<host>:8080/ws.
  // Explicit wss:// usually points to a TLS reverse proxy; retain its default port.
  if (!endpoint.port && endpoint.protocol === 'ws:') endpoint.port = '8080';
  if (endpoint.pathname === '/' || !endpoint.pathname) endpoint.pathname = '/ws';
  return endpoint.toString();
}
