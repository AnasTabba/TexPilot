import type { Verdict } from '../api';
import { colors } from '@/theme';

import { formatConfidence, formatLabel, presentVerdict } from './presentation';

describe('presentVerdict', () => {
  test.each<Verdict>(['PASS', 'FLAG', 'INSUFFICIENT_EVIDENCE'])('%s has copy', (verdict) => {
    const p = presentVerdict(verdict);
    expect(p.title).not.toHaveLength(0);
    expect(p.description).not.toHaveLength(0);
  });

  test('abstaining is not styled as an error', () => {
    expect(presentVerdict('INSUFFICIENT_EVIDENCE').color).not.toBe(colors.danger);
    expect(presentVerdict('INSUFFICIENT_EVIDENCE').color).not.toBe(colors.flag);
  });
});

describe('formatters', () => {
  test('formatConfidence rounds to a whole percent', () => {
    expect(formatConfidence(0.913)).toBe('91%');
    expect(formatConfidence(1)).toBe('100%');
  });

  test('formatLabel humanises snake_case labels', () => {
    expect(formatLabel('yarn_dyed')).toBe('Yarn dyed');
    expect(formatLabel('denim')).toBe('Denim');
  });
});
