import { Link, usePathname, type Href } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { colors, layout, radius, spacing } from '@/theme';

const NAV: { href: Href; label: string; match: (path: string) => boolean }[] = [
  { href: '/dashboard', label: 'Overview', match: (p) => p === '/dashboard' },
  { href: '/dashboard/scans', label: 'Scans', match: (p) => p.startsWith('/dashboard/scans') },
  { href: '/scan', label: 'Open scanner', match: () => false },
];

/**
 * Frame for every dashboard page: a sidebar on wide screens, a top bar on
 * narrow ones. Pages render inside it.
 */
export function DashboardShell({ children }: PropsWithChildren) {
  const wide = useBreakpoint() === 'expanded';
  const pathname = usePathname();

  return (
    <View style={[styles.root, wide && styles.rootWide]}>
      <View role="navigation" style={wide ? styles.sidebar : styles.topbar}>
        <Link href="/">
          <Text variant="heading">TexPilot</Text>
        </Link>
        <View style={wide ? styles.navColumn : styles.navRow}>
          {NAV.map((item) => {
            const active = item.match(pathname);
            return (
              <Link key={item.label} href={item.href} asChild>
                <Pressable
                  accessibilityState={{ selected: active }}
                  // Link asChild rejects style arrays: flatten them.
                  style={StyleSheet.flatten([styles.navItem, active && styles.navItemActive])}
                >
                  <Text style={{ color: active ? colors.primary : colors.text }}>{item.label}</Text>
                </Pressable>
              </Link>
            );
          })}
        </View>
      </View>
      <View role="main" style={styles.main}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  rootWide: { flexDirection: 'row' },
  sidebar: {
    width: layout.dashboardSidebarWidth,
    padding: spacing.md,
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  topbar: {
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navColumn: { gap: spacing.xs },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  navItem: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  navItemActive: { backgroundColor: colors.background },
  main: { flex: 1 },
});
