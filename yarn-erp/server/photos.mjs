import { fail } from './erp-utils.mjs';

/** Reads one multipart photo upload: 11 MB stream cap, 10 MB file cap, JPEG/PNG/WebP by magic bytes. */
export async function readPhoto(request) {
  // Bound the whole multipart payload before parsing it, including chunked uploads.
  const reader = request.body?.getReader(); const chunks = []; let size = 0;
  if (!reader) fail(422, 'Choose a photo first.');
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 11 * 1024 * 1024) { await reader.cancel(); fail(413, 'Choose a photo smaller than 10 MB.'); }
    chunks.push(value);
  }
  const payload = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.length; }
  const form = await new Request(request.url, { method: 'POST', headers: { 'Content-Type': request.headers.get('Content-Type') || '' }, body: payload }).formData().catch(() => fail(422, 'The upload is not a valid photo form.'));
  const file = form.get('photo');
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) fail(422, 'Choose a JPEG, PNG or WebP photo up to 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const webp = new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  const type = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : null;
  if (!type) fail(422, 'Unsupported photo. Use JPEG, PNG or WebP; HEIC is not supported.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  return { form, bytes, type, digest };
}
