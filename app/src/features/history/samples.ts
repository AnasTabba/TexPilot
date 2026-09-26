import { abstainResult, flagResult, passResult } from '@/scanner/testing';

import { useHistory } from './store';

/**
 * Dev only: puts one scan of each verdict into history. The real API abstains
 * on everything until a model lands, so this is the only way to see (and
 * design) the PASS and FLAG result screens on a device.
 */
export function loadSampleScans() {
  const { addScan } = useHistory.getState();
  [abstainResult, flagResult, passResult].forEach(addScan);
}
