/**
 * On-device capture-quality gate (spec sections 4.4 and 7).
 *
 * A capture that fails is rejected here and the operator re-shoots. It is never
 * uploaded. This is the cheapest accuracy win in the project: it removes the
 * worst inputs from the model's distribution entirely.
 *
 * STATUS: stub. Every capture passes with `checked: false`. The real checks
 * (blur via variance of Laplacian, exposure, framing) are task T2 in
 * app/README.md -- implement them behind this same signature.
 */

import type { CaptureQuality } from '../api';

export interface QualityReport {
  passed: boolean;
  /** False until the real checks exist, so no caller mistakes the stub for a verdict. */
  checked: boolean;
  /** Operator-facing reasons for a rejection, e.g. "Too blurry -- hold the phone still." */
  reasons: string[];
  /** Raw metrics, in the wire contract's shape so they can be sent with the scan later. */
  metrics: CaptureQuality;
}

export interface CapturedImage {
  uri: string;
  width: number;
  height: number;
}

export async function assessCapture(_image: CapturedImage): Promise<QualityReport> {
  return {
    passed: true,
    checked: false,
    reasons: [],
    metrics: { blur: null, exposure: null, framing: null },
  };
}
