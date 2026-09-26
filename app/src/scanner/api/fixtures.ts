/**
 * Sample ScanResults, one per verdict. Use them in tests and to build UI
 * without a running backend. The abstain case is exactly what the real API
 * returns today, before a trained model lands.
 */

import type { ScanResult } from './types';

const base = {
  capture_quality: {},
  model_version: 'fixture-0',
  kb_version: '1',
  timestamp: '2026-09-26T09:00:00Z',
} satisfies Partial<ScanResult>;

export const passResult: ScanResult = {
  ...base,
  scan_id: 'fixture-pass',
  verdict: 'PASS',
  structure: { label: 'denim', confidence: 0.91, topk: [['denim', 0.91]] },
  treatment: { label: 'yarn_dyed', confidence: 0.84, topk: [] },
  fibre_family: { label: 'cellulosic', confidence: 0.88, topk: [] },
  stated_composition: {
    source: 'care_label',
    fibers: [
      { name: 'cotton', pct: 98 },
      { name: 'elastane', pct: 2 },
    ],
  },
  flags: [],
};

export const flagResult: ScanResult = {
  ...base,
  scan_id: 'fixture-flag',
  verdict: 'FLAG',
  structure: { label: 'tweed', confidence: 0.87, topk: [] },
  treatment: null,
  fibre_family: { label: 'protein', confidence: 0.81, topk: [] },
  stated_composition: { source: 'care_label', fibers: [{ name: 'polyester', pct: 100 }] },
  flags: [
    {
      code: 'COMPOSITION_IMPLAUSIBLE',
      message: 'Tweed is a wool structure; label states 100% polyester.',
      severity: 'high',
    },
  ],
};

export const abstainResult: ScanResult = {
  ...base,
  scan_id: 'fixture-abstain',
  verdict: 'INSUFFICIENT_EVIDENCE',
  structure: null,
  treatment: null,
  fibre_family: null,
  stated_composition: {
    source: 'care_label',
    fibers: [
      { name: 'cotton', pct: 60 },
      { name: 'polyester', pct: 40 },
    ],
  },
  flags: [],
};
