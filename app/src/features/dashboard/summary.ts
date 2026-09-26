import type { ScanResult, Verdict } from '@/scanner';

export interface ScanSummary {
  total: number;
  byVerdict: Record<Verdict, number>;
  /**
   * Share of *decided* scans (PASS + FLAG) that were flagged. Abstentions are
   * excluded: counting them would make the flag rate look lower than it is.
   * null when nothing has been decided yet.
   */
  flagRate: number | null;
}

export function summarize(scans: readonly ScanResult[]): ScanSummary {
  const byVerdict: Record<Verdict, number> = { PASS: 0, FLAG: 0, INSUFFICIENT_EVIDENCE: 0 };
  for (const scan of scans) byVerdict[scan.verdict] += 1;

  const decided = byVerdict.PASS + byVerdict.FLAG;
  return {
    total: scans.length,
    byVerdict,
    flagRate: decided === 0 ? null : byVerdict.FLAG / decided,
  };
}
