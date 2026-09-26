import { Redirect } from 'expo-router';

/** iOS and Android open straight into the scanner. The web gets index.web.tsx. */
export default function Index() {
  return <Redirect href="/scan" />;
}
