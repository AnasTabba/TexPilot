import { useState } from 'react';

import { ApiError, submitScan } from '@/api';
import { useHistory } from '@/features/history';

import { useScanDraft } from './store';

type SubmitOutcome = { status: 'done'; scanId: string } | { status: 'failed' };

/** Sends the current draft to the API and records the result in history. */
export function useSubmitScan() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addScan = useHistory((s) => s.addScan);

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
      addScan(result);
      reset();
      return { status: 'done', scanId: result.scan_id };
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
    return 'Could not reach the TexPilot server. Check the API URL on the home screen.';
  }
  return 'Something went wrong while sending the scan.';
}
