import { Platform } from 'react-native';

import { request } from './client';
import type { ScanResult } from './types';

export interface ScanRequest {
  /** Local URI of the fabric surface photo (file:// on device, data: on web). */
  surfaceImageUri: string;
  /**
   * Care-label text. Stop-gap until the server accepts `label_image` -- see
   * the docstring on POST /api/v1/scan in services/api/main.py.
   */
  labelText?: string;
}

/** POST /api/v1/scan */
export async function submitScan({ surfaceImageUri, labelText }: ScanRequest): Promise<ScanResult> {
  const form = new FormData();
  await appendImage(form, 'surface_image', surfaceImageUri, 'surface.jpg');
  if (labelText?.trim()) {
    form.append('label_text', labelText.trim());
  }
  return request<ScanResult>('/api/v1/scan', { method: 'POST', body: form, timeoutMs: 60_000 });
}

/** GET /health */
export function getHealth(): Promise<{ status: string }> {
  return request('/health', { timeoutMs: 5_000 });
}

async function appendImage(form: FormData, field: string, uri: string, name: string) {
  if (Platform.OS === 'web') {
    // On web the camera hands back a data: URI; the browser needs a real Blob.
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, name);
    return;
  }
  // React Native's FormData uploads a file from a { uri, name, type } descriptor.
  form.append(field, { uri, name, type: 'image/jpeg' } as unknown as Blob);
}
