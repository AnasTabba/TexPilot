import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, typography, type TextVariant } from '@/theme';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  muted?: boolean;
}

export function Text({ variant = 'body', muted = false, style, ...rest }: TextProps) {
  return (
    <RNText
      style={[typography[variant], { color: muted ? colors.textMuted : colors.text }, style]}
      {...rest}
    />
  );
}
