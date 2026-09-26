import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { env } from '@/config/env';
import { configureScanner } from '@/scanner';

// This app hosts the scanner module: tell it which API to use before anything renders.
configureScanner({ apiUrl: env.apiUrl });

/**
 * Root of all three surfaces. Each has its own layout:
 *   /           landing page (web) · redirects to /scan (iOS, Android)
 *   /scan       scanner, every platform          -> scan/_layout.tsx
 *   /dashboard  supervisor dashboard, web only   -> dashboard/_layout(.web).tsx
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Slot />
    </>
  );
}
