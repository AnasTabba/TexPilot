import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Text } from './Text';

export interface CardProps extends PropsWithChildren {
  title?: string;
  style?: ViewStyle;
}

export function Card({ title, style, children }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <Text variant="caption" muted style={styles.title}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { letterSpacing: 0.6 },
});
