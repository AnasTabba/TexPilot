import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius, spacing } from '@/theme';

import type { Verdict } from '../../api';
import { presentVerdict } from '../presentation';

/** Compact verdict label for lists and tables. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const p = presentVerdict(verdict);
  return (
    <View style={[styles.badge, { backgroundColor: p.background, borderColor: p.color }]}>
      <Text variant="caption" style={{ color: p.color }}>
        {p.title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});
