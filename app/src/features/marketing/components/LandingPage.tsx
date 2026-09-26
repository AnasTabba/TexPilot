import { Link } from 'expo-router';
import Head from 'expo-router/head';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { VerdictBadge } from '@/scanner';
import { colors, layout, spacing } from '@/theme';

import { footer, hero, limits, steps, verdicts } from '../content';

/** Public landing page (web). Structure only -- the visual design is open. */
export function LandingPage() {
  const wide = useBreakpoint() !== 'compact';
  const row = wide ? styles.row : styles.column;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <Head>
        <title>TexPilot · Fabric verification</title>
        <meta name="description" content={hero.body} />
      </Head>

      <View role="banner" style={[styles.section, styles.header]}>
        <Text variant="heading">TexPilot</Text>
        <View style={styles.headerLinks}>
          <Link href="/scan">
            <Text style={styles.link}>Scanner</Text>
          </Link>
          <Link href="/dashboard">
            <Text style={styles.link}>Dashboard</Text>
          </Link>
        </View>
      </View>

      <View role="main" style={styles.main}>
        <View style={[styles.section, styles.hero]}>
          <Text variant="caption" muted>
            {hero.eyebrow}
          </Text>
          <Text variant="display" role="heading">
            {hero.title}
          </Text>
          <Text muted style={styles.lede}>
            {hero.body}
          </Text>
          <View style={[styles.ctas, wide ? styles.row : styles.column]}>
            <Link href="/scan" asChild>
              <Button title="Open the scanner" />
            </Link>
            <Link href="/dashboard" asChild>
              <Button title="Supervisor dashboard" variant="secondary" />
            </Link>
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="title" role="heading">
            How it works
          </Text>
          <View style={row}>
            {steps.map((step, i) => (
              <Card key={step.title} style={styles.flexCard}>
                <Text variant="heading">
                  {i + 1}. {step.title}
                </Text>
                <Text muted>{step.body}</Text>
              </Card>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="title" role="heading">
            Three honest answers
          </Text>
          <View style={row}>
            {verdicts.map((v) => (
              <Card key={v.verdict} style={styles.flexCard}>
                <VerdictBadge verdict={v.verdict} />
                <Text muted>{v.body}</Text>
              </Card>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Card>
            <Text variant="heading">{limits.title}</Text>
            <Text muted>{limits.body}</Text>
          </Card>
        </View>
      </View>

      <View role="contentinfo" style={[styles.section, styles.footer]}>
        <Text variant="caption" muted>
          {footer}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { alignItems: 'center', paddingHorizontal: spacing.md },
  section: { width: '100%', maxWidth: layout.pageMaxWidth, gap: spacing.md },
  main: { width: '100%', alignItems: 'center', gap: spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  headerLinks: { flexDirection: 'row', gap: spacing.lg },
  link: { color: colors.primary },
  hero: { paddingVertical: spacing.xl, gap: spacing.md },
  lede: { maxWidth: layout.contentMaxWidth },
  ctas: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  column: { flexDirection: 'column', gap: spacing.md },
  flexCard: { flex: 1 },
  footer: { paddingVertical: spacing.xl },
});
