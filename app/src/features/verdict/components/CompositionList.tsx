import { StyleSheet, View } from 'react-native';

import type { StatedComposition } from '@/api';
import { Card, Text } from '@/components/ui';
import { spacing } from '@/theme';

import { formatLabel } from '../presentation';

export function CompositionList({ composition }: { composition: StatedComposition }) {
  return (
    <Card title="What the label claims">
      {composition.fibers.length === 0 ? (
        <Text muted>No composition read from the label.</Text>
      ) : (
        composition.fibers.map((fiber) => (
          <View key={fiber.name} style={styles.row}>
            <Text>{formatLabel(fiber.name)}</Text>
            <Text>{fiber.pct}%</Text>
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
