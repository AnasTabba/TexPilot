import { router } from 'expo-router';
import { View } from 'react-native';

import { FabricExperience } from '@/features/fabric-library';
import { WorkspaceTabs } from '@/features/inventory';
import { useApiHealth } from '@/hooks/useApiHealth';
import { useScanDraft } from '@/scanner';

export default function HomeScreen() {
  const health = useApiHealth();
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <FabricExperience
          health={health}
          onScan={() => {
            useScanDraft.getState().reset();
            router.push('/scan/surface');
          }}
          onHistory={() => router.push('/scan/history')}
        />
      </View>
      <WorkspaceTabs scan />
    </View>
  );
}
