import { router } from 'expo-router';
import { Image, StyleSheet } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import { useScanDraft, useSubmitScan } from '@/features/scan';
import { colors, radius } from '@/theme';

export default function ReviewStep() {
  const surface = useScanDraft((s) => s.surface);
  const labelText = useScanDraft((s) => s.labelText);
  const { submit, submitting, error } = useSubmitScan();

  if (!surface) {
    return (
      <Screen
        footer={<Button title="Take photo" onPress={() => router.replace('/scan/surface')} />}
      >
        <Text>No fabric photo yet.</Text>
      </Screen>
    );
  }

  async function onSubmit() {
    const outcome = await submit();
    if (outcome.status === 'done') {
      // Drop the capture steps so Back from the result goes home.
      router.dismissAll();
      router.push({ pathname: '/result/[scanId]', params: { scanId: outcome.scanId } });
    }
  }

  return (
    <Screen footer={<Button title="Check fabric" onPress={onSubmit} loading={submitting} />}>
      <Card title="Fabric surface">
        <Image source={{ uri: surface.image.uri }} style={styles.photo} />
      </Card>
      <Card title="Care label">
        {labelText.trim() ? <Text>{labelText.trim()}</Text> : <Text muted>No label given</Text>}
      </Card>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md },
});
