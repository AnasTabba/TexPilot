/**
 * Incoming-QC capture drafts: the original photo files an operator has picked but not yet uploaded.
 *
 * Memory only (design §18). Nothing here touches localStorage, IndexedDB or Cache Storage, so a
 * reload loses the drafts and the screen warns about that. Limits: 4 originals, 12 MiB and 16 MP
 * each, 48 MiB together, previews at most 1 MiB. Drafts expire 24 h after the first photo even
 * while the tab stays open. Every blob URL this module creates is revoked on replace, remove,
 * expiry, purge and sign-out. A session generation number changes whenever the signed-in person or
 * workspace changes (in this tab or, through BroadcastChannel, another tab); work started under an
 * older generation must be dropped by its caller.
 */
import { LIMITS, type AcquisitionAttestation, type CaptureRole, type MediaType } from './qc-types.ts';

export type DraftProblem = 'TOO_MANY' | 'TOO_LARGE' | 'SET_TOO_LARGE' | 'TOO_MANY_PIXELS' | 'UNSUPPORTED_MEDIA' | 'HEIC' | 'UNREADABLE' | 'EXPIRED' | 'PREVIEW_TOO_LARGE';
export class DraftError extends Error {
  code: DraftProblem;
  constructor(code: DraftProblem) { super(code); this.code = code; }
}
export interface DraftOriginal {
  /** The capture ID sent to the server; stable across retries. */
  id: string; role: CaptureRole;
  /** The untouched file as picked. Never re-encoded, resized or drawn to a canvas. */
  file: Blob; byteSize: number; sha256: string; mediaType: MediaType; width: number; height: number;
  attestation: AcquisitionAttestation; takenAt: string;
  /** Idempotency key for this file's upload; stable across retries. */
  uploadKey: string;
  preview: Blob | null; previewUrl: string | null; addedAt: number;
}
export type DraftInput = Omit<DraftOriginal, 'previewUrl' | 'addedAt'>;
export interface Identity { actorId: string; workspaceId: string }
export interface ChannelLike { postMessage(message: unknown): void; close(): void; onmessage: ((event: { data: unknown }) => void) | null }
export interface DraftEnvironment {
  now: () => number;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  channel: ChannelLike | null;
}
export type PurgeCause = 'expired' | 'signed-out' | 'identity-changed' | 'other-tab' | 'cleared';
const CHANNEL = 'yf-qc-session';
// One timer can wait at most 2^31-1 ms; 24 h fits, but a clamped re-check keeps a slept tab honest.
const TICK = 60_000;

function browserEnvironment(): DraftEnvironment {
  let channel: ChannelLike | null = null;
  try { if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel(CHANNEL) as unknown as ChannelLike; } catch { channel = null; }
  return {
    now: () => Date.now(), createObjectURL: blob => URL.createObjectURL(blob), revokeObjectURL: url => URL.revokeObjectURL(url),
    setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>), channel,
  };
}

export class QCDraftStore {
  private env: DraftEnvironment;
  private items: DraftOriginal[] = [];
  private createdAt: number | null = null;
  private timer: unknown = null;
  private who: Identity | null = null;
  private listeners = new Set<(cause: PurgeCause | 'changed') => void>();
  private tab = Math.random().toString(36).slice(2);
  /** Bumped on every identity change or invalidation. Compare before applying or sending anything. */
  generation = 0;

  constructor(env: DraftEnvironment = browserEnvironment()) {
    this.env = env;
    if (env.channel) env.channel.onmessage = event => {
      const data = event.data as { type?: string; tab?: string } | null;
      if (data?.type === 'invalidate' && data.tab !== this.tab) { this.who = null; this.generation++; this.drop('other-tab'); }
    };
  }
  get identity(): Identity | null { return this.who ? { ...this.who } : null; }
  subscribe(listener: (cause: PurgeCause | 'changed') => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Called when a person is signed in. A different person or workspace purges everything first. */
  begin(identity: Identity): number {
    if (this.who && this.who.actorId === identity.actorId && this.who.workspaceId === identity.workspaceId) return this.generation;
    const changed = this.who !== null;
    this.who = { ...identity }; this.generation++;
    if (changed || this.items.length) this.drop('identity-changed');
    if (changed) { try { this.env.channel?.postMessage({ type: 'invalidate', tab: this.tab }); } catch { /* Local invalidation still holds. */ } }
    return this.generation;
  }
  /** Sign-out, a 401 or a workspace switch: purge here and tell every other tab to do the same. */
  invalidate(cause: PurgeCause = 'signed-out'): void {
    this.who = null; this.generation++;
    this.drop(cause);
    try { this.env.channel?.postMessage({ type: 'invalidate', tab: this.tab }); } catch { /* Other tabs still purge on their own 401. */ }
  }
  /** Removes the drafts of one workspace (plan T07 `clearQCDrafts`). */
  clear(workspaceId?: string): void { if (!workspaceId || !this.who || this.who.workspaceId === workspaceId) { this.generation++; this.drop('cleared'); } }

  list(): readonly DraftOriginal[] { this.expire(); return this.items; }
  totalBytes(): number { return this.items.reduce((sum, item) => sum + item.byteSize, 0); }
  expiresAt(): number | null { return this.createdAt === null ? null : this.createdAt + LIMITS.draftLifetimeMs; }
  isExpired(): boolean { const at = this.expiresAt(); return at !== null && this.env.now() >= at; }

  /** Adds one original, replacing any draft already held for the same role. Throws DraftError on any limit. */
  add(input: DraftInput): DraftOriginal {
    if (this.expire() || !this.who) throw new DraftError('EXPIRED');
    if (!['overview', 'structure', 'scale', 'defect'].includes(input.role)) throw new DraftError('UNREADABLE');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.mediaType)) throw new DraftError('UNSUPPORTED_MEDIA');
    if (input.byteSize !== input.file.size || input.byteSize < 1) throw new DraftError('UNREADABLE');
    if (input.byteSize > LIMITS.maxOriginalBytes) throw new DraftError('TOO_LARGE');
    if (!(Number.isInteger(input.width) && Number.isInteger(input.height) && input.width >= 1 && input.height >= 1)) throw new DraftError('UNREADABLE');
    if (input.width * input.height > LIMITS.maxDecodedPixels) throw new DraftError('TOO_MANY_PIXELS');
    const others = this.items.filter(item => item.role !== input.role);
    if (others.length >= LIMITS.maxOriginalsPerSet) throw new DraftError('TOO_MANY');
    if (others.reduce((sum, item) => sum + item.byteSize, 0) + input.byteSize > LIMITS.maxSetBytes) throw new DraftError('SET_TOO_LARGE');
    // An oversized preview is dropped, never the original: the photo is still listed by name and size.
    const preview = input.preview && input.preview.size <= LIMITS.maxPreviewBytes ? input.preview : null;
    for (const old of this.items.filter(item => item.role === input.role)) this.release(old);
    const item: DraftOriginal = { ...input, preview, previewUrl: preview ? this.env.createObjectURL(preview) : null, addedAt: this.env.now() };
    this.items = [...others, item];
    if (this.createdAt === null) { this.createdAt = item.addedAt; this.schedule(); }
    this.emit('changed');
    return item;
  }
  remove(id: string): void {
    const found = this.items.find(item => item.id === id);
    if (!found) return;
    this.release(found); this.items = this.items.filter(item => item.id !== id);
    if (!this.items.length) this.reset();
    this.emit('changed');
  }
  /** The originals that may be uploaded now, for this generation. Throws when expired or the session moved on. */
  uploadable(generation: number): readonly DraftOriginal[] {
    if (generation !== this.generation || !this.who) throw new DraftError('EXPIRED');
    if (this.expire()) throw new DraftError('EXPIRED');
    return this.items;
  }
  /** Releases every resource; call when the screen unmounts for good (sign-out path uses invalidate). */
  dispose(): void { this.generation++; this.drop('cleared'); }

  private expire(): boolean { if (!this.isExpired()) return false; this.generation++; this.drop('expired'); return true; }
  private release(item: DraftOriginal): void { if (item.previewUrl) { try { this.env.revokeObjectURL(item.previewUrl); } catch { /* Already gone. */ } item.previewUrl = null; } }
  private reset(): void { if (this.timer !== null) this.env.clearTimeout(this.timer); this.timer = null; this.createdAt = null; }
  private schedule(): void {
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    const at = this.expiresAt(); if (at === null) return;
    this.timer = this.env.setTimeout(() => { this.timer = null; if (!this.expire()) this.schedule(); }, Math.max(0, Math.min(TICK, at - this.env.now())));
  }
  private drop(cause: PurgeCause): void {
    const had = this.items.length > 0;
    for (const item of this.items) this.release(item);
    this.items = []; this.reset();
    if (had || cause !== 'cleared') this.emit(cause);
  }
  private emit(cause: PurgeCause | 'changed'): void { for (const listener of [...this.listeners]) listener(cause); }
}

let shared: QCDraftStore | null = null;
/** The one store for this tab. */
export function qcDrafts(): QCDraftStore { return shared ??= new QCDraftStore(); }

// ------------------------------------------------------------------ reading a picked file without altering it
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
/** The media type by signature, 'heic' for HEIC/HEIF/AVIF, or null. File extensions and the browser's type are not trusted. */
export function sniffMedia(bytes: Uint8Array): MediaType | 'heic' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'heif', 'avif'].includes(ascii(bytes, 8, 12))) return 'heic';
  return null;
}
/** Stored pixel size and EXIF orientation read from the header, so an oversized photo is refused before any decode. Null when unreadable. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; orientation: number | null } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kind = sniffMedia(bytes);
  try {
    if (kind === 'image/png') {
      if (ascii(bytes, 12, 16) !== 'IHDR') return null;
      return positive(view.getUint32(16), view.getUint32(20), null);
    }
    if (kind === 'image/webp') {
      // Animated WebP is refused: only single-frame originals are evidence.
      const chunk = ascii(bytes, 12, 16);
      if (chunk === 'VP8 ') return positive(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff, null);
      if (chunk === 'VP8L') { const bits = view.getUint32(21, true); return positive((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, null); }
      if (chunk === 'VP8X') {
        if (bytes[20] & 0x02) return null;
        return positive(1 + (bytes[24] | bytes[25] << 8 | bytes[26] << 16), 1 + (bytes[27] | bytes[28] << 8 | bytes[29] << 16), null);
      }
      return null;
    }
    if (kind === 'image/jpeg') {
      let at = 2, orientation: number | null = null;
      while (at + 4 <= bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff) { at++; continue; }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { at += 2; continue; }
        const length = view.getUint16(at + 2);
        if (length < 2) return null;
        if (marker === 0xe1 && orientation === null && ascii(bytes, at + 4, at + 10) === 'Exif\0\0') orientation = exifOrientation(view, at + 10, at + 2 + length);
        const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
        if (sof) return positive(view.getUint16(at + 7), view.getUint16(at + 5), orientation);
        if (marker === 0xda) return null;
        at += 2 + length;
      }
    }
  } catch { return null; }
  return null;
}
const positive = (width: number, height: number, orientation: number | null) => width >= 1 && height >= 1 ? { width, height, orientation } : null;
function exifOrientation(view: DataView, start: number, end: number): number | null {
  const little = view.getUint16(start) === 0x4949;
  if (view.getUint16(start + 2, little) !== 42) return null;
  const ifd = start + view.getUint32(start + 4, little), count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) { const value = view.getUint16(entry + 8, little); return value >= 1 && value <= 8 ? value : null; }
  }
  return null;
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
const utcNow = (ms: number) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, '.$1Z');

/**
 * Reads one picked file into a draft input. The file itself is kept byte for byte; only its header is
 * parsed. What a web page cannot observe about the camera is recorded as null, and a picked file is
 * honestly an IMPORTED capture: the browser cannot prove it came straight from the camera.
 */
export async function readOriginal(file: Blob, role: CaptureRole, options: { now?: number; mode?: 'IMPORTED' | 'WEB_CAMERA'; observed?: Partial<AcquisitionAttestation>; lastModified?: number } = {}): Promise<Omit<DraftInput, 'preview'>> {
  if (file.size < 1) throw new DraftError('UNREADABLE');
  if (file.size > LIMITS.maxOriginalBytes) throw new DraftError('TOO_LARGE');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffMedia(bytes);
  if (kind === 'heic') throw new DraftError('HEIC');
  if (!kind) throw new DraftError('UNSUPPORTED_MEDIA');
  const size = imageSize(bytes);
  if (!size) throw new DraftError('UNREADABLE');
  if (size.width * size.height > LIMITS.maxDecodedPixels) throw new DraftError('TOO_MANY_PIXELS');
  const now = options.now ?? Date.now(), taken = utcNow(Math.min(now, options.lastModified && options.lastModified > 0 ? options.lastModified : now));
  const sha256 = await sha256Hex(bytes);
  const attestation: AcquisitionAttestation = {
    image_sha256: sha256, capture_mode: options.mode ?? 'IMPORTED', device_model: null, lens_id: null, zoom_factor: null, focus_mode: null,
    exposure_mode: null, resolution: [size.width, size.height], orientation: size.orientation, processing: null, captured_at: taken, ...options.observed,
  };
  attestation.image_sha256 = sha256;
  return { id: crypto.randomUUID(), role, file, byteSize: file.size, sha256, mediaType: kind, width: size.width, height: size.height, attestation, takenAt: taken, uploadKey: crypto.randomUUID() };
}
