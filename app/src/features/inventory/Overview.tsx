import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { inventoryTheme as t } from '@/theme';
import { inventorySummary, number, purchaseOrders } from './model';
import { useInventory } from './store';
import {
  DemoNotice,
  Icon,
  MaterialRow,
  MovementRow,
  Page,
  SectionTitle,
  Sheet,
  WarehousePicker,
  s,
  type IconName,
} from './ui';

export function InventoryOverview() {
  const router = useRouter();
  const all = useInventory((state) => state.materials);
  const warehouse = useInventory((state) => state.warehouse);
  const movements = useInventory((state) => state.movements);
  const items = all.filter((item) => warehouse === 'All stores' || item.warehouse === warehouse);
  const summary = inventorySummary(items);
  const [profile, setProfile] = useState(false);
  const [period, setPeriod] = useState<'7 days' | '30 days'>('7 days');
  const [periodOpen, setPeriodOpen] = useState(false);
  const chart = period === '7 days' ? [38, 62, 46, 83, 58, 72, 96] : [74, 90, 54, 80, 65, 98, 86];
  const openMaterial = (id: string) =>
    router.push({ pathname: '/inventory/material/[materialId]', params: { materialId: id } });
  const openMovement = (kind: 'received' | 'issued') =>
    router.push({ pathname: '/inventory/movement', params: { kind } });
  return (
    <Page>
      <View style={s.rowBetween}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open workspace information"
          onPress={() => setProfile(true)}
          style={styles.profile}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>AM</Text>
          </View>
          <View style={s.flex}>
            <Text style={styles.eyebrow}>TEXPILOT WORKSPACE</Text>
            <Text style={styles.greeting}>Hello, Ayesha</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open fabric verification"
          onPress={() => router.push('/scan')}
          style={styles.scanShortcut}
        >
          <Icon name="maximize" size={22} />
        </Pressable>
      </View>
      <View style={styles.introduction}>
        <Text accessibilityRole="header" style={styles.title}>
          Your inventory, at a glance.
        </Text>
        <View style={s.rowBetween}>
          <WarehousePicker />
          <View style={styles.demoBadge}>
            <View style={styles.demoBadgeDot} />
            <Text style={styles.demoText}>Demo workspace</Text>
          </View>
        </View>
      </View>

      <View style={styles.metricGrid}>
        <View style={styles.metrics}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View inventory, ${number(summary.metres)} metres on hand`}
            onPress={() => router.push('/inventory/stock')}
            style={({ pressed }) => [styles.metric, styles.primaryMetric, pressed && s.pressed]}
          >
            <View style={s.rowBetween}>
              <View style={[styles.metricIcon, styles.primaryIcon]}>
                <Icon name="layers" size={21} color={t.color.violetInk} />
              </View>
              <Text style={styles.metricTag}>Metres</Text>
            </View>
            <Text style={[styles.metricValue, styles.primaryInk]}>{number(summary.metres)}</Text>
            <View style={s.rowBetween}>
              <Text style={[styles.metricLabel, styles.primaryInk]}>Fabric on hand</Text>
              <Icon name="arrow-up-right" size={17} color={t.color.violetInk} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${summary.rolls} rolls across ${items.length} materials`}
            onPress={() => router.push('/inventory/stock')}
            style={({ pressed }) => [styles.metric, pressed && s.pressed]}
          >
            <View style={s.rowBetween}>
              <View style={[styles.metricIcon, { backgroundColor: t.color.greenSoft }]}>
                <Icon name="package" size={21} color={t.color.green} />
              </View>
              <Text style={styles.metricTag}>{items.length} fabrics</Text>
            </View>
            <Text style={styles.metricValue}>{number(summary.rolls)}</Text>
            <View style={s.rowBetween}>
              <Text style={styles.metricLabel}>Total rolls</Text>
              <Icon name="arrow-up-right" size={17} color={t.color.muted} />
            </View>
          </Pressable>
        </View>
        <View style={styles.metrics}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${summary.low} low-stock materials`}
            onPress={() => router.push({ pathname: '/inventory/stock', params: { status: 'low' } })}
            style={({ pressed }) => [styles.metric, pressed && s.pressed]}
          >
            <View style={s.rowBetween}>
              <View style={[styles.metricIcon, { backgroundColor: t.color.roseSoft }]}>
                <Icon name="alert-triangle" size={21} color={t.color.roseInk} />
              </View>
              <Text style={styles.metricTag}>Materials</Text>
            </View>
            <Text style={styles.metricValue}>{String(summary.low).padStart(2, '0')}</Text>
            <View style={s.rowBetween}>
              <Text style={styles.metricLabel}>Low stock</Text>
              <Icon name="arrow-up-right" size={17} color={t.color.muted} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View incoming purchase orders"
            onPress={() => router.push('/inventory/orders')}
            style={({ pressed }) => [styles.metric, pressed && s.pressed]}
          >
            <View style={s.rowBetween}>
              <View style={[styles.metricIcon, { backgroundColor: t.color.amberSoft }]}>
                <Icon name="truck" size={21} color={t.color.amber} />
              </View>
              <Text style={styles.metricTag}>Orders</Text>
            </View>
            <Text style={styles.metricValue}>{String(purchaseOrders.length).padStart(2, '0')}</Text>
            <View style={s.rowBetween}>
              <Text style={styles.metricLabel}>Incoming</Text>
              <Icon name="arrow-up-right" size={17} color={t.color.muted} />
            </View>
          </Pressable>
        </View>
      </View>

      <View style={styles.allocationCard}>
        <View style={s.rowBetween}>
          <Text style={s.helper}>
            Available <Text style={styles.allocationValue}>{number(summary.available)} m</Text>
          </Text>
          <Text style={s.helper}>
            Reserved <Text style={styles.allocationValue}>{number(summary.reserved)} m</Text>
          </Text>
        </View>
        <View style={styles.allocation}>
          <View
            style={[
              styles.allocationBar,
              { flex: Math.max(summary.available, 1), backgroundColor: t.color.accent },
            ]}
          />
          <View
            style={[
              styles.allocationBar,
              { flex: Math.max(summary.reserved, 1), backgroundColor: t.color.lilac },
            ]}
          />
          <View
            style={[
              styles.allocationBar,
              {
                flex: Math.max(summary.metres - summary.available - summary.reserved, 1),
                backgroundColor: t.color.line,
              },
            ]}
          />
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle title="Make a stock move" />
        <View style={styles.quickActions}>
          {(
            [
              {
                title: 'Receive stock',
                icon: 'arrow-down-left',
                onPress: () => openMovement('received'),
                colour: t.color.accentSoft,
                ink: t.color.accent,
              },
              {
                title: 'Issue stock',
                icon: 'arrow-up-right',
                onPress: () => openMovement('issued'),
                colour: t.color.purpleSoft,
                ink: t.color.purple,
              },
              {
                title: 'Verify fabric',
                icon: 'maximize',
                onPress: () => router.push('/scan'),
                colour: t.color.greenSoft,
                ink: t.color.green,
              },
            ] as {
              title: string;
              icon: IconName;
              onPress: () => void;
              colour: string;
              ink: string;
            }[]
          ).map((action) => (
            <Pressable
              key={action.title}
              accessibilityRole="button"
              onPress={action.onPress}
              style={({ pressed }) => [styles.quickAction, pressed && s.pressed]}
            >
              <View style={[styles.quickIcon, { backgroundColor: action.colour }]}>
                <Icon name={action.icon} color={action.ink} size={23} />
              </View>
              <Text style={styles.quickLabel}>{action.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {summary.held > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View material awaiting quality inspection"
          onPress={() => router.push({ pathname: '/inventory/stock', params: { status: 'held' } })}
          style={styles.alert}
        >
          <View style={styles.alertIcon}>
            <Icon name="shield" size={20} color={t.color.purple} />
          </View>
          <View style={s.flex}>
            <Text style={styles.alertTitle}>{summary.held} lot awaiting a closer look</Text>
            <Text style={s.helper}>Quality hold · check before issuing</Text>
          </View>
          <Icon name="chevron-right" size={17} color={t.color.purple} />
        </Pressable>
      )}

      <View style={styles.chartCard}>
        <View style={s.rowBetween}>
          <View>
            <Text style={s.heading}>Stock flow</Text>
            <Text style={s.small}>Example trend · metres</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Change chart period, ${period}`}
            onPress={() => setPeriodOpen(true)}
            style={styles.period}
          >
            <Text style={s.caption}>{period}</Text>
            <Icon name="chevron-down" size={13} color={t.color.muted} />
          </Pressable>
        </View>
        <View style={styles.chartLegend}>
          <View style={s.row}>
            <View style={[styles.legendDot, { backgroundColor: t.color.violet }]} />
            <Text style={s.small}>Received</Text>
          </View>
          <View style={s.row}>
            <View style={[styles.legendDot, { backgroundColor: t.color.mint }]} />
            <Text style={s.small}>Issued</Text>
          </View>
        </View>
        <View
          style={styles.chart}
          accessible
          accessibilityLabel={`Example ${period} received and issued fabric trend. Illustrative demo data.`}
        >
          {chart.map((height, index) => (
            <View key={index} style={styles.barGroup}>
              <View style={styles.barStack}>
                <View
                  style={[
                    styles.chartBar,
                    { height: height * 0.8, backgroundColor: t.color.violet },
                  ]}
                />
                <View
                  style={[
                    styles.chartBar,
                    { height: height * 0.52, backgroundColor: t.color.mint },
                  ]}
                />
              </View>
              <Text style={styles.day}>
                {period === '7 days'
                  ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index]
                  : ['1', '5', '10', '15', '20', '25', '30'][index]}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle
          title="Your material shelf"
          action="View all"
          onPress={() => router.push('/inventory/stock')}
        />
        {items.slice(0, 2).map((item) => (
          <MaterialRow key={item.id} material={item} onPress={() => openMaterial(item.id)} />
        ))}
      </View>
      <View>
        <SectionTitle
          title="Latest activity"
          action="View all"
          onPress={() => router.push('/inventory/activity')}
        />
        {movements.slice(0, 2).map((movement) => (
          <MovementRow
            key={movement.id}
            movement={movement}
            onPress={() => router.push('/inventory/activity')}
          />
        ))}
      </View>
      <DemoNotice />

      <Sheet visible={profile} title="Your factory workspace" onClose={() => setProfile(false)}>
        <Text style={s.heading}>Ayesha Malik</Text>
        <Text style={s.helper}>Inventory manager · Karachi factory</Text>
        <View style={styles.profileNotice}>
          <Icon name="info" color={t.color.accent} />
          <Text style={[s.body, s.flex]}>
            Explore with sample inventory. Stock changes stay on this device. Detection scans remain
            available from the Scan tab.
          </Text>
        </View>
        <DemoNotice />
      </Sheet>
      <Sheet visible={periodOpen} title="Chart period" onClose={() => setPeriodOpen(false)}>
        {(['7 days', '30 days'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: value === period }}
            style={s.option}
            onPress={() => {
              setPeriod(value);
              setPeriodOpen(false);
            }}
          >
            <Text style={s.body}>Last {value}</Text>
            {value === period && <Icon name="check" color={t.color.accent} />}
          </Pressable>
        ))}
        <Text style={s.helper}>This chart illustrates the layout with sample trends.</Text>
      </Sheet>
    </Page>
  );
}
const styles = StyleSheet.create({
  profile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    minHeight: t.size.touch,
  },
  eyebrow: { fontSize: t.type.micro, fontWeight: '600', letterSpacing: 1, color: t.color.muted },
  greeting: {
    fontSize: t.type.brand,
    lineHeight: 30,
    fontWeight: '500',
    letterSpacing: -0.7,
    color: t.color.ink,
  },
  avatar: {
    width: t.size.touch,
    height: t.size.touch,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.lilac,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: t.color.surface,
  },
  avatarText: { fontSize: t.type.label, color: t.color.accentStrong, fontWeight: '600' },
  scanShortcut: {
    width: t.size.touch,
    height: t.size.touch,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introduction: { gap: t.space.xs },
  title: { fontSize: t.type.heading, fontWeight: '600', color: t.color.ink, letterSpacing: -0.5 },
  demoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.xs,
    paddingHorizontal: t.space.sm,
    paddingVertical: t.space.xs,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.accentSoft,
  },
  demoBadgeDot: {
    width: 4,
    height: 4,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.accent,
  },
  demoText: { fontSize: t.type.micro, fontWeight: '500', color: t.color.accentStrong },
  metricGrid: { gap: t.space.md },
  metrics: { flexDirection: 'row', gap: t.space.md },
  metric: {
    flex: 1,
    minWidth: 0,
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.space.lg,
    gap: t.space.sm,
  },
  primaryMetric: { backgroundColor: t.color.violet },
  primaryInk: { color: t.color.violetInk },
  primaryIcon: { backgroundColor: t.color.surface },
  metricIcon: {
    width: 42,
    height: 42,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricTag: {
    fontSize: t.type.micro,
    color: t.color.violetInk,
    flexShrink: 1,
    textAlign: 'right',
  },
  metricValue: {
    color: t.color.ink,
    fontWeight: '600',
    fontSize: t.type.title,
    letterSpacing: -1,
    marginTop: t.space.md,
    lineHeight: 34,
  },
  metricLabel: { color: t.color.muted, fontSize: t.type.caption, flexShrink: 1 },
  allocationCard: { gap: t.space.sm, paddingHorizontal: t.space.xs },
  allocationValue: { color: t.color.ink, fontWeight: '600' },
  allocation: { flexDirection: 'row', gap: t.space.xs, height: 5 },
  allocationBar: { borderRadius: t.radius.pill },
  legendDot: { width: 7, height: 7, borderRadius: t.radius.pill, backgroundColor: t.color.accent },
  section: { gap: t.space.md },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between', gap: t.space.md },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: t.space.md,
    minHeight: 86,
    justifyContent: 'center',
  },
  quickIcon: {
    width: 48,
    height: 48,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    color: t.color.ink,
    fontSize: t.type.caption,
    fontWeight: '500',
    textAlign: 'center',
  },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.md,
    padding: t.space.lg,
    borderRadius: t.radius.md,
    backgroundColor: t.color.purpleSoft,
  },
  alertIcon: { width: 35, height: 40, alignItems: 'center', justifyContent: 'center' },
  alertTitle: {
    color: t.color.ink,
    fontSize: t.type.caption,
    fontWeight: '600',
    marginBottom: t.space.xs,
  },
  chartCard: {
    backgroundColor: t.color.surface,
    borderRadius: t.radius.lg,
    padding: t.space.xl,
    gap: t.space.lg,
  },
  period: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.space.sm,
    minHeight: t.size.touch,
    paddingLeft: t.space.sm,
  },
  chartLegend: { flexDirection: 'row', gap: t.space.xl },
  chart: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: t.space.sm },
  barGroup: { flex: 1, alignItems: 'center', gap: t.space.md },
  barStack: {
    height: t.size.chart * 1.5,
    gap: t.space.xs,
    justifyContent: 'flex-end',
    width: '80%',
  },
  chartBar: { width: '100%', borderRadius: t.radius.sm / 2 },
  day: { fontSize: t.type.small, color: t.color.muted },
  profileNotice: {
    padding: t.space.lg,
    borderRadius: t.radius.md,
    backgroundColor: t.color.accentSoft,
    flexDirection: 'row',
    gap: t.space.md,
  },
});
