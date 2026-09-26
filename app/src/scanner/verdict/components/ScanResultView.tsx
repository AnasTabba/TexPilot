import { View } from 'react-native';

import type { ScanResult } from '../../api';
import { Text } from '@/components/ui';
import { spacing } from '@/theme';

import { CompositionList } from './CompositionList';
import { FlagList } from './FlagList';
import { PredictionList } from './PredictionList';
import { VerdictBanner } from './VerdictBanner';

/** Full read-out of one scan: verdict first, then the evidence behind it. */
export function ScanResultView({ result }: { result: ScanResult }) {
  return (
    <View style={{ gap: spacing.md }}>
      <VerdictBanner verdict={result.verdict} />
      <FlagList flags={result.flags} />
      <PredictionList result={result} />
      <CompositionList composition={result.stated_composition} />
      <Text variant="caption" muted>
        model {result.model_version} · kb {result.kb_version} · {result.scan_id}
      </Text>
    </View>
  );
}
