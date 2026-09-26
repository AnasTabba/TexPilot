import { router } from 'expo-router';
import { FlatList, StyleSheet } from 'react-native';

import { Button, Screen, Text } from '@/components/ui';
import { loadSampleScans, ScanListItem, useHistory } from '@/features/history';
import { spacing } from '@/theme';

export default function HistoryScreen() {
  const scans = useHistory((s) => s.scans);

  return (
    <Screen
      scroll={false}
      footer={
        __DEV__ ? (
          <Button title="Load sample results (dev)" variant="secondary" onPress={loadSampleScans} />
        ) : undefined
      }
    >
      <FlatList
        data={scans}
        keyExtractor={(s) => s.scan_id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text muted>No scans on this device yet.</Text>}
        renderItem={({ item }) => (
          <ScanListItem
            scan={item}
            onPress={() =>
              router.push({ pathname: '/result/[scanId]', params: { scanId: item.scan_id } })
            }
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
