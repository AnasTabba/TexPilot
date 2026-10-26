// Cloudflare Worker for the published app: static files come from dist (wrangler.jsonc assets);
// only /api/* reaches this code. Scanner calls (/api/v1/*) pass through to the TexPilot server on the
// Mac for signed-in people; its HTTPS tunnel address is the TEXPILOT_API_URL secret. Nothing is answered here: if the
// Mac or its tunnel is off, the app is told so, never given a stand-in result. Every other /api/*
// route is the shared inventory, accounts and sign-in, on the D1 database bound as DB.
import { inventoryApi, signedIn } from './inventory.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/')) return inventoryApi(request, env);
    // Scanning needs no permission, but it does need a signed-in person.
    if (!await signedIn(request, env)) return Response.json({ error: 'Sign in with your name and PIN to scan.' }, { status: 401 });
    if (!env.TEXPILOT_API_URL) return Response.json({ error: 'The TexPilot scanner is not connected to this site yet.' }, { status: 503 });
    try {
      return await fetch(new Request(new URL(url.pathname + url.search, env.TEXPILOT_API_URL), request));
    } catch {
      return Response.json({ error: 'The TexPilot scanner on the Mac could not be reached. Check that the Mac is on and the tunnel is running.' }, { status: 502 });
    }
  },
};
