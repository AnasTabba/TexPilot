import { useLocalSearchParams } from 'expo-router';

import { Text } from '@/components/ui';
import { DashboardPage } from '@/features/dashboard';
import { useScan } from '@/features/history';
import { ScanResultView } from '@/scanner';

export default function DashboardScanDetail() {
  const { scanId } = useLocalSearchParams<{ scanId: string }>();
  const scan = useScan(scanId);

  return (
    <DashboardPage title="Scan">
      {scan ? <ScanResultView result={scan} /> : <Text>Scan {scanId} is not available here.</Text>}
    </DashboardPage>
  );
}
