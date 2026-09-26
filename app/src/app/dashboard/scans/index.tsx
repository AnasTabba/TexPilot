import { router } from 'expo-router';

import {
  DashboardPage,
  DataSourceNotice,
  ScanTable,
  useDashboardScans,
} from '@/features/dashboard';

export default function DashboardScans() {
  const { scans, source } = useDashboardScans();

  return (
    <DashboardPage title="Scans" description="Newest first. Open a scan to see its evidence.">
      <DataSourceNotice source={source} />
      <ScanTable
        scans={scans}
        onSelect={(scan) =>
          router.push({ pathname: '/dashboard/scans/[scanId]', params: { scanId: scan.scan_id } })
        }
      />
    </DashboardPage>
  );
}
