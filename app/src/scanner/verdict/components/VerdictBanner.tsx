import { StyleSheet, View } from 'react-native';

import type { Verdict } from '../../api';
import { Text } from '@/components/ui';
import { radius, spacing } from '@/theme';

import { presentVerdict } from '../presentation';

export function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const p = presentVerdict(verdict);
  return (
    <View
      accessibilityRole="summary"
      style={[styles.banner, { backgroundColor: p.background, borderColor: p.color }]}
    >
      <Text variant="title" style={{ color: p.color }}>
        {p.title}
      </Text>
      <Text>{p.description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
});
