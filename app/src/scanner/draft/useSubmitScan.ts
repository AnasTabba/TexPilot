import { useState } from 'react';

import { ApiError, submitScan, type ScanResult } from '../api';
import { useScanDraft } from './store';

export type SubmitOutcome = { status: 'done'; result: ScanResult } | { status: 'failed' };

/**
 * Sends the current draft to the API. The result is handed back to the
 * caller: what to do with it (store it, navigate, post it to a host page) is
 * the host's decision, not the scanner's.
 */
export function useSubmitScan() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<SubmitOutcome> {
    const { surface, labelText, reset } = useScanDraft.getState();
    if (!surface) {
      setError('Take a photo of the fabric first.');
      return { status: 'failed' };
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await submitScan({ surfaceImageUri: surface.image.uri, labelText });
      reset();
      return { status: 'done', result };
    } catch (err) {
      // TODO(T5): a retryable failure (no network, timeout, 5xx) should go to
      // the offline queue instead of surfacing as an error.
      setError(describeError(err));
      return { status: 'failed' };
    } finally {
      setSubmitting(false);
    }
  }

  return { submit, submitting, error };
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'http') return `The server rejected the scan (HTTP ${err.status}).`;
    return 'Could not reach the TexPilot server. Check the API URL on the scanner home screen.';
  }
  return 'Something went wrong while sending the scan.';
}
