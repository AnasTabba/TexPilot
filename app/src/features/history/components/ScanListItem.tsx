import { Pressable, StyleSheet, View } from 'react-native';

import type { ScanResult } from '@/scanner';
import { Text } from '@/components/ui';
import { presentVerdict } from '@/scanner';
import { colors, radius, spacing } from '@/theme';

export function ScanListItem({ scan, onPress }: { scan: ScanResult; onPress: () => void }) {
  const p = presentVerdict(scan.verdict);
  const when = scan.timestamp ? new Date(scan.timestamp).toLocaleString() : 'Unknown time';

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.item}>
      <View style={[styles.dot, { backgroundColor: p.color }]} />
      <View style={styles.body}>
        <Text variant="heading">{p.title}</Text>
        <Text variant="caption" muted>
          {when}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  body: { flex: 1, gap: spacing.xs },
});
