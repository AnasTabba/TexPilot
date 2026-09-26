import { StyleSheet, View } from 'react-native';

import type { HeadPrediction, ScanResult } from '@/api';
import { Card, Text } from '@/components/ui';
import { spacing } from '@/theme';

import { formatConfidence, formatLabel } from '../presentation';

const HEADS = [
  ['structure', 'Structure'],
  ['treatment', 'Surface treatment'],
  ['fibre_family', 'Fibre family'],
] as const;

/**
 * The three vision heads. A null head means the model declined to answer --
 * show that plainly rather than hiding the row.
 */
export function PredictionList({ result }: { result: ScanResult }) {
  return (
    <Card title="What it looks like">
      {HEADS.map(([key, label]) => (
        <Row key={key} label={label} prediction={result[key]} />
      ))}
    </Card>
  );
}

function Row({ label, prediction }: { label: string; prediction?: HeadPrediction | null }) {
  return (
    <View style={styles.row}>
      <Text muted>{label}</Text>
      {prediction ? (
        <Text>
          {formatLabel(prediction.label)}{' '}
          <Text muted>({formatConfidence(prediction.confidence)})</Text>
        </Text>
      ) : (
        <Text muted>Not determined</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
