import { create } from 'zustand';

import type { CapturedImage, QualityReport } from '@/features/capture';

/**
 * The scan being put together across the capture screens. In-memory only:
 * a half-finished scan is not worth persisting.
 */
interface ScanDraftState {
  surface: { image: CapturedImage; quality: QualityReport } | null;
  labelText: string;
  setSurface: (image: CapturedImage, quality: QualityReport) => void;
  setLabelText: (text: string) => void;
  reset: () => void;
}

const initial = { surface: null, labelText: '' };

export const useScanDraft = create<ScanDraftState>()((set) => ({
  ...initial,
  setSurface: (image, quality) => set({ surface: { image, quality } }),
  setLabelText: (labelText) => set({ labelText }),
  reset: () => set(initial),
}));
