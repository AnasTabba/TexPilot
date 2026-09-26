import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

/**
 * Overlay drawn on the camera preview showing where the fabric should sit.
 * Purely visual for now -- framing is not yet checked (see quality.ts, T2).
 */
export function FramingGuide({ hint }: { hint: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.passThrough]}>
      <View style={styles.center}>
        <View style={styles.frame} />
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  passThrough: { pointerEvents: 'none' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  frame: {
    width: '75%',
    maxWidth: 420,
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    borderRadius: radius.lg,
  },
  hint: {
    color: colors.onPrimary,
    textAlign: 'center',
    backgroundColor: colors.scrim,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginHorizontal: spacing.lg,
  },
});
