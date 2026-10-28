// Cloudflare Worker for the published app: static files come from dist (wrangler.jsonc assets);
// only /api/* reaches this code. Signed-in scanner calls go to TEXPILOT_API_URL; a hosted
// service can use the optional TEXPILOT_API_TOKEN secret. No stand-in results are generated. Every other /api/*
// route is the shared inventory, accounts and sign-in, on the D1 database bound as DB.
import { inventoryApi, signedIn } from './inventory.mjs';
import { forwardToScanner } from './scanner-proxy.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/')) return inventoryApi(request, env);
    // Scanning needs no permission, but it does need a signed-in person.
    if (!await signedIn(request, env)) return Response.json({ error: 'Sign in with your name and PIN to scan.' }, { status: 401 });
    if (!env.TEXPILOT_API_URL) return Response.json({ error: 'The TexPilot scanner is not connected to this site yet.' }, { status: 503 });
    try {
      return await forwardToScanner(request, env);
    } catch {
      return Response.json({ error: 'The TexPilot scanner could not be reached. Please try again shortly.' }, { status: 502 });
    }
  },
};
