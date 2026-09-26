import { useHistory } from '@/features/history';
import type { ScanResult } from '@/scanner';

export type ScanSource = 'this-browser' | 'server';

export interface DashboardScans {
  scans: ScanResult[];
  /** Where the data came from, so the UI can say so. */
  source: ScanSource;
}

/**
 * The scans a supervisor sees.
 *
 * TODO(T14): read from the server once P2 persists scans (spec section 9) and
 * exposes a list endpoint. Until then, only scans made in this browser are
 * visible, and the dashboard says so.
 */
export function useDashboardScans(): DashboardScans {
  const scans = useHistory((s) => s.scans);
  return { scans, source: 'this-browser' };
}
