import { Redirect } from 'expo-router';

/** Inventory is the mobile workspace; fabric verification remains in the Scan tab. */
export default function Index() {
  return <Redirect href="/inventory" />;
}
