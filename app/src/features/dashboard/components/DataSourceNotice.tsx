import { Card, Text } from '@/components/ui';

import type { ScanSource } from '../useDashboardScans';

/** Tells the supervisor whose scans they are looking at. Never leave this implicit. */
export function DataSourceNotice({ source }: { source: ScanSource }) {
  if (source === 'server') return null;
  return (
    <Card>
      <Text muted>
        Showing scans made in this browser only. A shared view of every operator’s scans needs the
        server to store scans first (T14).
      </Text>
    </Card>
  );
}
