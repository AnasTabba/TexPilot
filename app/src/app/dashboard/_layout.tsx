import { Redirect } from 'expo-router';

/**
 * The supervisor dashboard is web-only for now (_layout.web.tsx). On iOS and
 * Android, /dashboard sends the operator to the scanner instead.
 */
export default function DashboardLayout() {
  return <Redirect href="/scan" />;
}
