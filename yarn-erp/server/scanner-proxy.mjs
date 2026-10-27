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
