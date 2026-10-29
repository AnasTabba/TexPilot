import Inspections from './Inspections';

/** The QI module reuses the proven draft and attachment workflow in Inspections. */
export default function QualityScreens({ section }: { section: 'dashboard' | 'lots' | 'submissions' }) {
  return <Inspections view={section} />;
}
