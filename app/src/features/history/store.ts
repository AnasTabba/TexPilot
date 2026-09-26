import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ScanResult } from '@/scanner';

/**
 * Scan results this device has received, newest first, persisted across
 * restarts. Stores the server's result only -- images are not kept yet
 * (camera URIs are temporary; see T6 in app/README.md).
 */
interface HistoryState {
  scans: ScanResult[];
  addScan: (result: ScanResult) => void;
  clear: () => void;
}

const MAX_SCANS = 200;

export const useHistory = create<HistoryState>()(
  persist(
    (set) => ({
      scans: [],
      addScan: (result) =>
        set((state) => ({
          scans: [result, ...state.scans.filter((s) => s.scan_id !== result.scan_id)].slice(
            0,
            MAX_SCANS,
          ),
        })),
      clear: () => set({ scans: [] }),
    }),
    {
      name: 'texpilot.history',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export function useScan(scanId: string | undefined): ScanResult | undefined {
  return useHistory((state) => state.scans.find((s) => s.scan_id === scanId));
}
