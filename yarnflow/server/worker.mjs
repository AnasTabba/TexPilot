import { inventoryApi } from './inventory.mjs';
import assets from './assets.generated.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return inventoryApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = assets[path] || (request.headers.get('Accept')?.includes('text/html') ? assets['/index.html'] : null);
    if (!asset) return new Response('Not found', { status: 404 });
    const [type, encoded] = asset;
    const headers = {
      'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site",
      'Cache-Control': path.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache',
      ...(path === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    };
    if (request.method === 'HEAD') return new Response(null, { headers });
    const data = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    return new Response(data, { headers });
  },
};
