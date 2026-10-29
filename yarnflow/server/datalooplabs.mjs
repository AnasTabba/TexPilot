/** DataLoopLabs / TrackIT adapter.
 *
 * Fail-closed by design: no endpoint is guessed. A provider call happens only
 * after an administrator read the account's own API documentation and stored the
 * verified contract (base URL, track path, field mapping) with an audit note.
 * The credential itself stays in a Worker secret (`DATALOOPLABS_API_KEY`) and is
 * scrubbed from every message, URL and stored string.
 */

export const PROVIDER = 'datalooplabs';

export class ProviderProblem extends Error {
  constructor(kind, message, status = 0) { super(message); this.kind = kind; this.status = status; }
}

export function credentialOf(env) {
  const key = env?.DATALOOPLABS_API_KEY;
  return typeof key === 'string' && key.trim().length >= 12 ? key.trim() : null;
}

export async function accountScope(env) {
  const key = credentialOf(env);
  if (!key) return null;
  // Only a masked fingerprint ever identifies the account: never the key itself.
  return `${PROVIDER}:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))))
    .slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function maskedCredential(env) {
  const key = credentialOf(env);
  return key ? `…${key.slice(-4)}` : null;
}

/** Remove the credential and bearer patterns from anything that could be logged or stored. */
export function redact(value, env) {
  let text = String(value ?? '');
  const key = credentialOf(env);
  if (key) text = text.split(key).join('[credential removed]');
  return text.replace(/[Bb]earer\s+[A-Za-z0-9_\-=.]{6,}/g, '[credential removed]');
}

export function pickFn(source, path) {
  return path.split('.').reduce((value, part) => (value == null ? undefined : value[part]), source);
}

export function parseContract(raw) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const request = parsed?.request;
  const response = parsed?.response;
  if (typeof request?.number !== 'string') return null;
  if (typeof response?.containers !== 'string' || typeof response?.reference !== 'string') return null;
  if (typeof response?.events !== 'string' || !response?.event?.time || !response?.event?.title) return null;
  return parsed;
}

export function contractGaps(account) {
  const gaps = [];
  if (!account?.base_url || !/^https:\/\//i.test(account.base_url)) gaps.push('provider base URL (HTTPS, from the account documentation)');
  if (!account?.track_path || !/^\/[A-Za-z0-9_\-./]*$/.test(account.track_path)) gaps.push('documented tracking endpoint path');
  if (!account?.contract_verified_at) gaps.push('admin attestation that the account contract was read');
  if (!parseContract(account?.contract_json)) gaps.push('request and response field mapping from the account documentation');
  return gaps;
}

export function adapterReady(env, account) {
  return {
    credential: !!credentialOf(env),
    contract: (account?.contract_verified_at ?? null) != null && contractGaps(account).length === 0,
    gaps: contractGaps(account),
  };
}

/** Build and send one tracking call. Throws ProviderProblem whose kind maps to an honest state. */
export async function trackUnit(env, account, request, deps = {}) {
  const key = credentialOf(env);
  if (!key) throw new ProviderProblem('not_configured', 'The DataLoopLabs API key is not configured as a server secret.');
  if (!account || !account.contract_verified_at) {
    throw new ProviderProblem('contract_unavailable',
      'The provider contract is not verified, so endpoints and field names cannot be guessed. Tracking stays unconnected and no credits are spent.');
  }
  const contract = parseContract(account.contract_json);
  if (!contract) throw new ProviderProblem('contract_unavailable', 'The stored contract is incomplete. No credits are spent until it is re-recorded.');

  const url = `${String(account.base_url).replace(/\/+$/, '')}${account.track_path}`;
  if (!/^https:\/\//i.test(url)) throw new ProviderProblem('contract_unavailable', 'The recorded provider base URL is not HTTPS.');
  const body = { [contract.request.number]: request.identifier };
  if (contract.request.type && request.identifier_type) {
    const mapped = contract.request.types?.[request.identifier_type] ?? request.identifier_type;
    body[contract.request.type] = mapped.toLowerCase();
  }
  if (contract.request.carrier && request.carrier) body[contract.request.carrier] = request.carrier;
  if (contract.request.force) body[contract.request.force] = !!request.force_update;

  const timeout = AbortSignal.timeout(deps.timeoutMs ?? 20_000);
  let response;
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: timeout,
    });
  } catch (error) {
    if (timeout.aborted) {
      // The request may or may not have reached the provider. Callers must reconcile before retrying.
      throw new ProviderProblem('ambiguous_timeout', redact(String(error?.message || 'the call timed out'), env));
    }
    throw new ProviderProblem('network_error', redact(String(error?.message || 'the network call failed'), env));
  }
  const status = response.status;
  if (status === 429) throw new ProviderProblem('rate_limited', 'The shared API key hit the provider rate limit.');
  if (status === 401 || status === 403) throw new ProviderProblem('credential_rejected', `The configured API credential was rejected by the provider (HTTP ${status}).`);
  if (status === 404) throw new ProviderProblem('invalid_identifier', 'The provider does not recognize this number.');
  if (status >= 500) throw new ProviderProblem('provider_unavailable', `Provider error (HTTP ${status}). No retry was started automatically.`);
  if (status !== 200) throw new ProviderProblem('provider_rejection', `The provider answered HTTP ${status}. Reconcile against the account before retrying.`);

  let payload;
  try { payload = await response.json(); } catch (error) {
    throw new ProviderProblem('garbled_response', 'A 200 response could not be read as JSON. Reconcile against the account before retrying.');
  }
  return normalize(contract, payload);
}

export function normalize(contract, payload) {
  const upstream = payload?.data ?? payload?.result ?? payload ?? {};
  const containers = pickFn(upstream, contract.response.containers);
  const list = Array.isArray(containers) ? containers : containers ? [containers] : [];
  const numberField = typeof contract.response.containerNumber === 'string';
  const containerIds = [...new Set(list
    .map(item => String(numberField ? pickFn(item, contract.response.containerNumber) : item ?? '').trim().toUpperCase())
    .filter(value => /^[A-Z]{4}[0-9]{7}$/.test(value)))];

  const events = (Array.isArray(pickFn(upstream, contract.response.events)) ? pickFn(upstream, contract.response.events) : [])
    .map(event => {
      const eventContract = contract.response.event;
      const at = Date.parse(String(pickFn(event, eventContract.time) ?? ''));
      const title = String(pickFn(event, eventContract.title) ?? '');
      const code = String(eventContract.code ? pickFn(event, eventContract.code) ?? '' : title);
      const location = String(eventContract.location ? pickFn(event, eventContract.location) ?? '' : '');
      return { at: Number.isFinite(at) ? at : null, title, code, location };
    })
    .filter(event => event.title || event.code || event.at);

  const result = {
    containers: containerIds,
    events,
    reference: String(pickFn(upstream, contract.response.reference) ?? ''),
    dataAt: typeof contract.response.dataTimestamp === 'string'
      ? (() => { const at = Date.parse(String(pickFn(upstream, contract.response.dataTimestamp) ?? '')); return Number.isFinite(at) ? at : null; })()
      : null,
  };
  return { ...result, empty: !result.containers.length && !result.events.length && !result.reference };
}
