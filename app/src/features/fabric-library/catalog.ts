export type FabricCategory = 'All' | 'Denim' | 'Cotton' | 'Polyester';
export type Fabric = {
  id: string;
  name: string;
  category: Exclude<FabricCategory, 'All'>;
  subtitle: string;
  structure: string;
  feel: string;
  weight: string;
  description: string;
  tip: string;
  image: 'denim' | 'cotton' | 'polyester';
};
export const fabrics: Fabric[] = [
  {
    id: 'classic-denim',
    name: 'Classic denim',
    category: 'Denim',
    subtitle: 'The everyday original',
    structure: 'Twill weave',
    feel: 'Structured',
    weight: 'Medium–heavy',
    image: 'denim',
    description:
      'A familiar favourite, with a distinctive diagonal weave and an indigo character that develops with wear. Turn the fabric over to see its lighter reverse.',
    tip: 'Get close enough to capture the diagonal weave. Avoid seams, pockets and metal fastenings.',
  },
  {
    id: 'cotton-jersey',
    name: 'Cotton jersey',
    category: 'Cotton',
    subtitle: 'Soft, simple, essential',
    structure: 'Single knit',
    feel: 'Soft & flexible',
    weight: 'Light–medium',
    image: 'cotton',
    description:
      'An everyday knit commonly used for T-shirts. Look for fine vertical loops on the face and a softer, looped reverse. Check the care label to confirm its fibre content.',
    tip: 'Lay the fabric flat without stretching it. Capture the small knit loops in bright, even light.',
  },
  {
    id: 'performance-knit',
    name: 'Performance knit',
    category: 'Polyester',
    subtitle: 'Made to move with you',
    structure: 'Fine knit',
    feel: 'Smooth',
    weight: 'Lightweight',
    image: 'polyester',
    description:
      'A smooth technical knit often used in sportswear. Polyester content must be read from the care label; a photograph alone cannot confirm the exact fibre.',
    tip: 'Move away from direct light to reduce shine. Photograph a flat area away from the zipper.',
  },
  {
    id: 'washed-denim',
    name: 'Washed denim',
    category: 'Denim',
    subtitle: 'A softer shade of blue',
    structure: 'Twill weave',
    feel: 'Softened',
    weight: 'Medium',
    image: 'denim',
    description:
      'Denim with a lived-in appearance and softer handle. Fading changes its surface appearance, while the underlying diagonal twill remains visible.',
    tip: 'Choose an evenly coloured area so the weave is visible. Avoid distressed patches and worn edges.',
  },
];
export function filterFabrics(category: FabricCategory, query: string, savedIds?: string[]) {
  const term = query.trim().toLowerCase();
  return fabrics.filter(
    (fabric) =>
      (category === 'All' || fabric.category === category) &&
      `${fabric.name} ${fabric.category} ${fabric.structure}`.toLowerCase().includes(term) &&
      (savedIds === undefined || savedIds.includes(fabric.id)),
  );
}
