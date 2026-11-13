// Only scanner payload headers leave Yarnflow. Inventory cookies belong to this origin.
export function scannerRequest(request, env) {
  const source = new URL(request.url);
  const target = new URL(source.pathname + source.search, env.TEXPILOT_API_URL);
  const headers = new Headers();
  for (const name of ['Content-Type', 'Accept']) {
    if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  }
  if (env.TEXPILOT_API_TOKEN) {
    if (target.protocol !== 'https:') throw new Error('Hosted scanner credentials require HTTPS');
    headers.set('Authorization', `Bearer ${env.TEXPILOT_API_TOKEN}`);
  }
  return new Request(target, {
    method: request.method, headers, redirect: 'manual',
    ...(request.body ? { body: request.body, duplex: 'half' } : {}),
  });
}

// Workers accept only redirect 'follow' or 'manual' ('error' throws there, though Node allows it), so a
// redirect is refused here: a photo or credential never follows the scanner to another address.
export async function forwardToScanner(request, env, send = fetch) {
  const response = await send(scannerRequest(request, env));
  if (response.status >= 300 && response.status < 400) throw new Error('The scanner answered with a redirect');
  return response;
}

/** QC has a fixed private endpoint and its own signed identity. No incoming headers are forwarded. */
export async function sendQCToScanner(env, { path, body, assertion, deadline_at }, send = fetch) {
  if (!env.TEXPILOT_API_URL || !assertion || !['analyze', 'readiness'].includes(path)) throw new Error('QC upstream unavailable');
  const base = new URL(env.TEXPILOT_API_URL);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) throw new Error('QC upstream requires secure transport');
  const target = new URL(`/api/v2/qc/${path}`, base), headers = new Headers({ 'X-QC-Assertion': assertion, Accept: 'application/json' });
  if (env.TEXPILOT_API_TOKEN) headers.set('Authorization', `Bearer ${env.TEXPILOT_API_TOKEN}`);
  const remaining = deadline_at - Date.now();
  if (!(remaining > 0)) throw new DOMException('Deadline exceeded', 'TimeoutError');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await send(new Request(target, { method: path === 'readiness' ? 'GET' : 'POST', headers, redirect: 'manual', credentials: 'omit', signal: controller.signal, ...(body ? { body } : {}) }));
        if (response.status >= 300 && response.status < 400) throw new Error('QC redirect refused');
        // Include response-body transfer in the deadline and bound it before JSON decoding.
        const parts = []; let size = 0; const reader = response.body?.getReader();
        if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('QC upstream answer too large'); } parts.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        return new Response(bytes, { status: response.status, headers: { 'Content-Type': 'application/json' } });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DOMException('Deadline exceeded', 'TimeoutError')); }, remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}
