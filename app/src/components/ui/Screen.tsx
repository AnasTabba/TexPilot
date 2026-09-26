import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '@/theme';

export interface ScreenProps extends PropsWithChildren {
  /** Wrap content in a ScrollView. Off for screens that manage their own layout (camera). */
  scroll?: boolean;
  /** Pinned below the content, e.g. the primary action. */
  footer?: ReactNode;
}

/**
 * Standard page shell: safe area, background, padding, optional pinned footer.
 * Content is capped at layout.contentMaxWidth and centred, so the same screen
 * reads well on a phone and in a desktop browser.
 */
export function Screen({ scroll = true, footer, children }: ScreenProps) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
  ) : (
    <View style={[styles.content, styles.fill]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
      {body}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const column = {
  width: '100%',
  maxWidth: layout.contentMaxWidth,
  alignSelf: 'center',
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  content: { ...column, padding: spacing.md, gap: spacing.md },
  footer: { ...column, padding: spacing.md, gap: spacing.sm },
});
