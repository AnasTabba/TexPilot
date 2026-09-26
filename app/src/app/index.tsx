import { router } from 'expo-router';

import { Button, Card, Screen, Text } from '@/components/ui';
import { env } from '@/config/env';
import { useScanDraft } from '@/features/scan';
import { useApiHealth } from '@/hooks/useApiHealth';
import { colors } from '@/theme';

const HEALTH_COPY = {
  checking: { text: 'Checking…', color: colors.textMuted },
  online: { text: 'Connected', color: colors.pass },
  offline: {
    text: 'Unreachable. Is `make api-lan` running, and is the URL your LAN IP?',
    color: colors.danger,
  },
} as const;

export default function HomeScreen() {
  const health = HEALTH_COPY[useApiHealth()];

  function startScan() {
    useScanDraft.getState().reset();
    router.push('/scan/surface');
  }

  return (
    <Screen
      footer={
        <>
          <Button title="New scan" onPress={startScan} />
          <Button title="History" variant="secondary" onPress={() => router.push('/history')} />
        </>
      }
    >
      <Text variant="title">Fabric verification</Text>
      <Text muted>
        Photograph a fabric and its care label. TexPilot checks that what the fabric looks like
        matches what the label claims.
      </Text>
      <Card title="Server">
        <Text>{env.apiUrl}</Text>
        <Text variant="caption" style={{ color: health.color }}>
          {health.text}
        </Text>
      </Card>
    </Screen>
  );
}
