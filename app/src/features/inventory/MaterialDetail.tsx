import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import { number } from './model';
import { useInventory } from './store';
import { inventoryStyles as f } from './Stock';
import {
  Action,
  Availability,
  DemoNotice,
  EmptyState,
  Header,
  Icon,
  Page,
  Status,
  Swatch,
  s,
} from './ui';

export function InventoryMaterialDetail() {
  const { materialId } = useLocalSearchParams<{ materialId: string }>();
  const router = useRouter();
  const material = useInventory((state) => state.materials.find((item) => item.id === materialId));
  if (!material)
    return (
      <>
        <Header title="Material details" onBack={() => router.replace('/inventory/stock')} />
        <Page>
          <EmptyState
            title="Material not found"
            body="Return to inventory and choose a material."
          />
          <Action title="Back to inventory" onPress={() => router.replace('/inventory/stock')} />
        </Page>
      </>
    );
  return (
    <>
      <Header title="Material details" onBack={() => router.back()} />
      <Page>
        <Swatch material={material} large />
        <View style={f.stack}>
          <View style={s.rowBetween}>
            <Text style={s.caption}>
              {material.sku} · {material.category}
            </Text>
            <Status material={material} />
          </View>
          <Text accessibilityRole="header" style={s.pageTitle}>
            {material.name}
          </Text>
          <Text style={s.helper}>
            Lot {material.lot} · {material.supplier}
          </Text>
        </View>
        <View style={f.card}>
          <Text style={s.helper}>Total stock on hand</Text>
          <Text style={styles.total}>
            {number(material.metres)} <Text style={s.heading}>metres</Text>
          </Text>
          <Availability material={material} />
          <View style={s.row}>
            <Icon name="map-pin" size={16} color={t.color.accent} />
            <Text style={s.helper}>
              {material.warehouse} · {material.location}
            </Text>
          </View>
        </View>
        {material.held && (
          <View style={[f.note, { backgroundColor: t.color.purpleSoft }]}>
            <Text style={s.materialName}>This lot is on quality hold</Text>
            <Text style={s.helper}>
              It stays unavailable for issue until inspection is completed. A detection scan is
              evidence, not an automatic stock release.
            </Text>
            <Action
              title="Open fabric verification"
              icon="maximize"
              secondary
              onPress={() => router.push('/scan')}
            />
          </View>
        )}
        <View style={f.card}>
          <Text style={s.heading}>Material specifications</Text>
          {[
            ['Composition', material.composition],
            ['Weight', `${material.gsm} GSM`],
            ['Width', `${material.width} cm`],
            ['Colour', material.colour],
            ['Reorder point', `${number(material.reorderAt)} m`],
          ].map(([key, value]) => (
            <View style={f.keyValue} key={key}>
              <Text style={s.helper}>{key}</Text>
              <Text style={f.value}>{value}</Text>
            </View>
          ))}
          <Text style={s.small}>
            Sample master-data specifications; not inferred from a photograph.
          </Text>
        </View>
        {!material.held && (
          <Action
            title="Verify this fabric"
            icon="maximize"
            secondary
            onPress={() => router.push('/scan')}
          />
        )}
        <DemoNotice />
      </Page>
      <View style={f.footer}>
        <View style={f.actions}>
          <View style={s.flex}>
            <Action
              title="Receive"
              icon="arrow-down-left"
              onPress={() =>
                router.push({
                  pathname: '/inventory/movement',
                  params: { kind: 'received', materialId },
                })
              }
            />
          </View>
          <View style={s.flex}>
            <Action
              title="Issue stock"
              icon="arrow-up-right"
              secondary
              disabled={material.held}
              onPress={() =>
                router.push({
                  pathname: '/inventory/movement',
                  params: { kind: 'issued', materialId },
                })
              }
            />
          </View>
        </View>
      </View>
    </>
  );
}
const styles = StyleSheet.create({
  total: { fontSize: t.type.display, fontWeight: '500', letterSpacing: -1.1, color: t.color.ink },
});
