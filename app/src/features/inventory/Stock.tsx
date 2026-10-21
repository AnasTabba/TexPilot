import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import { categories, filterMaterials, inventorySummary, number, type StockStatus } from './model';
import { useInventory } from './store';
import {
  Chip,
  DemoNotice,
  EmptyState,
  Header,
  Icon,
  IconButton,
  MaterialRow,
  Page,
  WarehousePicker,
  s,
} from './ui';

export function InventoryStock() {
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const materials = useInventory((state) => state.materials);
  const warehouse = useInventory((state) => state.warehouse);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StockStatus>(
    params.status === 'low' || params.status === 'held' ? params.status : 'all',
  );
  const [category, setCategory] = useState('All');
  const summary = inventorySummary(
    materials.filter((item) => warehouse === 'All stores' || item.warehouse === warehouse),
  );
  const filtered = filterMaterials(materials, { query, status, category, warehouse });
  return (
    <>
      <Header
        title="Inventory"
        subtitle="Materials, lots & rolls."
        trailing={
          <IconButton
            icon="plus"
            label="Receive new stock"
            onPress={() => router.push('/inventory/movement')}
          />
        }
      />
      <Page>
        <View style={s.rowBetween}>
          <WarehousePicker />
          <Text style={s.helper}>{number(summary.metres)} m on hand</Text>
        </View>
        <View style={styles.search}>
          <Icon name="search" size={18} color={t.color.muted} />
          <TextInput
            accessibilityLabel="Search inventory"
            placeholder="Search material, SKU or lot…"
            placeholderTextColor={t.color.muted}
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <IconButton icon="x" label="Clear search" onPress={() => setQuery('')} />
          )}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          <Chip
            title={`All materials · ${materials.filter((item) => warehouse === 'All stores' || item.warehouse === warehouse).length}`}
            selected={status === 'all'}
            onPress={() => setStatus('all')}
          />
          <Chip
            title={`Low stock · ${summary.low}`}
            selected={status === 'low'}
            onPress={() => setStatus('low')}
          />
          <Chip
            title={`On hold · ${summary.held}`}
            selected={status === 'held'}
            onPress={() => setStatus('held')}
          />
        </ScrollView>
        <View style={styles.categoryRow}>
          {categories.map((value) => (
            <Chip
              key={value}
              title={value}
              selected={value === category}
              onPress={() => setCategory(value)}
            />
          ))}
        </View>
        <View style={s.rowBetween}>
          <Text style={s.heading}>
            {status === 'low'
              ? 'Time to replenish'
              : status === 'held'
                ? 'Awaiting inspection'
                : 'Your materials'}
          </Text>
          <Text style={s.helper}>{filtered.length} found</Text>
        </View>
        <View style={styles.list}>
          {filtered.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              onPress={() =>
                router.push({
                  pathname: '/inventory/material/[materialId]',
                  params: { materialId: material.id },
                })
              }
            />
          ))}
          {filtered.length === 0 && (
            <EmptyState
              title="No materials found"
              body="Try another material, lot number or store. Your stock is still here."
              onReset={() => {
                setQuery('');
                setCategory('All');
                setStatus('all');
              }}
            />
          )}
        </View>
        <DemoNotice />
      </Page>
    </>
  );
}
export const inventoryStyles = StyleSheet.create({
  footer: {
    paddingHorizontal: t.space.page,
    paddingVertical: t.space.md,
    gap: t.space.sm,
    backgroundColor: t.color.background,
    borderTopWidth: 1,
    borderTopColor: t.color.line,
  },
  card: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.line,
    padding: t.space.xl,
    gap: t.space.lg,
  },
  stack: { gap: t.space.md },
  actions: { flexDirection: 'row', gap: t.space.md },
  divider: { height: 1, backgroundColor: t.color.line },
  field: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: t.color.line,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
    color: t.color.ink,
    fontSize: t.type.label,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
  },
  label: {
    color: t.color.ink,
    fontSize: t.type.caption,
    fontWeight: '600',
    marginBottom: t.space.sm,
  },
  fieldGroup: { gap: t.space.xs },
  keyValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: t.space.lg,
    paddingVertical: t.space.sm,
  },
  value: {
    color: t.color.ink,
    fontSize: t.type.body,
    textAlign: 'right',
    flexShrink: 1,
    maxWidth: '64%',
    lineHeight: 21,
  },
  error: { color: t.color.danger, fontSize: t.type.body, lineHeight: 22 },
  note: {
    backgroundColor: t.color.accentSoft,
    padding: t.space.lg,
    borderRadius: t.radius.md,
    gap: t.space.sm,
  },
});
const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    paddingHorizontal: t.space.lg,
    minHeight: 54,
    borderWidth: 1,
    borderColor: t.color.line,
    borderRadius: t.radius.md,
    backgroundColor: t.color.surface,
  },
  searchInput: { flex: 1, minHeight: 52, fontSize: t.type.body, color: t.color.ink },
  chips: { gap: t.space.sm },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
  list: { gap: t.space.md },
});
