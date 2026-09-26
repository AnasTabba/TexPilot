import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { formatLabel, VerdictBadge, type ScanResult } from '@/scanner';
import { colors, radius, spacing } from '@/theme';

export interface ScanTableProps {
  scans: ScanResult[];
  onSelect: (scan: ScanResult) => void;
}

/** Scans as table rows on wide screens, stacked cards on narrow ones. */
export function ScanTable({ scans, onSelect }: ScanTableProps) {
  const stacked = useBreakpoint() === 'compact';

  if (scans.length === 0) {
    return <Text muted>No scans yet.</Text>;
  }

  return (
    <View style={styles.table}>
      {stacked ? null : (
        <View style={[styles.row, styles.headerRow]}>
          <Cell header>When</Cell>
          <Cell header>Verdict</Cell>
          <Cell header>Structure</Cell>
          <Cell header>Label says</Cell>
        </View>
      )}
      {scans.map((scan) => (
        <Pressable
          key={scan.scan_id}
          accessibilityRole="button"
          accessibilityLabel={`Open scan ${scan.scan_id}`}
          onPress={() => onSelect(scan)}
          style={({ pressed }) => [
            stacked ? styles.card : styles.row,
            pressed && { backgroundColor: colors.background },
          ]}
        >
          <Cell>{scan.timestamp ? new Date(scan.timestamp).toLocaleString() : '—'}</Cell>
          <View style={styles.cell}>
            <VerdictBadge verdict={scan.verdict} />
          </View>
          <Cell>{scan.structure ? formatLabel(scan.structure.label) : 'Not determined'}</Cell>
          <Cell>{describeComposition(scan)}</Cell>
        </Pressable>
      ))}
    </View>
  );
}

function Cell({ children, header = false }: { children: string; header?: boolean }) {
  return (
    <View style={styles.cell}>
      <Text variant={header ? 'caption' : 'body'} muted={header}>
        {children}
      </Text>
    </View>
  );
}

function describeComposition(scan: ScanResult): string {
  const fibers = scan.stated_composition.fibers;
  if (fibers.length === 0) return 'No label';
  return fibers.map((f) => `${f.pct}% ${formatLabel(f.name)}`).join(', ');
}

const styles = StyleSheet.create({
  table: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: { backgroundColor: colors.background },
  card: {
    padding: spacing.sm,
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cell: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
