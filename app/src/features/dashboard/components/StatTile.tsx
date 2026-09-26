import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export interface StatTileProps {
  label: string;
  value: string;
  /** Optional accent, e.g. a verdict colour. */
  color?: string;
}

export function StatTile({ label, value, color = colors.text }: StatTileProps) {
  return (
    <View style={styles.tile}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text variant="title" style={{ color }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexGrow: 1,
    flexBasis: 180,
    gap: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
