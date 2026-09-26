import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import {
  DashboardPage,
  DataSourceNotice,
  StatTile,
  summarize,
  useDashboardScans,
} from '@/features/dashboard';
import { formatConfidence } from '@/scanner';
import { colors, spacing } from '@/theme';

export default function DashboardOverview() {
  const { scans, source } = useDashboardScans();
  const s = summarize(scans);

  return (
    <DashboardPage title="Overview" description="Goods-in fabric verification at a glance.">
      <DataSourceNotice source={source} />
      <View style={styles.tiles}>
        <StatTile label="Scans" value={String(s.total)} />
        <StatTile label="Consistent" value={String(s.byVerdict.PASS)} color={colors.pass} />
        <StatTile label="Flagged" value={String(s.byVerdict.FLAG)} color={colors.flag} />
        <StatTile
          label="Not enough evidence"
          value={String(s.byVerdict.INSUFFICIENT_EVIDENCE)}
          color={colors.abstain}
        />
        <StatTile
          label="Flag rate (decided scans)"
          value={s.flagRate === null ? '—' : formatConfidence(s.flagRate)}
        />
      </View>
      <View style={styles.actions}>
        <Link href="/dashboard/scans" asChild>
          <Button title="Review scans" />
        </Link>
      </View>
    </DashboardPage>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  actions: { flexDirection: 'row' },
});
