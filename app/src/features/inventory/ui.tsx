import Feather from '@expo/vector-icons/Feather';
import { Link, usePathname, type Href } from 'expo-router';
import { type ComponentProps, type PropsWithChildren, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import { availableMetres, isLow, number, warehouses, type Material, type Movement } from './model';
import { useInventory } from './store';

export type IconName = ComponentProps<typeof Feather>['name'];
export function Icon({
  name,
  size = t.size.icon,
  color = t.color.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Feather
      name={name}
      size={size}
      color={color}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
    >
      <Icon name={icon} />
    </Pressable>
  );
}
export function Action({
  title,
  icon,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        secondary && s.secondaryAction,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={secondary ? t.color.ink : t.color.surface} />}
      <Text style={[s.actionText, secondary && { color: t.color.ink }]}>{title}</Text>
    </Pressable>
  );
}
export function Chip({
  title,
  selected,
  onPress,
}: {
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [s.chip, selected && s.chipSelected, pressed && s.pressed]}
    >
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{title}</Text>
    </Pressable>
  );
}
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: PropsWithChildren<{ visible: boolean; title: string; onClose: () => void }>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.scrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close dialog"
          accessibilityRole="button"
          onPress={onClose}
        />
        <View accessibilityViewIsModal style={s.sheet}>
          <View style={s.rowBetween}>
            <Text accessibilityRole="header" style={s.heading}>
              {title}
            </Text>
            <IconButton icon="x" label="Close dialog" onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}
export function WarehousePicker() {
  const [open, setOpen] = useState(false);
  const warehouse = useInventory((state) => state.warehouse);
  const setWarehouse = useInventory((state) => state.setWarehouse);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Choose store, ${warehouse}`}
        onPress={() => setOpen(true)}
        style={s.storePicker}
      >
        <Icon name="map-pin" size={14} color={t.color.muted} />
        <Text style={s.caption}>{warehouse}</Text>
        <Icon name="chevron-down" size={14} color={t.color.muted} />
      </Pressable>
      <Sheet visible={open} title="Choose a store" onClose={() => setOpen(false)}>
        <Text style={s.helper}>View the whole factory or focus on one store.</Text>
        {warehouses.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityState={{ selected: warehouse === name }}
            style={s.option}
            onPress={() => {
              setWarehouse(name);
              setOpen(false);
            }}
          >
            <Icon name="archive" color={t.color.accent} />
            <Text style={s.body}>{name}</Text>
            {warehouse === name && <Icon name="check" color={t.color.accent} />}
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}
export function Header({
  title,
  subtitle,
  onBack,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={s.header}>
      <View style={s.rowBetween}>
        <View style={[s.row, s.flex]}>
          {onBack && <IconButton icon="arrow-left" label="Back" onPress={onBack} />}
          <View style={s.flex}>
            <Text accessibilityRole="header" style={s.pageTitle}>
              {title}
            </Text>
            {subtitle && <Text style={s.helper}>{subtitle}</Text>}
          </View>
        </View>
        {trailing}
      </View>
    </View>
  );
}
export function DemoNotice() {
  return (
    <View style={s.demoNotice}>
      <View style={s.demoDot} />
      <Text style={s.small}>Demo workspace · saved on this device</Text>
    </View>
  );
}
export function Page({ children }: PropsWithChildren) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.page}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
export function SectionTitle({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={s.rowBetween}>
      <Text accessibilityRole="header" style={s.heading}>
        {title}
      </Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onPress} style={s.textAction}>
          <Text style={s.textActionLabel}>{action}</Text>
          <Icon name="arrow-up-right" size={15} color={t.color.muted} />
        </Pressable>
      )}
    </View>
  );
}
export function Swatch({ material, large = false }: { material: Material; large?: boolean }) {
  return (
    <View
      style={[s.swatch, { backgroundColor: t.color[material.swatch] }, large && s.swatchLarge]}
      accessibilityLabel={`${material.colour} fabric swatch`}
      accessibilityRole="image"
      accessible
    >
      {Array.from({ length: large ? 20 : 10 }, (_, i) => (
        <View
          key={i}
          style={[
            s.weave,
            { left: i * (large ? 14 : 8) },
            material.category === 'Knitted' && s.knit,
          ]}
        />
      ))}
      {Array.from({ length: large ? 12 : 5 }, (_, i) => (
        <View key={i} style={[s.weaveAcross, { top: i * (large ? 18 : 12) }]} />
      ))}
      {large && (
        <View style={s.swatchLabel}>
          <Text style={s.small}>{material.colour}</Text>
        </View>
      )}
    </View>
  );
}
export function Status({ material }: { material: Material }) {
  const tone = material.held ? 'purple' : isLow(material) ? 'amber' : 'green';
  const bg =
    tone === 'purple'
      ? t.color.purpleSoft
      : tone === 'amber'
        ? t.color.amberSoft
        : t.color.greenSoft;
  return (
    <View style={[s.status, { backgroundColor: bg }]}>
      <View style={[s.statusDot, { backgroundColor: t.color[tone] }]} />
      <Text style={[s.statusText, { color: t.color[tone] }]}>
        {material.held ? 'Quality hold' : isLow(material) ? 'Low stock' : 'In stock'}
      </Text>
    </View>
  );
}
export function MaterialRow({ material, onPress }: { material: Material; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${material.name}, ${number(material.metres)} metres`}
      onPress={onPress}
      style={({ pressed }) => [s.materialRow, pressed && s.pressed]}
    >
      <Swatch material={material} />
      <View style={s.flex}>
        <View style={s.rowBetween}>
          <Text style={s.materialName}>{material.name}</Text>
          <Icon name="chevron-right" size={16} color={t.color.muted} />
        </View>
        <Text style={s.helper}>
          {material.sku} · {material.colour}
        </Text>
        <View style={[s.rowBetween, { marginTop: t.space.md }]}>
          <Text style={s.quantity}>
            {number(material.metres)} <Text style={s.helper}>m · {material.rolls} rolls</Text>
          </Text>
          <Status material={material} />
        </View>
      </View>
    </Pressable>
  );
}
export function MovementRow({ movement, onPress }: { movement: Movement; onPress: () => void }) {
  const received = movement.kind === 'received';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${movement.name} ${received ? 'receipt' : 'issue'} ${movement.reference}`}
      onPress={onPress}
      style={({ pressed }) => [s.movementRow, pressed && s.pressed]}
    >
      <View
        style={[
          s.movementIcon,
          { backgroundColor: received ? t.color.greenSoft : t.color.purpleSoft },
        ]}
      >
        <Icon
          name={received ? 'arrow-down-left' : 'arrow-up-right'}
          color={received ? t.color.green : t.color.purple}
          size={19}
        />
      </View>
      <View style={s.flex}>
        <Text style={s.materialName}>{movement.name}</Text>
        <Text style={s.helper}>
          {received ? 'Received' : 'Issued'} · {movement.reference}
        </Text>
      </View>
      <View style={s.alignEnd}>
        <Text style={[s.quantity, { color: received ? t.color.green : t.color.ink }]}>
          {received ? '+' : '−'}
          {number(movement.metres)} m
        </Text>
        <Text style={s.small}>{movement.sample ? 'Sample record' : 'Saved locally'}</Text>
      </View>
    </Pressable>
  );
}
export function EmptyState({
  title,
  body,
  onReset,
}: {
  title: string;
  body: string;
  onReset?: () => void;
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name="search" color={t.color.muted} size={28} />
      </View>
      <Text accessibilityRole="header" style={s.heading}>
        {title}
      </Text>
      <Text style={[s.helper, s.center]}>{body}</Text>
      {onReset && <Action title="Clear filters" onPress={onReset} secondary />}
    </View>
  );
}
export function WorkspaceTabs({ scan = false }: { scan?: boolean }) {
  const pathname = usePathname();
  const tabs: { title: string; icon: IconName; href: Href; selected: boolean }[] = [
    {
      title: 'Overview',
      icon: 'grid',
      href: '/inventory',
      selected: !scan && (pathname === '/inventory' || pathname === '/inventory/orders'),
    },
    {
      title: 'Inventory',
      icon: 'layers',
      href: '/inventory/stock',
      selected:
        !scan &&
        (pathname.includes('/stock') ||
          pathname.includes('/material') ||
          pathname.includes('/movement')),
    },
    { title: 'Scan', icon: 'maximize', href: '/scan', selected: scan },
    {
      title: 'Activity',
      icon: 'clock',
      href: '/inventory/activity',
      selected: pathname === '/inventory/activity',
    },
  ];
  return (
    <SafeAreaView edges={['bottom']} style={s.navSafe}>
      <View style={s.nav} role="navigation">
        {tabs.map((tab) => (
          <Link key={tab.title} href={tab.href} asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={tab.title}
              accessibilityState={{ selected: tab.selected }}
              style={s.navItem}
            >
              <View style={[s.navIcon, tab.selected && s.navIconSelected]}>
                <Icon
                  name={tab.icon}
                  size={21}
                  color={tab.selected ? t.color.accentStrong : t.color.muted}
                />
              </View>
              <Text style={[s.navText, tab.selected && s.navTextSelected]}>{tab.title}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </SafeAreaView>
  );
}
export function InventoryShell({ children }: PropsWithChildren) {
  return (
    <View style={s.stage}>
      <View style={s.workspace}>
        <SafeAreaView edges={['top', 'left', 'right']} style={s.flex}>
          {children}
        </SafeAreaView>
        <WorkspaceTabs />
      </View>
    </View>
  );
}
export function Availability({ material }: { material: Material }) {
  return (
    <View style={s.availability}>
      <View>
        <Text style={s.helper}>Available</Text>
        <Text style={s.heading}>{number(availableMetres(material))} m</Text>
      </View>
      <View>
        <Text style={s.helper}>Reserved</Text>
        <Text style={s.heading}>{number(material.reserved)} m</Text>
      </View>
      <View>
        <Text style={s.helper}>Rolls</Text>
        <Text style={s.heading}>{material.rolls}</Text>
      </View>
    </View>
  );
}
export const s = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.sm },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.space.sm,
  },
  alignEnd: { alignItems: 'flex-end', gap: t.space.xs },
  center: { textAlign: 'center' },
  stage: { flex: 1, backgroundColor: t.color.line, alignItems: 'center' },
  workspace: { flex: 1, width: '100%', maxWidth: t.size.max, backgroundColor: t.color.background },
  page: { padding: t.space.page, gap: t.space.section, paddingBottom: t.space.xxxl },
  header: { paddingHorizontal: t.space.page, paddingTop: t.space.xl, paddingBottom: t.space.sm },
  pageTitle: { color: t.color.ink, fontSize: t.type.brand, fontWeight: '600', letterSpacing: -0.7 },
  heading: {
    fontSize: t.type.heading,
    fontWeight: '600',
    letterSpacing: -0.35,
    color: t.color.ink,
  },
  body: { fontSize: t.type.body, lineHeight: 22, color: t.color.ink },
  caption: { fontSize: t.type.caption, color: t.color.muted },
  helper: { color: t.color.muted, fontSize: t.type.caption, lineHeight: 20 },
  small: { color: t.color.muted, fontSize: t.type.small, lineHeight: 17 },
  iconButton: {
    minWidth: t.size.touch,
    minHeight: t.size.touch,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surface,
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  action: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: t.space.sm,
    minHeight: 52,
    backgroundColor: t.color.accent,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
  },
  secondaryAction: { backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.line },
  actionText: { fontSize: t.type.label, fontWeight: '600', color: t.color.surface },
  chip: {
    minHeight: t.size.touch,
    paddingHorizontal: t.space.lg,
    paddingVertical: t.space.md,
    borderRadius: t.radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.color.background,
    borderWidth: 1,
    borderColor: t.color.line,
  },
  chipSelected: { backgroundColor: t.color.accentSoft, borderColor: t.color.accentSoft },
  chipText: { color: t.color.muted, fontSize: t.type.caption, fontWeight: '500' },
  chipTextSelected: { color: t.color.accentStrong },
  scrim: {
    flex: 1,
    backgroundColor: t.color.scrim,
    justifyContent: 'center',
    alignItems: 'center',
    padding: t.space.xl,
  },
  sheet: {
    width: '100%',
    maxWidth: t.size.max,
    maxHeight: '85%',
    backgroundColor: t.color.surface,
    borderRadius: t.radius.xl,
    padding: t.space.xl,
    gap: t.space.lg,
  },
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color.line,
  },
  storePicker: {
    flexDirection: 'row',
    gap: t.space.sm,
    alignItems: 'center',
    minHeight: t.size.touch,
  },
  demoNotice: { flexDirection: 'row', gap: t.space.sm, alignItems: 'center' },
  demoDot: { width: 5, height: 5, borderRadius: t.radius.pill, backgroundColor: t.color.purple },
  textAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: t.space.xs,
    minHeight: t.size.touch,
  },
  textActionLabel: { color: t.color.muted, fontSize: t.type.caption },
  swatch: {
    width: t.size.swatch,
    height: t.size.swatch + 8,
    borderRadius: t.radius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  swatchLarge: { width: '100%', height: 160, borderRadius: t.radius.lg },
  weave: {
    position: 'absolute',
    top: -40,
    height: 300,
    width: 2,
    backgroundColor: t.color.weave,
    transform: [{ rotate: '28deg' }],
  },
  knit: { width: 3, borderRadius: t.radius.pill, transform: [{ rotate: '0deg' }] },
  weaveAcross: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: t.color.weaveDark,
  },
  swatchLabel: {
    position: 'absolute',
    bottom: t.space.md,
    left: t.space.md,
    paddingVertical: t.space.xs,
    paddingHorizontal: t.space.md,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.pill,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.space.sm,
    paddingVertical: t.space.xs,
    gap: t.space.xs,
    borderRadius: t.radius.pill,
  },
  statusDot: { width: 4, height: 4, borderRadius: t.radius.pill },
  statusText: { fontSize: t.type.small, fontWeight: '500' },
  materialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    padding: t.space.lg,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.md,
  },
  materialName: { fontSize: t.type.label, color: t.color.ink, fontWeight: '600', flexShrink: 1 },
  quantity: { color: t.color.ink, fontSize: t.type.label, fontWeight: '600' },
  movementRow: {
    flexDirection: 'row',
    gap: t.space.md,
    alignItems: 'center',
    paddingVertical: t.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: t.color.line,
    minHeight: 80,
  },
  movementIcon: {
    width: 42,
    height: 42,
    borderRadius: t.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  availability: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: t.space.xl,
    borderBottomWidth: 1,
    borderBottomColor: t.color.line,
  },
  empty: { alignItems: 'center', gap: t.space.lg, paddingVertical: t.space.xxxl },
  emptyIcon: { padding: t.space.xl, backgroundColor: t.color.line, borderRadius: t.radius.pill },
  navSafe: { backgroundColor: t.color.surface, borderTopWidth: 1, borderTopColor: t.color.line },
  nav: {
    flexDirection: 'row',
    paddingHorizontal: t.space.sm,
    paddingTop: t.space.sm,
    paddingBottom: t.space.xs,
    minHeight: t.size.nav,
  },
  navItem: { flex: 1, alignItems: 'center', gap: t.space.xs, minHeight: 56 },
  navIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    height: 36,
    borderRadius: t.radius.sm,
  },
  navIconSelected: { backgroundColor: t.color.accentSoft },
  navText: { color: t.color.muted, fontSize: t.type.small, fontWeight: '500' },
  navTextSelected: { color: t.color.accentStrong },
});
