import { Slot } from 'expo-router';

import { DashboardShell } from '@/features/dashboard';

export default function DashboardLayout() {
  return (
    <DashboardShell>
      <Slot />
    </DashboardShell>
  );
}
