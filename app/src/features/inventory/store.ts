import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  materials,
  movementError,
  sampleMovements,
  type Material,
  type Movement,
  type MovementInput,
} from './model';

interface InventoryState {
  materials: Material[];
  movements: Movement[];
  warehouse: string;
  setWarehouse: (warehouse: string) => void;
  recordMovement: (input: MovementInput) => { ok: true } | { ok: false; error: string };
}
export const useInventory = create<InventoryState>()(
  persist(
    (set, get) => ({
      materials: materials.map((item) => ({ ...item })),
      movements: [...sampleMovements],
      warehouse: 'All stores',
      setWarehouse: (warehouse) => set({ warehouse }),
      recordMovement: (input) => {
        const error = movementError(get().materials, input);
        if (error) return { ok: false, error };
        const item = get().materials.find((material) => material.id === input.materialId)!;
        const sign = input.kind === 'received' ? 1 : -1;
        const movement: Movement = {
          ...input,
          reference: input.reference.trim(),
          note: input.note.trim(),
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: item.name,
          at: new Date().toISOString(),
          sample: false,
        };
        set((state) => ({
          materials: state.materials.map((material) =>
            material.id === item.id
              ? {
                  ...material,
                  metres: Math.round((material.metres + sign * input.metres) * 10) / 10,
                  rolls: material.rolls + sign * input.rolls,
                }
              : material,
          ),
          movements: [movement, ...state.movements],
        }));
        return { ok: true };
      },
    }),
    { name: 'texpilot.inventory.demo.v1', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
