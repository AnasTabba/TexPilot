import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerRequest } from '../server/scanner-proxy.mjs';

test('hosted scanner receives its own credential, never the inventory session', async () => {
  const incoming = new Request('https://yarnflow.example/api/v1/scan?detail=1', {
    method: 'POST', body: 'photo bytes', headers: {
      Cookie: 'yf_session=private', Authorization: 'Bearer browser-supplied',
      'Modal-Key': 'browser-key', 'Modal-Secret': 'browser-secret',
      'Content-Type': 'multipart/form-data; boundary=photo', Accept: 'application/json',
    },
  });
  const upstream = scannerRequest(incoming, {
    TEXPILOT_API_URL: 'https://scanner.modal.run', TEXPILOT_API_TOKEN: 'proxy-id.proxy-secret',
  });
  assert.equal(upstream.url, 'https://scanner.modal.run/api/v1/scan?detail=1');
  assert.equal(upstream.headers.get('Authorization'), 'Bearer proxy-id.proxy-secret');
  for (const header of ['Cookie', 'Modal-Key', 'Modal-Secret']) assert.equal(upstream.headers.get(header), null);
  assert.equal(upstream.headers.get('Content-Type'), 'multipart/form-data; boundary=photo');
  assert.equal(await upstream.text(), 'photo bytes');
  assert.equal(upstream.redirect, 'error');
});

test('existing tunnel works without a hosted credential', () => {
  const upstream = scannerRequest(new Request('https://yarnflow.example/api/v1/model'), {
    TEXPILOT_API_URL: 'https://existing-tunnel.example',
  });
  assert.equal(upstream.headers.get('Authorization'), null);
  assert.equal(upstream.method, 'GET');
});

test('a hosted credential is never sent over plaintext HTTP', () => {
  assert.throws(() => scannerRequest(new Request('https://yarnflow.example/api/v1/model'), {
    TEXPILOT_API_URL: 'http://scanner.example', TEXPILOT_API_TOKEN: 'private',
  }), /HTTPS/);
});
