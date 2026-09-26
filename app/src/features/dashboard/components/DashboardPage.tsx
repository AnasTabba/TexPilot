import Head from 'expo-router/head';
import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { layout, spacing } from '@/theme';

export interface DashboardPageProps extends PropsWithChildren {
  title: string;
  description?: string;
}

/** Title, optional description and scrollable content for one dashboard page. */
export function DashboardPage({ title, description, children }: DashboardPageProps) {
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Head>
        <title>{`${title} · TexPilot dashboard`}</title>
      </Head>
      <View style={styles.page}>
        <View style={styles.header}>
          <Text variant="title" role="heading">
            {title}
          </Text>
          {description ? <Text muted>{description}</Text> : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg },
  page: { width: '100%', maxWidth: layout.pageMaxWidth, gap: spacing.lg },
  header: { gap: spacing.xs },
});
