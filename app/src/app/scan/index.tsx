import { router } from 'expo-router';

import { FabricExperience } from '@/features/fabric-library';
import { useApiHealth } from '@/hooks/useApiHealth';
import { useScanDraft } from '@/scanner';

export default function HomeScreen() {
  const health = useApiHealth();
  return (
    <FabricExperience
      health={health}
      onScan={() => {
        useScanDraft.getState().reset();
        router.push('/scan/surface');
      }}
      onHistory={() => router.push('/scan/history')}
    />
  );
}
