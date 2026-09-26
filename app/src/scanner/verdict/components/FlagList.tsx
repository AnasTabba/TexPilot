import { StyleSheet, View } from 'react-native';

import type { Flag } from '../../api';
import { Card, Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

export function FlagList({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return (
    <Card title="Why it was flagged">
      {flags.map((flag) => (
        <View key={flag.code} style={styles.flag}>
          <Text variant="caption" style={{ color: colors.flag }}>
            {flag.code} · {flag.severity}
          </Text>
          <Text>{flag.message}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  flag: { gap: spacing.xs },
});
