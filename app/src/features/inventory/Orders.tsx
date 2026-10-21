import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import { number, purchaseOrders } from './model';
import { useInventory } from './store';
import { inventoryStyles as f } from './Stock';
import { Action, DemoNotice, Header, Icon, Page, Swatch, s } from './ui';

export function InventoryOrders() {
  const router = useRouter();
  const materials = useInventory((state) => state.materials);
  return (
    <>
      <Header
        title="Incoming stock"
        subtitle="A clearer picture of what’s on the way."
        onBack={() => router.back()}
      />
      <Page>
        <View
          style={[f.card, { backgroundColor: t.color.accentSoft, borderColor: t.color.accentSoft }]}
        >
          <Icon name="truck" color={t.color.accent} size={24} />
          <Text style={s.pageTitle}>
            {number(purchaseOrders.reduce((n, order) => n + order.metres, 0))} metres
          </Text>
          <Text style={s.helper}>Across 3 sample purchase orders</Text>
        </View>
        {purchaseOrders.map((order) => {
          const material = materials.find((item) => item.id === order.materialId)!;
          return (
            <View style={f.card} key={order.id}>
              <View style={s.rowBetween}>
                <Text style={s.caption}>{order.id}</Text>
                <View
                  style={[
                    s.status,
                    {
                      backgroundColor:
                        order.status === 'In transit' ? t.color.accentSoft : t.color.greenSoft,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.statusText,
                      {
                        color: order.status === 'In transit' ? t.color.accentStrong : t.color.green,
                      },
                    ]}
                  >
                    {order.status}
                  </Text>
                </View>
              </View>
              <View style={s.row}>
                <Swatch material={material} />
                <View style={s.flex}>
                  <Text style={s.materialName}>{order.name}</Text>
                  <Text style={s.helper}>{order.supplier}</Text>
                </View>
              </View>
              <View style={s.rowBetween}>
                <Text style={s.quantity}>
                  {number(order.metres)} m <Text style={s.helper}>· {order.rolls} rolls</Text>
                </Text>
                <Text style={s.helper}>Due {order.date}</Text>
              </View>
              <Action
                title="Record delivery"
                icon="arrow-down-left"
                secondary
                onPress={() =>
                  router.push({
                    pathname: '/inventory/movement',
                    params: { kind: 'received', materialId: order.materialId, reference: order.id },
                  })
                }
              />
              <Text style={s.small}>Records a demo receipt; order status is illustrative.</Text>
            </View>
          );
        })}
        <DemoNotice />
      </Page>
    </>
  );
}
