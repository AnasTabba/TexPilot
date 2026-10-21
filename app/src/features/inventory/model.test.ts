import { availableMetres, filterMaterials, inventorySummary, materials } from './model';

it('keeps held and reserved material out of available stock', () => {
  expect(inventorySummary(materials)).toMatchObject({ metres: 24860, rolls: 268, low: 3, held: 1 });
  const held = materials.find((item) => item.held)!;
  expect(availableMetres(held)).toBe(0);
  // 24,860 on hand − 5,200 reserved − 2,700 unreserved metres on hold.
  expect(inventorySummary(materials).available).toBe(16960);
});

it('combines search, status, category and store filters', () => {
  expect(
    filterMaterials(materials, {
      query: 'IND-2408',
      status: 'all',
      category: 'All',
      warehouse: 'All stores',
    }).map((item) => item.id),
  ).toEqual(['denim-indigo']);
  expect(
    filterMaterials(materials, {
      query: '',
      status: 'low',
      category: 'All',
      warehouse: 'All stores',
    }),
  ).toHaveLength(3);
  expect(
    filterMaterials(materials, {
      query: 'not present',
      status: 'all',
      category: 'All',
      warehouse: 'All stores',
    }),
  ).toEqual([]);
});
