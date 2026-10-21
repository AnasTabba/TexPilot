import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import {
  availableMetres,
  movementError,
  number,
  type MovementInput,
  type MovementKind,
} from './model';
import { useInventory } from './store';
import { inventoryStyles as f } from './Stock';
import { Action, Chip, DemoNotice, Header, Icon, Page, Sheet, Swatch, s } from './ui';

export function InventoryMovementForm() {
  const params = useLocalSearchParams<{ kind?: string; materialId?: string; reference?: string }>();
  const router = useRouter();
  const materials = useInventory((state) => state.materials);
  const recordMovement = useInventory((state) => state.recordMovement);
  const [kind, setKind] = useState<MovementKind>(params.kind === 'issued' ? 'issued' : 'received');
  const [materialId, setMaterialId] = useState(params.materialId ?? '');
  const [metres, setMetres] = useState('');
  const [rolls, setRolls] = useState('');
  const [reference, setReference] = useState(params.reference ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [choose, setChoose] = useState(false);
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const material = materials.find((item) => item.id === materialId);
  const input: MovementInput = {
    kind,
    materialId,
    metres: Number(metres),
    rolls: Number(rolls),
    reference,
    note,
  };
  const check = () => {
    const message = movementError(materials, input);
    setError(message);
    if (!message) setReview(true);
  };
  const save = () => {
    const result = recordMovement(input);
    setReview(false);
    if (result.ok) setSaved(true);
    else setError(result.error);
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/inventory'));
  if (saved)
    return (
      <>
        <Header title="Stock move saved" />
        <Page>
          <View style={[f.card, { alignItems: 'center', paddingVertical: t.space.xxxl }]}>
            <View
              style={{
                padding: t.space.xl,
                backgroundColor: t.color.greenSoft,
                borderRadius: t.radius.pill,
              }}
            >
              <Icon name="check" size={32} color={t.color.green} />
            </View>
            <Text accessibilityRole="header" style={s.heading}>
              {kind === 'received' ? 'Receipt recorded' : 'Stock issued'}
            </Text>
            <Text style={[s.helper, s.center]}>
              {number(input.metres)} m · {input.rolls} rolls of {material?.name}
              {'\n'}
              {reference}
            </Text>
            <Text style={[s.small, s.center]}>Saved in your demo inventory on this device.</Text>
          </View>
          <Action title="View activity" onPress={() => router.replace('/inventory/activity')} />
          <Action
            title="Back to inventory"
            secondary
            onPress={() => router.replace('/inventory/stock')}
          />
        </Page>
      </>
    );
  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header
        title={kind === 'received' ? 'Receive stock' : 'Issue stock'}
        subtitle="A clear record for every stock move."
        onBack={back}
      />
      <Page>
        <View style={f.actions}>
          <Chip
            title="Receive stock"
            selected={kind === 'received'}
            onPress={() => {
              setKind('received');
              setError(null);
            }}
          />
          <Chip
            title="Issue stock"
            selected={kind === 'issued'}
            onPress={() => {
              setKind('issued');
              setError(null);
            }}
          />
        </View>
        <View>
          <Text style={f.label}>Material</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose material"
            onPress={() => setChoose(true)}
            style={[f.card, s.rowBetween]}
          >
            <View style={s.row}>
              {material && <Swatch material={material} />}
              <View style={s.flex}>
                <Text style={s.materialName}>{material?.name ?? 'Choose a material'}</Text>
                <Text style={s.helper}>
                  {material
                    ? `${material.lot} · ${material.warehouse}`
                    : 'Find a material in your inventory'}
                </Text>
              </View>
            </View>
            <Icon name="chevron-down" size={18} />
          </Pressable>
          {material && (
            <Text style={[s.helper, { marginTop: t.space.sm }]}>
              {number(availableMetres(material))} m available · {material.rolls} rolls on hand
            </Text>
          )}
        </View>
        <View style={f.actions}>
          <View style={s.flex}>
            <Text style={f.label}>Quantity (metres)</Text>
            <TextInput
              accessibilityLabel="Quantity in metres"
              placeholder="e.g. 500"
              placeholderTextColor={t.color.muted}
              keyboardType="decimal-pad"
              value={metres}
              onChangeText={setMetres}
              style={f.field}
            />
          </View>
          <View style={s.flex}>
            <Text style={f.label}>Number of rolls</Text>
            <TextInput
              accessibilityLabel="Number of rolls"
              placeholder="e.g. 5"
              placeholderTextColor={t.color.muted}
              keyboardType="number-pad"
              value={rolls}
              onChangeText={setRolls}
              style={f.field}
            />
          </View>
        </View>
        <View>
          <Text style={f.label}>
            {kind === 'received' ? 'Delivery reference' : 'Production reference'}
          </Text>
          <TextInput
            accessibilityLabel="Reference"
            placeholder={kind === 'received' ? 'e.g. GRN-1045 or purchase order' : 'e.g. CUT-0087'}
            placeholderTextColor={t.color.muted}
            value={reference}
            onChangeText={setReference}
            style={f.field}
            autoCapitalize="characters"
          />
        </View>
        <View>
          <Text style={f.label}>
            Note <Text style={s.helper}>(optional)</Text>
          </Text>
          <TextInput
            accessibilityLabel="Movement note"
            placeholder="Anything the next shift should know?"
            placeholderTextColor={t.color.muted}
            value={note}
            onChangeText={setNote}
            multiline
            style={[f.field, { minHeight: 96, textAlignVertical: 'top' }]}
          />
        </View>
        <View style={f.note}>
          <Text style={s.helper}>
            {kind === 'received'
              ? 'Receiving adds to this material and lot. A lot on quality hold stays on hold.'
              : 'Only available stock can be issued. Reserved stock and quality holds are protected.'}
          </Text>
        </View>
        <DemoNotice />
        <Sheet visible={choose} title="Choose a material" onClose={() => setChoose(false)}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {materials.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Select ${item.name}`}
                accessibilityState={{ selected: item.id === materialId }}
                style={[s.option, { paddingVertical: t.space.md }]}
                onPress={() => {
                  setMaterialId(item.id);
                  setChoose(false);
                  setError(null);
                }}
              >
                <Swatch material={item} />
                <View style={s.flex}>
                  <Text style={s.materialName}>{item.name}</Text>
                  <Text style={s.helper}>
                    {item.sku} · {item.lot}
                  </Text>
                </View>
                {item.id === materialId && <Icon name="check" color={t.color.accent} />}
              </Pressable>
            ))}
          </ScrollView>
        </Sheet>
        <Sheet
          visible={review}
          title={kind === 'received' ? 'Check your receipt' : 'Check your stock issue'}
          onClose={() => setReview(false)}
        >
          <Text style={s.heading}>{material?.name}</Text>
          {[
            ['Quantity', `${number(input.metres)} m · ${input.rolls} rolls`],
            ['Reference', reference],
            ['Store', material?.warehouse ?? ''],
            [
              'New stock on hand',
              `${number((material?.metres ?? 0) + (kind === 'received' ? input.metres : -input.metres))} m`,
            ],
          ].map(([key, value]) => (
            <View style={f.keyValue} key={key}>
              <Text style={s.helper}>{key}</Text>
              <Text style={f.value}>{value}</Text>
            </View>
          ))}
          <Text style={s.helper}>This changes your demo inventory on this device.</Text>
          <Action
            title={kind === 'received' ? 'Confirm receipt' : 'Confirm issue'}
            icon="check"
            onPress={save}
          />
          <Action title="Keep editing" secondary onPress={() => setReview(false)} />
        </Sheet>
      </Page>
      <View style={f.footer}>
        {error && (
          <Text accessibilityRole="alert" style={f.error}>
            {error}
          </Text>
        )}
        <Action
          title={kind === 'received' ? 'Review receipt' : 'Review issue'}
          icon="arrow-right"
          onPress={check}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
