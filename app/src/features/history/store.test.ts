import { abstainResult, flagResult, passResult } from '@/scanner/testing';

import { loadSampleScans } from './samples';
import { useHistory } from './store';

beforeEach(() => useHistory.getState().clear());

describe('history store', () => {
  test('keeps the newest scan first', () => {
    useHistory.getState().addScan(passResult);
    useHistory.getState().addScan(flagResult);
    expect(useHistory.getState().scans.map((s) => s.scan_id)).toEqual([
      flagResult.scan_id,
      passResult.scan_id,
    ]);
  });

  test('re-adding a scan replaces it rather than duplicating it', () => {
    useHistory.getState().addScan(abstainResult);
    useHistory.getState().addScan(passResult);
    useHistory.getState().addScan(abstainResult);
    expect(useHistory.getState().scans).toHaveLength(2);
    expect(useHistory.getState().scans[0]?.scan_id).toBe(abstainResult.scan_id);
  });

  test('loadSampleScans adds one scan per verdict', () => {
    loadSampleScans();
    expect(
      useHistory
        .getState()
        .scans.map((s) => s.verdict)
        .sort(),
    ).toEqual(['FLAG', 'INSUFFICIENT_EVIDENCE', 'PASS']);
  });
});
