import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

/**
 * Overlay drawn on the camera preview showing where the fabric should sit.
 * Purely visual for now -- framing is not yet checked (see quality.ts, T2).
 */
export function FramingGuide({ hint }: { hint: string }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.center}>
        <View style={styles.frame} />
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  frame: {
    width: '75%',
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    borderRadius: radius.lg,
  },
  hint: {
    color: colors.onPrimary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
});
