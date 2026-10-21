import { materials, sampleMovements } from './model';
import { useInventory } from './store';

beforeEach(() =>
  useInventory.setState({
    materials: materials.map((item) => ({ ...item })),
    movements: [...sampleMovements],
    warehouse: 'All stores',
  }),
);

it('records a receipt and updates the same material locally', () => {
  const result = useInventory.getState().recordMovement({
    kind: 'received',
    materialId: 'denim-indigo',
    metres: 100,
    rolls: 2,
    reference: 'GRN-1045',
    note: '',
  });
  expect(result.ok).toBe(true);
  expect(useInventory.getState().materials[0]).toMatchObject({ metres: 6520, rolls: 70 });
  expect(useInventory.getState().movements[0]).toMatchObject({
    kind: 'received',
    metres: 100,
    reference: 'GRN-1045',
    sample: false,
  });
});

it('rejects issuing reserved or held material without changing inventory', () => {
  const issue = {
    kind: 'issued' as const,
    materialId: 'denim-indigo',
    metres: 5000,
    rolls: 1,
    reference: 'CUT-42',
    note: '',
  };
  expect(useInventory.getState().recordMovement(issue).ok).toBe(false);
  expect(useInventory.getState().materials[0]!.metres).toBe(6420);
  expect(
    useInventory.getState().recordMovement({ ...issue, materialId: 'cotton-jersey', metres: 10 })
      .ok,
  ).toBe(false);
});

it('rejects invalid quantities and missing references', () => {
  const input = {
    kind: 'received' as const,
    materialId: 'denim-indigo',
    metres: NaN,
    rolls: 1,
    reference: 'GRN-1',
    note: '',
  };
  expect(useInventory.getState().recordMovement(input).ok).toBe(false);
  expect(useInventory.getState().recordMovement({ ...input, metres: 0.04 }).ok).toBe(false);
  expect(useInventory.getState().recordMovement({ ...input, metres: 10, reference: ' ' }).ok).toBe(
    false,
  );
});
