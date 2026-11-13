/** Short-lived service identity. Browser credentials and session hashes never enter the assertion. */
import { canonicalJson, violation } from './qc-contract.mjs';
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = value => new TextEncoder().encode(value);
export async function issueQCAssertion(authContext, payloadHash, requestId, now, options = {}) {
  const { key, kid = 'qc-local-1', request_generation = 1, deadline_at = new Date(now + 60000).toISOString() } = options;
  if (!key || !authContext || !(authContext.session_expires_at > now) || !(Date.parse(deadline_at) > now)) throw new Error('QC service identity unavailable');
  const iat = Math.floor(now / 1000), nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
  const claims = { kid, aud: 'texpilot-scanner-qc', iat, exp: iat + 30, nonce, request_id: requestId, request_generation, workspace_id: authContext.workspace_id, actor_id: authContext.user_id, payload_sha256: payloadHash, deadline_at };
  if (violation('AssertionClaims', claims)) throw new Error('QC service identity invalid');
  const part = b64(utf8(canonicalJson(claims))), message = `v1.${part}`;
  const hmac = await crypto.subtle.importKey('raw', utf8(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${message}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, utf8(message))))}`;
}
