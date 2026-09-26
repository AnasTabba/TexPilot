import { abstainResult, flagResult, passResult } from '@/scanner/testing';

import { summarize } from './summary';

describe('summarize', () => {
  test('counts each verdict', () => {
    const s = summarize([passResult, flagResult, abstainResult, abstainResult]);
    expect(s.total).toBe(4);
    expect(s.byVerdict).toEqual({ PASS: 1, FLAG: 1, INSUFFICIENT_EVIDENCE: 2 });
  });

  test('flag rate ignores abstentions', () => {
    expect(summarize([passResult, flagResult, abstainResult]).flagRate).toBe(0.5);
  });

  test('flag rate is null, not 0%, when nothing has been decided', () => {
    expect(summarize([abstainResult]).flagRate).toBeNull();
    expect(summarize([]).flagRate).toBeNull();
  });
});
