import { router, useLocalSearchParams } from 'expo-router';

import { Button, Screen, Text } from '@/components/ui';
import { useScan } from '@/features/history';
import { ScanResultView, useScanDraft } from '@/scanner';

export default function ResultScreen() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  const scan = useScan(scanId);

  function newScan() {
    useScanDraft.getState().reset();
    router.replace('/scan/surface');
  }

  if (!scan) {
    return (
      <Screen>
        <Text>Scan {scanId} is not on this device.</Text>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title="Scan another" onPress={newScan} />}>
      <ScanResultView result={scan} />
    </Screen>
  );
}
