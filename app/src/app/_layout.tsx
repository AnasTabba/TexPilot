import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.primary,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'TexPilot' }} />
        <Stack.Screen name="scan/surface" options={{ title: '1 · Fabric surface' }} />
        <Stack.Screen name="scan/label" options={{ title: '2 · Care label' }} />
        <Stack.Screen name="scan/review" options={{ title: '3 · Review' }} />
        <Stack.Screen name="result/[scanId]" options={{ title: 'Result' }} />
        <Stack.Screen name="history" options={{ title: 'History' }} />
      </Stack>
    </>
  );
}
