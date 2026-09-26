import { filterFabrics } from './catalog';

it('combines category and case-insensitive search without guessing a match', () => {
  expect(filterFabrics('Denim', '  CLASSIC ').map((item) => item.id)).toEqual(['classic-denim']);
  expect(filterFabrics('Cotton', 'denim')).toEqual([]);
  expect(filterFabrics('All', 'not a fabric')).toEqual([]);
});

it('limits saved results to explicitly saved reference items', () => {
  expect(filterFabrics('All', '', ['cotton-jersey']).map((item) => item.id)).toEqual([
    'cotton-jersey',
  ]);
  expect(filterFabrics('All', '', [])).toEqual([]);
});
