import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const useFabricLibrary = create<{
  savedIds: string[];
  toggleSaved: (id: string) => void;
}>()(
  persist(
    (set) => ({
      savedIds: [],
      toggleSaved: (id) =>
        set((state) => ({
          savedIds: state.savedIds.includes(id)
            ? state.savedIds.filter((saved) => saved !== id)
            : [...state.savedIds, id],
        })),
    }),
    { name: 'texpilot-fabric-library', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
