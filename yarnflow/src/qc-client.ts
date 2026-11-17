/** Public Worker API only. No local decisions, private scanner calls, persistence or success cache. */
import { qcDrafts, type QCDraftStore } from './qc-drafts.ts';
import { isQCResult, isPurchaseSpec, isSamplingSelection, isConsentAuthority, isRelease, isErrorEnvelope, isQCStatus, isPurchaseOrderList, isSampleList, isRequestState, type QCResult, type QCStatus, type PurchaseOrderItem, type PurchaseSpec, type SamplingSelection, type ConsentAuthority, type SampleSummary, type RequestState, type Release, type ErrorBody, type AcquisitionAttestation, type CaptureRole, type Construction, type DensityUnit, type Axis, type Outcome } from './qc-types.ts';
import type { FailureCode } from './qc-reasons.ts';
export const QC_SESSION_EXPIRED = 'yf-qc-session-expired';
export class QCError extends Error {
 code: FailureCode; status: number; outcome: 'UNKNOWN' | null; error: ErrorBody | null;
 constructor(code: FailureCode, status = 0, unknown = false, error: ErrorBody | null = null) { super(code); this.code = code; this.status = status; this.outcome = unknown ? 'UNKNOWN' : null; this.error = error; }
}
export interface SpecInput { purchase_order_id: string; expected_spec_version: number | null; construction: Construction; allowed_fabric_labels: string[]; taxonomy_version: string; density: { axis: Axis; unit: DensityUnit; target: number; lower: number; upper: number; candidate: Record<string, unknown> | null }[]; confirmation_reason: string; interventionReason?: string }
export type SelectionInput = Omit<SamplingSelection, 'id' | 'workspace_id' | 'created_by' | 'created_at'> & { interventionReason?: string };
export interface SampleInput { selection_id: string; spec_id: string; spec_version: number; predecessor_sample_id: string | null; expected_predecessor_revision: number | null; reason: string; disposition?: 'SELECTED' | 'MISSING' | 'EXCLUDED'; exclusion_reason?: string; interventionReason?: string }
export interface CaptureMeta { capture_id: string; role: CaptureRole; expected_revision: number; sha256: string; taken_at: string; device_profile_id: string; calibration_id: string | null; consent_record_id: string; attestation: AcquisitionAttestation }
export interface AdjudicationInput { expected_revision: number; outcome: Outcome; reason: string; reference_ids: string[]; supersedes_id: string | null; interventionReason?: string }
type Guard = (value: unknown) => boolean;
export interface QCClientOptions {
 fetch?: typeof fetch; store?: QCDraftStore; now?: () => number;
 sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
 setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (id: unknown) => void;
 onUnknown?: (key: string) => void; onSessionExpired?: () => void;
}
const id = encodeURIComponent;
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const items = (guard: Guard): Guard => v => obj(v) && Object.keys(v).length === 1 && Array.isArray(v.items) && v.items.every(guard);
const isSpecResponse: Guard = v => obj(v) && Object.keys(v).length === 3 && isPurchaseSpec(v.spec) && typeof v.current === 'boolean' && Array.isArray(v.versions) && v.versions.every((n: unknown) => Number.isSafeInteger(n) && (n as number) >= 1);
const isProgress: Guard = v => obj(v) && v.schema_version === '2' && v.state === 'IN_PROGRESS' && typeof v.request_id === 'string' && /^[0-9a-f-]{36}$/.test(v.request_id) && v.status_url === `/api/qc/v2/requests/${v.request_id}` && Object.keys(v).length === 4;
export function createQCClient(options: QCClientOptions = {}) {
 const send = options.fetch ?? globalThis.fetch.bind(globalThis), store = options.store ?? qcDrafts(), now = options.now ?? Date.now;
 const later = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)), cancel = options.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
 const sleep = options.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new QCError('ABORTED')); return; }
  const abort = () => { cancel(timer); reject(new QCError('ABORTED')); };
  const timer = later(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms); signal?.addEventListener('abort', abort, { once: true });
 }));
 const check = (generation: number, signal?: AbortSignal) => { if (generation !== store.generation || !store.identity) throw new QCError('STALE_SESSION'); if (signal?.aborted) throw new QCError('ABORTED'); };
 async function request<T>(path: string, guard: Guard, data?: unknown, key?: string, signal?: AbortSignal, binary = false): Promise<T> {
  const generation = store.generation, mutation = data !== undefined;
  if (mutation && (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key))) throw new QCError('MALFORMED_REQUEST');
  let uncertain = false;
  for (let attempt = 0; ; attempt++) {
   check(generation, signal);
   const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
   const timer = later(abort, 60000); let response: Response | null = null, value: unknown;
   try {
    response = await send('/api/qc/v2' + path, { method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: mutation ? { 'Idempotency-Key': key!, ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }) } : {}, ...(mutation ? { body: data instanceof FormData ? data : JSON.stringify(data) } : {}) });
    check(generation, signal);
    if (response.status === 401) { store.invalidate(); options.onSessionExpired?.(); if (typeof window !== 'undefined') window.dispatchEvent(new Event(QC_SESSION_EXPIRED)); throw new QCError('UNAUTHENTICATED', 401); }
    // The response body can fail after the server committed. Treat that exactly like response loss.
    value = binary && response.ok ? await response.blob() : await response.json();
    check(generation, signal);
   } catch (error) {
    if (error instanceof QCError) throw error;
    check(generation); uncertain ||= mutation;
    if (mutation) options.onUnknown?.(key!);
    if (signal?.aborted) throw new QCError('ABORTED', 0, uncertain);
    if (attempt === 3) throw new QCError(mutation ? 'UNKNOWN_OUTCOME' : 'TRANSPORT', 0, uncertain);
   } finally { cancel(timer); signal?.removeEventListener('abort', abort); }
   if (response && value !== undefined) {
    if (response.ok) { if (!binary && !guard(value)) throw new QCError('BAD_RESPONSE', response.status, mutation); return value as T; }
    if (![429,503,504].includes(response.status) || attempt === 3) throw new QCError(isErrorEnvelope(value) ? value.error.code : 'BAD_RESPONSE', response.status, uncertain, isErrorEnvelope(value) ? value.error : null);
   }
   const backoff = [1000,2000,4000][attempt]; let retryAfter = 0;
   const header = response?.headers.get('Retry-After');
   if (header) { const seconds = /^\d+(\.\d+)?$/.test(header) ? Number(header) : (Date.parse(header) - now()) / 1000; if (Number.isFinite(seconds)) retryAfter = Math.max(0, Math.min(60000, seconds * 1000)); }
   await sleep(Math.max(backoff, retryAfter), signal); check(generation, signal);
  }
 }
 const getSample = (sampleId: string, signal?: AbortSignal) => request<QCResult>(`/samples/${id(sampleId)}`, isQCResult, undefined, undefined, signal);
 const getRequest = (requestId: string, signal?: AbortSignal) => request<RequestState>(`/requests/${id(requestId)}`, isRequestState, undefined, undefined, signal);
 return {
  getStatus: (signal?: AbortSignal) => request<QCStatus>('/status', isQCStatus, undefined, undefined, signal),
  listPurchaseOrders: (signal?: AbortSignal) => request<{ items: PurchaseOrderItem[] }>('/purchase-orders', isPurchaseOrderList, undefined, undefined, signal),
  confirmSpec: (data: SpecInput, key: string, signal?: AbortSignal) => request<PurchaseSpec>('/specs', isPurchaseSpec, data, key, signal),
  getSpec: (specId: string, version: number, signal?: AbortSignal) => request<{ spec: PurchaseSpec; current: boolean; versions: number[] }>(`/specs/${id(specId)}?version=${version}`, isSpecResponse, undefined, undefined, signal),
  listConsentAuthorities: (signal?: AbortSignal) => request<{ items: ConsentAuthority[] }>('/consent-authorities', items(isConsentAuthority), undefined, undefined, signal),
  registerConsentAuthority: (data: Record<string, unknown>, key: string, signal?: AbortSignal) => request<ConsentAuthority>('/consent-authorities', isConsentAuthority, data, key, signal),
  createSelection: (data: SelectionInput, key: string, signal?: AbortSignal) => request<SamplingSelection>('/selections', isSamplingSelection, data, key, signal),
  createSample: (data: SampleInput, key: string, signal?: AbortSignal) => request<QCResult>('/samples', isQCResult, data, key, signal),
  listSamples: (purchaseOrderId: string, signal?: AbortSignal) => request<{ items: SampleSummary[] }>(`/samples?purchase_order_id=${id(purchaseOrderId)}`, isSampleList, undefined, undefined, signal),
  getSample,
  createCaptureSet: (sampleId: string, expectedRevision: number, key: string, signal?: AbortSignal) => request<QCResult>(`/samples/${id(sampleId)}/capture-sets`, isQCResult, { expected_revision: expectedRevision }, key, signal),
  uploadCapture: (setId: string, meta: CaptureMeta, original: Blob, key: string, signal?: AbortSignal) => { const body = new FormData(); body.set('meta', JSON.stringify(meta)); body.set('original', original, 'original'); return request<QCResult>(`/capture-sets/${id(setId)}/captures`, isQCResult, body, key, signal); },
  closeCaptureSet: (setId: string, expectedRevision: number, key: string, signal?: AbortSignal) => request<QCResult>(`/capture-sets/${id(setId)}/close`, isQCResult, { expected_revision: expectedRevision }, key, signal),
  async analyzeSample(sampleId: string, captureSetId: string, expectedRevision: number, key: string, signal?: AbortSignal): Promise<QCResult> {
   const generation = store.generation;
   const value = await request<QCResult | { request_id: string }>(`/samples/${id(sampleId)}/analyze`, v => isQCResult(v) || isProgress(v), { expected_revision: expectedRevision, capture_set_id: captureSetId }, key, signal);
   if (isQCResult(value)) return value;
   const deadline = now() + 60000;
   for (let polls = 0; polls < 60 && now() < deadline; polls++) {
    await sleep(1000, signal); check(generation, signal); const state = await getRequest(value.request_id, signal);
    if (state.state === 'COMPLETED' && state.result) return state.result;
    if (state.state !== 'IN_PROGRESS') throw new QCError(state.error?.code ?? 'UNKNOWN_OUTCOME', 0, state.state !== 'FAILED', state.error);
   }
   throw new QCError('UNKNOWN_OUTCOME', 0, true);
  },
  getRequest,
  getOriginal: (captureId: string, signal?: AbortSignal) => request<Blob>(`/captures/${id(captureId)}/original`, () => true, undefined, undefined, signal, true),
  adjudicate: (sampleId: string, data: AdjudicationInput, key: string, signal?: AbortSignal) => request<QCResult>(`/samples/${id(sampleId)}/adjudications`, isQCResult, data, key, signal),
  reauth: (data: { pin: string; payload_sha256: string }, key: string, signal?: AbortSignal) => request<{ proof: string; expires_at: string }>('/reauth', v => obj(v) && Object.keys(v).length === 2 && typeof v.proof === 'string' && typeof v.expires_at === 'string', data, key, signal),
  listReleases: (signal?: AbortSignal) => request<{ items: Release[]; active_release_id: string | null }>('/releases', v => obj(v) && Object.keys(v).length === 2 && Array.isArray(v.items) && v.items.every(isRelease) && (v.active_release_id === null || typeof v.active_release_id === 'string'), undefined, undefined, signal),
  registerRelease: (data: Record<string, unknown>, key: string, signal?: AbortSignal) => request<Release>('/releases', isRelease, data, key, signal),
  activateRelease: (releaseId: string, data: Record<string, unknown>, key: string, signal?: AbortSignal) => request<Release>(`/releases/${id(releaseId)}/activate`, isRelease, data, key, signal),
  suspendRelease: (releaseId: string, reason: string, key: string, signal?: AbortSignal) => request<Release>(`/releases/${id(releaseId)}/suspend`, isRelease, { reason }, key, signal),
 };
}
export type QCClient = ReturnType<typeof createQCClient>;
let shared: QCClient | null = null;
export const qcClient = () => shared ??= createQCClient();
export const analyzeSample = (sampleId: string, captureSetId: string, expectedRevision: number, key: string, signal: AbortSignal) => qcClient().analyzeSample(sampleId, captureSetId, expectedRevision, key, signal);
export async function clearQCDrafts(workspaceId: string): Promise<void> { qcDrafts().clear(workspaceId); }
