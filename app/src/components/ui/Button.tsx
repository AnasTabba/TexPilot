import { ActivityIndicator, Pressable, type PressableProps, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Text } from './Text';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  title: string;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

/**
 * For navigation, wrap it in a Link so the web gets a real <a href>:
 *   <Link href="/scan" asChild><Button title="Open the scanner" /></Link>
 */
export function Button({
  title,
  variant = 'primary',
  disabled = false,
  loading = false,
  ...rest
}: ButtonProps) {
  const primary = variant === 'primary';
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      {...rest}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        (pressed || inactive) && styles.dimmed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.primary} />
      ) : (
        <Text variant="heading" style={{ color: primary ? colors.onPrimary : colors.primary }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dimmed: { opacity: 0.6 },
});
