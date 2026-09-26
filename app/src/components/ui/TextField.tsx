import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme';

import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
}

export function TextField({ label, style, ...rest }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 52,
  },
});
