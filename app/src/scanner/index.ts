/**
 * The TexPilot scanner: everything needed to capture a fabric, send it to the
 * API and show the verdict. This is the public surface of the module. Code
 * outside src/scanner imports from here (or '@/scanner/testing'), never from
 * files inside it. See README.md in this folder for why.
 */

// Setup
export { configureScanner, getScannerConfig, type ScannerConfig } from './config';

// API
export { ApiError, getHealth, submitScan, type ApiErrorKind, type ScanRequest } from './api';
export type * from './api/types';

// Capture
export { CaptureCamera, type CaptureCameraProps } from './capture/components/CaptureCamera';
export { assessCapture, type CapturedImage, type QualityReport } from './capture/quality';

// The scan being assembled, and sending it
export { useScanDraft } from './draft/store';
export { useSubmitScan, type SubmitOutcome } from './draft/useSubmitScan';

// Showing a result
export { ScanResultView } from './verdict/components/ScanResultView';
export { VerdictBadge } from './verdict/components/VerdictBadge';
export { VerdictBanner } from './verdict/components/VerdictBanner';
export { formatConfidence, formatLabel, presentVerdict } from './verdict/presentation';

// Offline queue (contract only -- T5)
export type { QueuedScan } from './queue/types';
