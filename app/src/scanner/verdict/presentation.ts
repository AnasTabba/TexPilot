import type { Verdict } from '../api';
import { colors } from '@/theme';

export interface VerdictPresentation {
  title: string;
  description: string;
  color: string;
  background: string;
}

/**
 * Copy and colour for each verdict.
 *
 * INSUFFICIENT_EVIDENCE is a normal, expected outcome (spec section 3), not an
 * error: it gets a neutral tone and tells the operator what to do next.
 */
const PRESENTATION: Record<Verdict, VerdictPresentation> = {
  PASS: {
    title: 'Consistent',
    description: 'What the fabric looks like matches what its label claims.',
    color: colors.pass,
    background: colors.passSoft,
  },
  FLAG: {
    title: 'Mismatch flagged',
    description: 'The fabric does not look like what its label claims. Inspect before accepting.',
    color: colors.flag,
    background: colors.flagSoft,
  },
  INSUFFICIENT_EVIDENCE: {
    title: 'Not enough evidence',
    description:
      'The scanner could not decide with confidence. Rescan in better light, or add the care label.',
    color: colors.abstain,
    background: colors.abstainSoft,
  },
};

export function presentVerdict(verdict: Verdict): VerdictPresentation {
  return PRESENTATION[verdict];
}

/** 0.913 -> "91%" */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** "yarn_dyed" -> "Yarn dyed" */
export function formatLabel(label: string): string {
  const words = label.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
