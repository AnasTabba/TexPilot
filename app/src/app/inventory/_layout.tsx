import { Slot } from 'expo-router';

import { InventoryShell } from '@/features/inventory';

export default function InventoryLayout() {
  return (
    <InventoryShell>
      <Slot />
    </InventoryShell>
  );
}
