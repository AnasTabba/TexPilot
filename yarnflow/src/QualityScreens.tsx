import Inspections from './Inspections';
import type { Member } from './inventory-client';

/** The QI module reuses the proven draft and attachment workflow in Inspections. */
export default function QualityScreens({ section, member }: { section: 'dashboard' | 'lots' | 'submissions'; member: Member }) {
  return <Inspections view={section} member={member} />;
}
