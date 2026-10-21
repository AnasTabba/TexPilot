import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import { number, type Movement, type MovementKind } from './model';
import { useInventory } from './store';
import { inventoryStyles as f } from './Stock';
import { Chip, DemoNotice, EmptyState, Header, Icon, MovementRow, Page, Sheet, s } from './ui';

export function InventoryActivity() {
  const movements = useInventory((state) => state.movements);
  const [kind, setKind] = useState<'all' | MovementKind>('all');
  const [selected, setSelected] = useState<Movement | null>(null);
  const filtered = movements.filter((movement) => kind === 'all' || movement.kind === kind);
  return (
    <>
      <Header title="Stock activity" subtitle="A little context behind every metre." />
      <Page>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: t.space.sm }}
        >
          <Chip title="All movements" selected={kind === 'all'} onPress={() => setKind('all')} />
          <Chip
            title="Received"
            selected={kind === 'received'}
            onPress={() => setKind('received')}
          />
          <Chip title="Issued" selected={kind === 'issued'} onPress={() => setKind('issued')} />
        </ScrollView>
        <View style={f.note}>
          <View style={s.row}>
            <Icon name="info" color={t.color.accent} size={17} />
            <Text style={[s.helper, s.flex]}>
              Sample records and stock moves saved on this device.
            </Text>
          </View>
        </View>
        <View>
          {filtered.map((movement, index) => (
            <View key={movement.id}>
              {(index === 0 ||
                new Date(movement.at).toDateString() !==
                  new Date(filtered[index - 1]!.at).toDateString()) && (
                <Text style={[s.small, { marginTop: t.space.xl, marginBottom: t.space.xs }]}>
                  {new Date(movement.at).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </Text>
              )}
              <MovementRow movement={movement} onPress={() => setSelected(movement)} />
            </View>
          ))}
          {filtered.length === 0 && (
            <EmptyState
              title="No movements yet"
              body="Receipts and issues you record will appear here."
            />
          )}
        </View>
        <DemoNotice />
        <Sheet
          visible={selected !== null}
          title="Movement details"
          onClose={() => setSelected(null)}
        >
          {selected && (
            <>
              <Text style={s.heading}>{selected.name}</Text>
              {[
                ['Movement', selected.kind === 'received' ? 'Received' : 'Issued'],
                ['Quantity', `${number(selected.metres)} m · ${selected.rolls} rolls`],
                ['Reference', selected.reference],
                ['Date', new Date(selected.at).toLocaleString('en-GB')],
                ['Record', selected.sample ? 'Sample record' : 'Saved on this device'],
              ].map(([key, value]) => (
                <View style={f.keyValue} key={key}>
                  <Text style={s.helper}>{key}</Text>
                  <Text style={f.value}>{value}</Text>
                </View>
              ))}
              {selected.note && (
                <View style={f.note}>
                  <Text style={s.body}>{selected.note}</Text>
                </View>
              )}
            </>
          )}
        </Sheet>
      </Page>
    </>
  );
}
