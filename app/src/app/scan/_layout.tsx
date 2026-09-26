import { Stack } from 'expo-router';

import { colors } from '@/theme';

/** The scanner surface: a stack of capture steps. Same on phone and web. */
export default function ScanLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'TexPilot scanner' }} />
      <Stack.Screen name="surface" options={{ title: '1 · Fabric surface' }} />
      <Stack.Screen name="label" options={{ title: '2 · Care label' }} />
      <Stack.Screen name="review" options={{ title: '3 · Review' }} />
      <Stack.Screen name="result/[scanId]" options={{ title: 'Result' }} />
      <Stack.Screen name="history" options={{ title: 'History' }} />
    </Stack>
  );
}
