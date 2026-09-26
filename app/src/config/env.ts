/**
 * Runtime configuration. Values come from EXPO_PUBLIC_* variables in
 * app/.env.local (see .env.example). Expo inlines them at bundle time, so each
 * must be referenced as a literal `process.env.EXPO_PUBLIC_X` -- no destructuring.
 */

const DEFAULT_API_URL = 'http://127.0.0.1:8000';

export const env = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, ''),
} as const;
